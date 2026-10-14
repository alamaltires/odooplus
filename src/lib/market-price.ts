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

// GA4 e-commerce data pushed to the page's dataLayer: {"item_name":"Brand 215/55 R17 94V Model","price":470,...}.
// Shops on Magento/Woo/Shopify commonly list every product on a category page this way.
function parseGa4Items(html: string, base: URL): Candidate[] {
    const out: Candidate[] = [];
    const seen = new Set<string>();
    for (const match of html.matchAll(/"item_name":"((?:[^"\\]|\\.)*)"[^{}]*?"price":([\d.]+)/g)) {
        let title = match[1];
        try {
            title = JSON.parse(`"${match[1]}"`) as string;
        } catch {
            // keep the raw text
        }
        const price = parsePrice(match[2]);
        const key = `${title}|${price}`;
        if (!price || seen.has(key)) continue;
        seen.add(key);
        out.push({ title: decodeEntities(title), price, currency: "", inStock: null, url: base.toString() });
    }
    return out;
}

// Next.js shops stream each product as JSON inside the page: {"brand":"Bridgestone","model":"Turanza T005A",
// "size":"215/55R17","load_index":"94","speed_rating":"W","price":54722,...,"product_paths":{"en":"products/tyres/..."}}.
function parseTyreJson(html: string, base: URL): Candidate[] {
    if (!html.includes('\\"brand\\"') && !html.includes('"brand":"')) return [];
    const text = html.replace(/\\"/g, '"');
    const starts = [...text.matchAll(/"brand":"([^"]+)","model":"([^"]*)","size":"([^"]+)"/g)];
    const out: Candidate[] = [];
    for (let i = 0; i < starts.length; i += 1) {
        const start = starts[i];
        const end = starts[i + 1]?.index ?? Math.min(text.length, (start.index ?? 0) + 4000);
        const windowText = text.slice(start.index ?? 0, end);
        const price = parsePrice(windowText.match(/"price":(\d+(?:\.\d+)?)/)?.[1]);
        if (!price) continue;
        const load = windowText.match(/"load_index":"(\d+)"/)?.[1] ?? "";
        const speed = windowText.match(/"speed_rating":"([A-Z])"/)?.[1] ?? "";
        const year = windowText.match(/"year":(\d{4})/)?.[1] ?? "";
        const path = windowText.match(/"en":"(products\/tyres\/[^"]+)"/)?.[1];
        const stock = windowText.match(/"stock_status":"([a-z_]+)"/)?.[1];
        out.push({
            title: [start[1], start[3], `${load}${speed}`, start[2], year].filter(Boolean).join(" "),
            // These shops store the price in fils (54722 = AED 547.22).
            price: Number.isInteger(price) && price >= 5000 ? price / 100 : price,
            currency: "AED",
            inStock: stock ? stock !== "out_of_stock" : null,
            url: path ? new URL(`/en/${path}`, base).toString() : base.toString(),
        });
    }
    return out;
}

// Magento (and similar) category/search pages: <li class="product-item"> tiles with the model + size as the
// link text, the brand only as a logo's alt text, and the price in data-price-amount attributes.
function parseMagentoCards(html: string, base: URL): Candidate[] {
    const out: Candidate[] = [];
    const segments = html.split(/<li\b[^>]*class="[^"]*\bproduct-item\b[^"]*"[^>]*>/i).slice(1);
    for (const segment of segments) {
        const link = segment.match(/<a\b[^>]*class="[^"]*product-item-link[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
        if (!link) continue;
        const href = link[0].match(/href="([^"]+)"/i)?.[1];
        const priceText =
            segment.match(/data-price-amount="([\d.]+)"[^>]*data-price-type="finalPrice"/i)?.[1] ??
            segment.match(/data-price-type="finalPrice"[^>]*data-price-amount="([\d.]+)"/i)?.[1] ??
            segment.match(/data-price-amount="([\d.]+)"/i)?.[1];
        const price = parsePrice(priceText);
        if (!href || !price) continue;
        const brand = segment.match(/class="brand[^"]*"[\s\S]{0,500}?alt="([^"]+)"/i)?.[1] ?? "";
        out.push({
            title: decodeEntities(`${brand} ${stripTags(link[1])}`.replace(/\s+/g, " ").trim()),
            price,
            currency: "",
            inStock: /out of stock/i.test(segment) ? false : null,
            url: new URL(decodeEntities(href), base).toString(),
        });
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
        out.push(...parseMagentoCards(html, base));
    }
    if (out.length === 0) {
        out.push(...parseGa4Items(html, base));
    }
    if (out.length === 0) {
        out.push(...parseTyreJson(html, base));
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
// Matching — every retailer names the same tyre differently ("YOKOHAMA215/55R17 94V",
// "Yokohama E70 215 55 R17 94 V XL", ...), so the Odoo name is broken into segments
// (size, brand, pattern, load/speed) and each segment is checked on its own against
// the retailer's title, ignoring spaces, dashes and slashes.
// ---------------------------------------------------------------------------

export type MarketProduct = { id: number; name: string; sku: string; brand?: string };

const SIZE_PATTERN = /(?<!\d)(\d{3})\s*[/\-x ]\s*(\d{2})\s*(?:z?r|-|\/|\s)?\s*(\d{2})(?!\d)/i;
const LOAD_SPEED_PATTERN = /(?<!\d)(\d{2,3})\s*([JKLMNPQRSTUHVWYZ])(?![A-Za-z])/i;

// Country of origin ("... 94 V China") and generic words retailers rarely print the same way.
const IGNORED_WORDS = new Set([
    "china", "japan", "thailand", "indonesia", "korea", "germany", "turkey", "india", "usa", "vietnam", "malaysia",
    "taiwan", "france", "italy", "spain", "poland", "uae", "saudi", "mexico", "brazil", "romania", "hungary", "czech",
    "republic", "kingdom", "united", "states", "south", "slovakia", "portugal", "serbia", "russia", "austria", "luxembourg",
    "tyre", "tyres", "tire", "tires", "xl", "rf", "rft", "runflat", "tl", "tt", "suv", "extra", "load", "reinforced", "new",
]);

type ProductSegments = {
    sizeKey: string | null;
    size: string;
    width: string;
    brand: string;
    pattern: string[];
    load: string;
    speed: string;
};

const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");

function extractSizeKey(text: string): string | null {
    const match = text.match(SIZE_PATTERN);
    return match ? `${match[1]}${match[2]}${match[3]}` : null;
}

function segmentProduct(product: MarketProduct): ProductSegments {
    const name = product.name.replace(/\s+/g, " ").trim();
    const sizeMatch = name.match(SIZE_PATTERN);
    let rest = name.replace(SIZE_PATTERN, " ");

    const loadSpeed = rest.match(LOAD_SPEED_PATTERN);
    if (loadSpeed) rest = rest.replace(LOAD_SPEED_PATTERN, " ");

    const knownBrand = (product.brand ?? "").trim();
    const words = rest.split(/[^A-Za-z0-9]+/).filter(Boolean);
    const brand = knownBrand && !/^no brand$/i.test(knownBrand) ? knownBrand : (words[0] ?? "");
    const brandWords = new Set(brand.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));

    const pattern = words
        .map((word) => word.toLowerCase())
        .filter((word) => !brandWords.has(word) && !IGNORED_WORDS.has(word) && (word.length > 1 || /\d/.test(word)))
        .filter((word) => !/^\(.*\)$/.test(word));

    return {
        sizeKey: sizeMatch ? `${sizeMatch[1]}${sizeMatch[2]}${sizeMatch[3]}` : null,
        size: sizeMatch ? `${sizeMatch[1]}/${sizeMatch[2]}R${sizeMatch[3]}` : "",
        width: sizeMatch?.[1] ?? "",
        brand,
        pattern,
        load: loadSpeed?.[1] ?? "",
        speed: (loadSpeed?.[2] ?? "").toUpperCase(),
    };
}

/**
 * 0 = not the same tyre. Otherwise 0.5 (size + brand agree) plus up to 0.35 for the pattern
 * and up to 0.15 for the load/speed index — so >= 0.9 is an exact match and anything lower
 * is a "partial" one (e.g. the retailer's title leaves out the pattern).
 */
function scoreCandidate(segments: ProductSegments, title: string): number {
    if (segments.sizeKey && extractSizeKey(title) !== segments.sizeKey) return 0;

    const haystack = normalize(title);
    if (segments.brand && !haystack.includes(normalize(segments.brand))) return 0;

    let spec = 0.05;
    const titleSpec = title.replace(SIZE_PATTERN, " ").match(LOAD_SPEED_PATTERN);
    if (segments.load && titleSpec) {
        if (titleSpec[1] !== segments.load || titleSpec[2].toUpperCase() !== segments.speed) return 0;
        spec = 0.15;
    }

    let pattern = 0.35;
    if (segments.pattern.length > 0) {
        const hits = segments.pattern.filter((token) => haystack.includes(normalize(token))).length;
        pattern = (0.35 * hits) / segments.pattern.length;
    }

    // Words in the retailer's title that are not part of our product ("UltraContact EV" / "UC6" when we
    // want plain "UltraContact") mean a different model: rank them below a cleaner match.
    const brandWords = new Set(segments.brand.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
    const patternKeys = segments.pattern.map(normalize);
    const extras = title
        .replace(SIZE_PATTERN, " ")
        .replace(LOAD_SPEED_PATTERN, " ")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word && !/^20\d\d$/.test(word) && !IGNORED_WORDS.has(word) && !brandWords.has(word))
        .filter((word) => !patternKeys.some((key) => key.includes(word) || word.includes(key)));
    const penalty = Math.min(0.2, 0.04 * extras.length);

    return 0.5 + pattern + spec - penalty;
}

const MIN_MATCH_SCORE = 0.5;

function buildQueries(product: MarketProduct, segments: ProductSegments): string[] {
    const pattern = segments.pattern.join(" ");
    const { size, brand, width } = segments;
    // Shop searches usually need every word to match, so go from most to least specific.
    const queries = [
        [size, brand, pattern],
        [brand, pattern, width],
        [brand, width],
        [size],
        [product.sku],
    ].map((parts) => parts.filter(Boolean).join(" ").trim());
    return Array.from(new Set(queries.filter((query) => query.length > 2))).slice(0, 4);
}

// ---------------------------------------------------------------------------
// Per-retailer search
// ---------------------------------------------------------------------------

function retailerLabel(url: URL): string {
    return url.hostname.replace(/^www\./, "");
}

type Engine = {
    id: string;
    /** False for pages that list products by size/brand whatever the query is. */
    usesQuery: boolean;
    /** Whether `run` can fetch further pages of the same listing. */
    paged: boolean;
    run: (query: string, page: number) => Promise<Candidate[]>;
};

type Match = { candidate: Candidate; score: number; engineId: string };

const EXACT_SCORE = 0.9;
const MAX_LISTING_PAGES = 5;

// Which search method found a match at a shop is remembered, so later products ask it directly
// (one request) instead of trying every method again.
const engineMemo = new Map<string, string>();

function buildEngines(fetchText: FetchText, retailerUrl: string, segments: ProductSegments): Engine[] {
    // Explicit search-URL template: https://shop.ae/search?q={query}
    if (retailerUrl.includes("{query}")) {
        return [
            {
                id: "template",
                usesQuery: true,
                paged: false,
                run: async (query) => {
                    const { text, finalUrl } = await fetchText(retailerUrl.replace(/\{query\}/g, encodeURIComponent(query)), "text/html,application/json");
                    const base = new URL(finalUrl);
                    const json = tryParseJson(text);
                    return json ? [...parseShopifySuggest(json, base), ...parseWooStore(json, base)] : parseHtmlProducts(text, base);
                },
            },
        ];
    }

    const origin = new URL(retailerUrl).origin;
    const base = new URL(origin);
    const html = (id: string, path: (query: string) => string): Engine => ({
        id,
        usesQuery: true,
        paged: false,
        run: async (query) => {
            const { text, finalUrl } = await fetchText(`${origin}${path(encodeURIComponent(query))}`, "text/html");
            return parseHtmlProducts(text, new URL(finalUrl));
        },
    });

    const engines: Engine[] = [
        {
            id: "shopify",
            usesQuery: true,
            paged: false,
            run: async (query) => {
                const { text } = await fetchText(
                    `${origin}/search/suggest.json?q=${encodeURIComponent(query)}&resources[type]=product&resources[limit]=10`,
                    "application/json"
                );
                return parseShopifySuggest(tryParseJson(text), base);
            },
        },
        {
            id: "woo",
            usesQuery: true,
            paged: false,
            run: async (query) => {
                const { text } = await fetchText(`${origin}/wp-json/wc/store/v1/products?search=${encodeURIComponent(query)}&per_page=12`, "application/json");
                return parseWooStore(tryParseJson(text), base);
            },
        },
        html("html-search", (q) => `/search?q=${q}`),
        html("html-wp", (q) => `/?s=${q}&post_type=product`),
        html("html-magento", (q) => `/catalogsearch/result/?q=${q}`),
    ];

    // Tyre shops that publish a listing per size (and per brand): /tyres/size/215-55-r17?p=2,
    // /products/tyres/brand/bridgestone?size=215%2F55R17. Free-text search isn't needed there.
    if (segments.sizeKey) {
        const { sizeKey } = segments;
        const slug = `${sizeKey.slice(0, 3)}-${sizeKey.slice(3, 5)}-r${sizeKey.slice(5)}`;
        const sizeParam = encodeURIComponent(`${sizeKey.slice(0, 3)}/${sizeKey.slice(3, 5)}R${sizeKey.slice(5)}`);
        for (const prefix of ["", "/en"]) {
            engines.push({
                id: `size-listing${prefix}`,
                usesQuery: false,
                paged: true,
                run: async (_query, page) => {
                    const { text, finalUrl } = await fetchText(`${origin}${prefix}/tyres/size/${slug}${page > 1 ? `?p=${page}` : ""}`, "text/html");
                    return parseHtmlProducts(text, new URL(finalUrl));
                },
            });
            const brandSlug = segments.brand.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
            if (brandSlug) {
                engines.push({
                    id: `brand-size${prefix}`,
                    usesQuery: false,
                    paged: false,
                    run: async () => {
                        const { text, finalUrl } = await fetchText(`${origin}${prefix}/products/tyres/brand/${brandSlug}?size=${sizeParam}`, "text/html");
                        return parseHtmlProducts(text, new URL(finalUrl));
                    },
                });
            }
        }
    }
    return engines;
}

type EngineOutcome = { match: Match | null; reached: boolean; error: unknown };

/** One search method over its queries (and pages): the best acceptable listing it can find. */
async function runEngine(engine: Engine, segments: ProductSegments, queries: string[]): Promise<EngineOutcome> {
    const outcome: EngineOutcome = { match: null, reached: false, error: null };
    const engineQueries = engine.usesQuery ? queries : queries.slice(0, 1);

    for (const query of engineQueries) {
        for (let page = 1; page <= (engine.paged ? MAX_LISTING_PAGES : 1); page += 1) {
            let candidates: Candidate[];
            try {
                candidates = await engine.run(query, page);
                outcome.reached = true;
            } catch (error) {
                if (!outcome.reached) outcome.error = error;
                break;
            }
            if (candidates.length === 0) break;

            for (const candidate of candidates) {
                const score = scoreCandidate(segments, candidate.title);
                if (score < MIN_MATCH_SCORE) continue;
                const better =
                    !outcome.match ||
                    score > outcome.match.score ||
                    (score === outcome.match.score && candidate.price < outcome.match.candidate.price);
                if (better) outcome.match = { candidate, score, engineId: engine.id };
            }
            if (outcome.match && outcome.match.score >= EXACT_SCORE) return outcome;
        }
        // The first query that finds anything acceptable is enough for this method.
        if (outcome.match) return outcome;
        // A method that cannot even be reached won't do better with another query.
        if (!outcome.reached) return outcome;
    }
    return outcome;
}

function toQuote(retailerUrl: string, match: Match): MarketQuote {
    return {
        retailer: retailerLabel(new URL(retailerUrl.replace("{query}", "x"))),
        retailerUrl,
        title: match.candidate.title,
        price: Math.round(match.candidate.price * 100) / 100,
        currency: match.candidate.currency || "AED",
        inStock: match.candidate.inStock,
        productUrl: match.candidate.url,
        matchScore: Math.round(match.score * 100) / 100,
    };
}

async function quoteFromRetailer(
    fetchText: FetchText,
    retailerUrl: string,
    product: MarketProduct
): Promise<MarketQuote | null> {
    const segments = segmentProduct(product);
    const queries = buildQueries(product, segments);
    const engines = buildEngines(fetchText, retailerUrl, segments);
    const memoKey = retailerUrl.includes("{query}") ? retailerUrl : new URL(retailerUrl).origin;

    const remembered = engines.find((engine) => engine.id === engineMemo.get(memoKey));
    if (remembered) {
        const outcome = await runEngine(remembered, segments, queries);
        if (outcome.match) return toQuote(retailerUrl, outcome.match);
        if (outcome.reached) return null;
        engineMemo.delete(memoKey);
    }

    // Try every method at once. An exact match ends it straight away; otherwise the best of all wins.
    return new Promise<MarketQuote | null>((resolve, reject) => {
        let pending = engines.length;
        let finished = false;
        let reachedAny = false;
        let lastError: unknown = null;
        let best: Match | null = null;

        const finish = (match: Match | null) => {
            finished = true;
            if (match) {
                engineMemo.set(memoKey, match.engineId);
                resolve(toQuote(retailerUrl, match));
            } else if (!reachedAny) {
                reject(lastError ?? new Error("Request failed"));
            } else {
                resolve(null);
            }
        };

        for (const engine of engines) {
            runEngine(engine, segments, queries)
                .then((outcome) => {
                    if (finished) return;
                    if (outcome.reached) reachedAny = true;
                    else lastError = outcome.error;
                    if (outcome.match && (!best || outcome.match.score > best.score)) best = outcome.match;
                    if (best && best.score >= EXACT_SCORE) finish(best);
                })
                .catch((error) => {
                    lastError = error;
                })
                .finally(() => {
                    pending -= 1;
                    if (pending === 0 && !finished) finish(best);
                });
        }
    });
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

/** At most `max` requests in flight per website, so fast checks don't trip a shop's rate limit. */
function limitPerHost(fetchText: FetchText, max: number): FetchText {
    const active = new Map<string, number>();
    const waiting = new Map<string, Array<() => void>>();
    return async (url, accept) => {
        const host = new URL(url).hostname;
        while ((active.get(host) ?? 0) >= max) {
            await new Promise<void>((resolve) => waiting.set(host, [...(waiting.get(host) ?? []), resolve]));
        }
        active.set(host, (active.get(host) ?? 0) + 1);
        try {
            return await fetchText(url, accept);
        } finally {
            active.set(host, (active.get(host) ?? 1) - 1);
            waiting.get(host)?.shift()?.();
        }
    };
}

export async function checkMarketPrices(
    products: MarketProduct[],
    retailerUrls: string[],
    rawFetchText: FetchText,
    onProgress?: (done: number, total: number) => void
): Promise<MarketProductResult[]> {
    const fetchText = limitPerHost(rawFetchText, 3);
    const total = products.length * retailerUrls.length;
    let completed = 0;
    // A shop that failed on every method is skipped for the remaining products instead of timing out again.
    const deadRetailers = new Map<string, string>();

    const runJob = async ({ product, retailerUrl }: { product: MarketProduct; retailerUrl: string }) => {
        const retailer = retailerLabel(new URL(retailerUrl.replace("{query}", "x")));
        try {
            const dead = deadRetailers.get(retailerUrl);
            if (dead) throw new Error(dead);
            const quote = await quoteFromRetailer(fetchText, retailerUrl, product);
            return { product, quote, error: null as MarketRetailerError | null };
        } catch (error) {
            const message = error instanceof Error ? error.message : "Request failed";
            deadRetailers.set(retailerUrl, message);
            return { product, quote: null, error: { retailer, message } };
        } finally {
            completed += 1;
            onProgress?.(completed, total);
        }
    };

    // The first product teaches each shop's search method (and which shops are unreachable);
    // the rest then reuse that and need far fewer requests.
    const [first, ...others] = products;
    const jobsFor = (list: MarketProduct[]) => list.flatMap((product) => retailerUrls.map((retailerUrl) => ({ product, retailerUrl })));
    const outcomes = [
        ...(first ? await mapWithConcurrency(jobsFor([first]), 8, runJob) : []),
        ...(await mapWithConcurrency(jobsFor(others), 8, runJob)),
    ];

    return products.map((product) => {
        const mine = outcomes.filter((outcome) => outcome.product.id === product.id);
        return {
            productId: product.id,
            quotes: mine.map((entry) => entry.quote).filter((quote): quote is MarketQuote => quote !== null),
            errors: mine.map((entry) => entry.error).filter((error): error is MarketRetailerError => error !== null),
        };
    });
}
