export type MarketQuote = {
    retailer: string;
    retailerUrl: string;
    title: string;
    price: number;
    currency: string;
    inStock: boolean | null;
    productUrl: string;
    matchScore: number;
};

export type MarketRetailerError = { retailer: string; message: string };

export type MarketProductResult = {
    productId: number;
    quotes: MarketQuote[];
    errors: MarketRetailerError[];
};

type Candidate = {
    title: string;
    price: number;
    currency: string;
    inStock: boolean | null;
    url: string;
};

export type FetchText = (url: string, accept: string) => Promise<{ text: string; finalUrl: string }>;

export function normalizeRetailerUrl(raw: string): string {
    const trimmed = raw.trim();
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(withProtocol.replace(/%7Bquery%7D/gi, "{query}"));
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("Only http(s) URLs are allowed");
    }
    if (!url.hostname.includes(".")) {
        throw new Error("Enter a full website address, e.g. https://www.example.ae");
    }
    return url.toString().replace(/%7Bquery%7D/gi, "{query}");
}

// ---------------------------------------------------------------------------
// Parsing — Shopify suggest API, WooCommerce Store API, then JSON-LD in HTML.
// ---------------------------------------------------------------------------

function parsePrice(value: unknown): number | null {
    if (typeof value === "number") {
        return Number.isFinite(value) && value > 0 ? value : null;
    }
    if (typeof value === "string") {
        const parsed = Number(value.replace(/[^\d.]/g, ""));
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }
    return null;
}

function availabilityToStock(value: unknown): boolean | null {
    if (typeof value !== "string") return null;
    if (/InStock|LimitedAvailability|PreOrder/i.test(value)) return true;
    if (/OutOfStock|SoldOut|Discontinued/i.test(value)) return false;
    return null;
}

function decodeEntities(text: string): string {
    return text
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;|&apos;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function tryParseJson(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function parseShopifySuggest(json: unknown, base: URL): Candidate[] {
    const products = (json as { resources?: { results?: { products?: Array<Record<string, unknown>> } } })
        ?.resources?.results?.products;
    if (!Array.isArray(products)) return [];
    const out: Candidate[] = [];
    for (const product of products) {
        const price = parsePrice(product.price);
        if (!price || typeof product.title !== "string") continue;
        out.push({
            title: product.title,
            price,
            currency: "",
            inStock: typeof product.available === "boolean" ? product.available : null,
            url: new URL(String(product.url ?? "/"), base).toString(),
        });
    }
    return out;
}

function parseWooStore(json: unknown, base: URL): Candidate[] {
    if (!Array.isArray(json)) return [];
    const out: Candidate[] = [];
    for (const product of json as Array<Record<string, unknown>>) {
        const prices = product.prices as Record<string, unknown> | undefined;
        const minor = Number(prices?.currency_minor_unit ?? 2);
        const raw = parsePrice(prices?.price);
        if (!raw || typeof product.name !== "string") continue;
        out.push({
            title: decodeEntities(product.name),
            price: raw / 10 ** (Number.isFinite(minor) ? minor : 2),
            currency: String(prices?.currency_code ?? ""),
            inStock: typeof product.is_in_stock === "boolean" ? product.is_in_stock : null,
            url: new URL(String(product.permalink ?? "/"), base).toString(),
        });
    }
    return out;
}

function collectJsonLdProducts(node: unknown, out: Array<Record<string, unknown>>, depth = 0) {
    if (!node || depth > 8) return;
    if (Array.isArray(node)) {
        node.forEach((entry) => collectJsonLdProducts(entry, out, depth + 1));
        return;
    }
    if (typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    const type = record["@type"];
    const types = Array.isArray(type) ? type : [type];
    if (types.includes("Product")) {
        out.push(record);
    }
    for (const key of ["@graph", "itemListElement", "item", "mainEntity", "hasVariant"]) {
        if (record[key]) collectJsonLdProducts(record[key], out, depth + 1);
    }
}

// WooCommerce's "GTM4WP" plugin embeds each listed product as JSON in a hidden
// span's data attribute — present on many UAE WooCommerce shops.
function parseGtmProducts(html: string, base: URL): Candidate[] {
    const out: Candidate[] = [];
    for (const match of html.matchAll(/data-gtm4wp_product_data=(["'])([\s\S]*?)\1/g)) {
        const data = tryParseJson(decodeEntities(match[2])) as Record<string, unknown> | null;
        const price = parsePrice(data?.price);
        if (!data || !price || typeof data.item_name !== "string") continue;
        const status = String(data.stockstatus ?? "");
        out.push({
            title: decodeEntities(data.item_name),
            price: Math.round(price * 100) / 100,
            currency: "",
            inStock: status ? status === "instock" : null,
            url: typeof data.productlink === "string" ? new URL(data.productlink, base).toString() : base.toString(),
        });
    }
    return out;
}

function stripTags(fragment: string): string {
    return decodeEntities(fragment.replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ")).replace(/\s+/g, " ").trim();
}

// Last resort for shops with no structured data: any link whose text contains a
// tire size, paired with the first AED price printed after it (sale price in
// <ins> wins over the struck-through <del> price).
function parseProductCards(html: string, base: URL): Candidate[] {
    const anchors = [...html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{3,300}?)<\/a>/gi)];
    const out: Candidate[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < anchors.length; i += 1) {
        const title = stripTags(anchors[i][2]);
        if (!SIZE_PATTERN.test(title) || title.length > 160) continue;
        const start = (anchors[i].index ?? 0) + anchors[i][0].length;
        // Stop at the next size-bearing link so one card's price is never read from the next card.
        let end = Math.min(html.length, start + 1800);
        for (let j = i + 1; j < anchors.length; j += 1) {
            if (SIZE_PATTERN.test(stripTags(anchors[j][2]))) {
                end = Math.min(end, anchors[j].index ?? end);
                break;
            }
        }
        const windowHtml = html.slice(start, end);
        const ins = windowHtml.match(/<ins\b[^>]*>([\s\S]*?)<\/ins>/i);
        const text = stripTags(ins ? ins[1] : windowHtml);
        const priceMatch =
            text.match(/(?:AED|Dhs?\.?|د\.إ)\s*([\d,]+(?:\.\d+)?)/i) ??
            text.match(/([\d,]+(?:\.\d+)?)\s*(?:AED|Dhs?\b\.?|د\.إ)/i);
        const price = parsePrice(priceMatch?.[1]);
        if (!price) continue;
        const url = new URL(anchors[i][1], base).toString();
        if (seen.has(url)) continue;
        seen.add(url);
        out.push({ title, price, currency: "AED", inStock: null, url });
    }
    return out;
}

function parseHtmlProducts(html: string, base: URL): Candidate[] {
    const products: Array<Record<string, unknown>> = [];
    const scriptPattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    for (const match of html.matchAll(scriptPattern)) {
        collectJsonLdProducts(tryParseJson(match[1].trim()), products);
    }

    const out: Candidate[] = [];
    for (const product of products) {
        const name = typeof product.name === "string" ? decodeEntities(product.name) : "";
        const offersRaw = product.offers;
        const offers = (Array.isArray(offersRaw) ? offersRaw : [offersRaw]).filter(Boolean) as Array<Record<string, unknown>>;
        const prices = offers
            .map((offer) => parsePrice(offer.price ?? offer.lowPrice ?? (offer.priceSpecification as Record<string, unknown> | undefined)?.price))
            .filter((value): value is number => value !== null);
        if (!name || prices.length === 0) continue;
        const firstOffer = offers[0] ?? {};
        const rawUrl = typeof product.url === "string" ? product.url : typeof firstOffer.url === "string" ? firstOffer.url : "";
        out.push({
            title: name,
            price: Math.min(...prices),
            currency: String(firstOffer.priceCurrency ?? ""),
            inStock: availabilityToStock(firstOffer.availability),
            url: rawUrl ? new URL(rawUrl, base).toString() : base.toString(),
        });
    }

    if (out.length === 0) {
        out.push(...parseGtmProducts(html, base));
    }
    if (out.length === 0) {
        out.push(...parseProductCards(html, base));
    }

    if (out.length === 0) {
        // Single product page without JSON-LD: Open Graph / product meta tags.
        const meta = (property: string) =>
            html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`, "i"))?.[1] ??
            html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`, "i"))?.[1];
        const title = meta("og:title");
        const price = parsePrice(meta("product:price:amount") ?? meta("og:price:amount"));
        if (title && price) {
            out.push({
                title: decodeEntities(title),
                price,
                currency: meta("product:price:currency") ?? meta("og:price:currency") ?? "",
                inStock: availabilityToStock(meta("product:availability") ?? meta("og:availability")),
                url: base.toString(),
            });
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Matching — the retailer's search is fuzzy, so only accept a result when its
// tire size and enough of the remaining name tokens agree with the Odoo product.
// ---------------------------------------------------------------------------

const SIZE_PATTERN = /(\d{3})\s*[/\-x ]\s*(\d{2})\s*(?:z?r|-|\s)?\s*(\d{2})(?!\d)/i;

function extractSizeKey(text: string): string | null {
    const match = text.match(SIZE_PATTERN);
    return match ? `${match[1]}${match[2]}${match[3]}` : null;
}

// Odoo names end with the country of origin ("... 94 V China"), which retailers rarely print.
const IGNORED_WORDS = new Set([
    "china", "japan", "thailand", "indonesia", "korea", "germany", "turkey", "india", "usa", "vietnam", "malaysia",
    "taiwan", "france", "italy", "spain", "poland", "uae", "saudi", "mexico", "brazil", "tyre", "tyres", "tire", "tires",
]);

function significantTokens(text: string): string[] {
    return text
        .toLowerCase()
        .replace(SIZE_PATTERN, " ")
        .replace(/\([^)]*\)/g, " ")
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length > 1 && !/^\d{2,3}[a-z]?$/.test(token) && !IGNORED_WORDS.has(token));
}

function scoreCandidate(productName: string, candidateTitle: string): number {
    const wantedSize = extractSizeKey(productName);
    if (wantedSize && extractSizeKey(candidateTitle) !== wantedSize) {
        return 0;
    }
    const wanted = significantTokens(productName);
    if (wanted.length === 0) return wantedSize ? 0.6 : 0;
    const have = new Set(significantTokens(candidateTitle));
    const hits = wanted.filter((token) => have.has(token)).length;
    return hits / wanted.length;
}

const MIN_MATCH_SCORE = 0.5;

function buildQueries(productName: string, sku: string): string[] {
    const cleaned = productName.replace(/\s+/g, " ").trim();
    const size = cleaned.match(SIZE_PATTERN)?.[0].replace(/\s+/g, "");
    const words = significantTokens(cleaned).join(" ");
    // Shop searches usually require every word to match, so the short "size + brand + pattern"
    // form goes first; the full Odoo name (load/speed index, origin) rarely matches a title.
    // Retailers often omit the pattern ("YOKOHAMA215/55R17 94V"), so also try brand + width alone.
    const brand = words.split(" ")[0] ?? "";
    const width = size?.match(/^\d{3}/)?.[0] ?? "";
    const queries = [size && words ? `${size} ${words}` : "", words, brand && width ? `${brand} ${width}` : "", size ?? "", sku, cleaned].filter(Boolean);
    return Array.from(new Set(queries)).slice(0, 4);
}

// ---------------------------------------------------------------------------
// Per-retailer search
// ---------------------------------------------------------------------------

function retailerLabel(url: URL): string {
    return url.hostname.replace(/^www\./, "");
}

async function searchRetailer(fetchText: FetchText, retailerUrl: string, query: string): Promise<Candidate[]> {
    const encoded = encodeURIComponent(query);

    // Explicit search-URL template: https://shop.ae/search?q={query}
    if (retailerUrl.includes("{query}")) {
        const target = retailerUrl.replace(/\{query\}/g, encoded);
        const { text, finalUrl } = await fetchText(target, "text/html,application/json");
        const base = new URL(finalUrl);
        const json = tryParseJson(text);
        if (json) {
            return [...parseShopifySuggest(json, base), ...parseWooStore(json, base)];
        }
        return parseHtmlProducts(text, base);
    }

    const origin = new URL(retailerUrl).origin;
    const base = new URL(origin);
    const attempts: Array<() => Promise<Candidate[]>> = [
        async () => {
            const { text } = await fetchText(
                `${origin}/search/suggest.json?q=${encoded}&resources[type]=product&resources[limit]=10`,
                "application/json"
            );
            return parseShopifySuggest(tryParseJson(text), base);
        },
        async () => {
            const { text } = await fetchText(`${origin}/wp-json/wc/store/v1/products?search=${encoded}&per_page=12`, "application/json");
            return parseWooStore(tryParseJson(text), base);
        },
        ...[`/search?q=${encoded}`, `/?s=${encoded}&post_type=product`, `/catalogsearch/result/?q=${encoded}`].map(
            (path) => async () => {
                const { text, finalUrl } = await fetchText(`${origin}${path}`, "text/html");
                return parseHtmlProducts(text, new URL(finalUrl));
            }
        ),
    ];

    let lastError: unknown = null;
    let reachedAny = false;
    for (const attempt of attempts) {
        try {
            const candidates = await attempt();
            reachedAny = true;
            if (candidates.length > 0) return candidates;
        } catch (error) {
            lastError = error;
        }
    }
    if (!reachedAny && lastError) throw lastError;
    return [];
}

async function quoteFromRetailer(
    fetchText: FetchText,
    retailerUrl: string,
    product: { name: string; sku: string }
): Promise<MarketQuote | null> {
    const display = retailerLabel(new URL(retailerUrl.replace("{query}", "x")));
    for (const query of buildQueries(product.name, product.sku)) {
        const candidates = await searchRetailer(fetchText, retailerUrl, query);
        const scored = candidates
            .map((candidate) => ({ candidate, score: scoreCandidate(product.name, candidate.title) }))
            .filter((entry) => entry.score >= MIN_MATCH_SCORE);
        if (scored.length === 0) continue;

        scored.sort((a, b) => b.score - a.score || a.candidate.price - b.candidate.price);
        const best = scored[0];
        return {
            retailer: display,
            retailerUrl,
            title: best.candidate.title,
            price: Math.round(best.candidate.price * 100) / 100,
            currency: best.candidate.currency || "AED",
            inStock: best.candidate.inStock,
            productUrl: best.candidate.url,
            matchScore: Math.round(best.score * 100) / 100,
        };
    }
    return null;
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
    const results = new Array<R>(items.length);
    let next = 0;
    await Promise.all(
        Array.from({ length: Math.min(limit, items.length) }, async () => {
            while (next < items.length) {
                const index = next;
                next += 1;
                results[index] = await worker(items[index]);
            }
        })
    );
    return results;
}

export async function checkMarketPrices(
    products: Array<{ id: number; name: string; sku: string }>,
    retailerUrls: string[],
    fetchText: FetchText,
    onProgress?: (done: number, total: number) => void
): Promise<MarketProductResult[]> {
    const jobs = products.flatMap((product) => retailerUrls.map((retailerUrl) => ({ product, retailerUrl })));
    let completed = 0;

    const outcomes = await mapWithConcurrency(jobs, 4, async ({ product, retailerUrl }) => {
        const retailer = retailerLabel(new URL(retailerUrl.replace("{query}", "x")));
        try {
            const quote = await quoteFromRetailer(fetchText, retailerUrl, product);
            return { product, quote, error: null as MarketRetailerError | null };
        } catch (error) {
            return {
                product,
                quote: null,
                error: { retailer, message: error instanceof Error ? error.message : "Request failed" },
            };
        } finally {
            completed += 1;
            onProgress?.(completed, jobs.length);
        }
    });

    return products.map((product) => {
        const mine = outcomes.filter((outcome) => outcome.product.id === product.id);
        return {
            productId: product.id,
            quotes: mine.map((entry) => entry.quote).filter((quote): quote is MarketQuote => quote !== null),
            errors: mine.map((entry) => entry.error).filter((error): error is MarketRetailerError => error !== null),
        };
    });
}
