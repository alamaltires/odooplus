"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Download, ExternalLink, Plus, Search, Tag, Trash2, X } from "lucide-react";
import { addMsrpRetailer, getMsrpRetailers, removeMsrpRetailer, searchProductCatalog } from "@/lib/client-odoo";
import { checkMarketPrices, type MarketProductResult } from "@/lib/market-price";
import { ExtensionState, fetchViaExtension, getExtensionState } from "@/lib/msrp-extension";

type CatalogProduct = Awaited<ReturnType<typeof searchProductCatalog>>["products"][number];

const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").trim().replace(/\/$/, "");
const EXTENSION_ZIP_URL = `${BASE_PATH && !BASE_PATH.startsWith("/") ? "/" : ""}${BASE_PATH}/msrp-finder-helper.zip`;

const DISABLED_RETAILERS_KEY = "msrp-disabled-retailers";

const aed = new Intl.NumberFormat("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function hostLabel(url: string) {
    try {
        return new URL(url.replace("{query}", "x")).hostname.replace(/^www\./, "");
    } catch {
        return url;
    }
}

// A pricelist can hold one price per lot. Compare against the lot with the most stock
// (falling back to the first), so the number matches what is actually being sold.
function odooPrice(product: CatalogProduct, pricelistName: string): number | null {
    const entries = product.pricelists.filter((entry) => entry.pricelistName === pricelistName);
    if (entries.length === 0) return null;
    const stockOf = (lotName?: string) => product.stockByLot.find((lot) => lot.lotName === lotName)?.quantity ?? 0;
    return [...entries].sort((a, b) => stockOf(b.lotName) - stockOf(a.lotName))[0].price;
}

export default function MsrpFinderPage() {
    const [query, setQuery] = useState("");
    const [searchResults, setSearchResults] = useState<CatalogProduct[]>([]);
    const [searching, setSearching] = useState(false);
    const [selected, setSelected] = useState<Map<number, CatalogProduct>>(new Map());
    const [pricelistName, setPricelistName] = useState("");

    const [retailers, setRetailers] = useState<string[]>([]);
    const [retailerInput, setRetailerInput] = useState("");
    const [retailerError, setRetailerError] = useState<string | null>(null);
    const [retailersLoaded, setRetailersLoaded] = useState(false);
    // Which retailers are switched off. Kept per browser, so each person chooses what they fetch
    // without changing the shared list for everyone else.
    const [disabledRetailers, setDisabledRetailers] = useState<string[]>([]);

    useEffect(() => {
        try {
            const saved = JSON.parse(localStorage.getItem(DISABLED_RETAILERS_KEY) ?? "[]") as unknown;
            if (Array.isArray(saved)) setDisabledRetailers(saved.map(String));
        } catch {
            // Storage unavailable — everything just stays switched on.
        }
    }, []);

    function saveDisabled(next: string[]) {
        try {
            localStorage.setItem(DISABLED_RETAILERS_KEY, JSON.stringify(next));
        } catch {
            // Not persisted, but the toggle still applies for this visit.
        }
        return next;
    }

    function toggleRetailer(url: string) {
        setDisabledRetailers((current) =>
            saveDisabled(current.includes(url) ? current.filter((entry) => entry !== url) : [...current, url])
        );
    }

    function setAllRetailers(enabled: boolean) {
        setDisabledRetailers(saveDisabled(enabled ? [] : [...retailers]));
    }

    const [checking, setChecking] = useState(false);
    const [results, setResults] = useState<MarketProductResult[] | null>(null);
    const [checkedAt, setCheckedAt] = useState<string | null>(null);
    const [activeHosts, setActiveHosts] = useState<string[]>([]);
    const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
    const [extensionState, setExtensionState] = useState<ExtensionState | "checking">("checking");
    const [error, setError] = useState<string | null>(null);
    const searchSeq = useRef(0);
    const [listOpen, setListOpen] = useState(false);
    const searchBoxRef = useRef<HTMLDivElement>(null);

    // The results list closes when you click anywhere outside the search box, or press Escape.
    useEffect(() => {
        function onPointerDown(event: MouseEvent) {
            if (searchBoxRef.current && !searchBoxRef.current.contains(event.target as Node)) setListOpen(false);
        }
        function onKeyDown(event: KeyboardEvent) {
            if (event.key === "Escape") setListOpen(false);
        }
        document.addEventListener("mousedown", onPointerDown);
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("mousedown", onPointerDown);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, []);

    useEffect(() => {
        void getExtensionState().then(setExtensionState);
    }, []);

    useEffect(() => {
        getMsrpRetailers()
            .then((response) => setRetailers(response.urls))
            .catch((loadError) => setRetailerError(loadError instanceof Error ? loadError.message : "Failed to load retailers."))
            .finally(() => setRetailersLoaded(true));
    }, []);

    // Debounced catalogue search; stale responses are dropped via searchSeq.
    useEffect(() => {
        const trimmed = query.trim();
        if (trimmed.length < 2) {
            setSearchResults([]);
            return;
        }
        const seq = ++searchSeq.current;
        const timer = setTimeout(async () => {
            setSearching(true);
            try {
                const response = await searchProductCatalog({ query: trimmed, limit: 24, evaluatePricelists: true });
                if (seq === searchSeq.current) setSearchResults(response.products);
            } catch (searchError) {
                if (seq === searchSeq.current) {
                    setError(searchError instanceof Error ? searchError.message : "Product search failed.");
                }
            } finally {
                if (seq === searchSeq.current) setSearching(false);
            }
        }, 350);
        return () => clearTimeout(timer);
    }, [query]);

    const selectedProducts = useMemo(() => [...selected.values()], [selected]);

    const pricelistOptions = useMemo(() => {
        const names = new Set<string>();
        for (const product of selectedProducts) {
            for (const entry of product.pricelists) names.add(entry.pricelistName);
        }
        return [...names].sort((a, b) => a.localeCompare(b));
    }, [selectedProducts]);

    const activePricelist = pricelistOptions.includes(pricelistName) ? pricelistName : (pricelistOptions[0] ?? "");

    function toggleProduct(product: CatalogProduct) {
        setSelected((current) => {
            const next = new Map(current);
            if (next.has(product.id)) next.delete(product.id);
            else next.set(product.id, product);
            return next;
        });
    }

    async function updateRetailers(change: () => Promise<{ urls: string[] }>) {
        setRetailerError(null);
        try {
            const saved = await change();
            setRetailers(saved.urls);
        } catch (saveError) {
            setRetailerError(saveError instanceof Error ? saveError.message : "Failed to save retailers.");
        }
    }

    function handleAddRetailer(event: FormEvent) {
        event.preventDefault();
        const value = retailerInput.trim();
        if (!value) return;
        setRetailerInput("");
        void updateRetailers(() => addMsrpRetailer(value));
    }

    async function handleCheck() {
        const state = await getExtensionState();
        setExtensionState(state);
        if (state !== "ready") {
            setError(
                state === "missing"
                    ? "The MSRP Finder Helper extension was not found. Install it first (see the notice above)."
                    : "The extension is installed but this site is not allowed yet. Click the extension icon and press 'Allow this site'."
            );
            return;
        }

        setChecking(true);
        setError(null);
        setProgress({ done: 0, total: selectedProducts.length * enabledRetailers.length });
        try {
            const response = await checkMarketPrices(
                selectedProducts.map((product) => ({ id: product.id, name: product.name, sku: product.sku, brand: product.brandName })),
                enabledRetailers,
                async (url, accept) => {
                    const host = hostLabel(url);
                    setActiveHosts((current) => [...current, host]);
                    try {
                        return await fetchViaExtension(url, accept);
                    } finally {
                        setActiveHosts((current) => {
                            const index = current.indexOf(host);
                            return index === -1 ? current : current.filter((_, i) => i !== index);
                        });
                    }
                },
                (done, total) => setProgress({ done, total })
            );
            setResults(response);
            setCheckedAt(new Date().toISOString());
        } catch (checkError) {
            setError(checkError instanceof Error ? checkError.message : "Failed to check market prices.");
        } finally {
            setChecking(false);
            setProgress(null);
            setActiveHosts([]);
        }
    }

    const enabledRetailers = retailers.filter((url) => !disabledRetailers.includes(url));
    const canCheck = selectedProducts.length > 0 && enabledRetailers.length > 0 && !checking;

    return (
        <section>
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="font-display text-3xl">MSRP Finder</h1>
                    <p className="mt-1 text-sm text-(--ink-soft)">
                        Compare your Odoo prices against current prices at UAE retailers.
                    </p>
                </div>
                <Tag className="h-8 w-8 text-(--brand)" aria-hidden="true" />
            </div>

            {extensionState === "ready" ? (
                <p className="mt-3 text-xs text-(--ink-soft)">
                    Helper extension is active.{" "}
                    <a href={EXTENSION_ZIP_URL} download className="underline">
                        Download it for another computer
                    </a>
                </p>
            ) : null}

            {extensionState === "missing" || extensionState === "not-allowed" ? (
                <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                    {extensionState === "missing" ? (
                        <>
                            <p className="font-medium">Install the MSRP Finder Helper extension (one time, about 1 minute)</p>
                            <p className="mt-1">
                                It reads retailer prices through your own Chrome, so protected shops work. Works in Chrome and Edge on a computer.
                            </p>
                            <a
                                href={EXTENSION_ZIP_URL}
                                download
                                className="mt-3 inline-flex items-center gap-2 rounded-xl bg-(--brand) px-4 py-2 font-medium text-white"
                            >
                                <Download className="h-4 w-4" aria-hidden="true" />
                                Download extension (.zip)
                            </a>
                            <ol className="mt-3 list-decimal space-y-1 pl-5">
                                <li>Unzip the downloaded file into a folder you will keep (Chrome loads it from there).</li>
                                <li>
                                    Open <code>chrome://extensions</code> and switch on <strong>Developer mode</strong> (top right).
                                </li>
                                <li>
                                    Click <strong>Load unpacked</strong> and select the unzipped folder.
                                </li>
                                <li>
                                    Come back to this page, click the extension icon (puzzle piece) and press <strong>Allow this site</strong>, then reload.
                                </li>
                            </ol>
                        </>
                    ) : (
                        <p>
                            The extension is installed but this site isn&apos;t allowed yet: click the extension icon and press
                            &quot;Allow this site&quot;, then reload.
                        </p>
                    )}
                </div>
            ) : null}

            <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
                <div className="min-w-0 space-y-6">
                    <div className="rounded-2xl border border-(--line) bg-(--card) p-5">
                        <h2 className="font-display text-xl">1. Select products</h2>
                        <div ref={searchBoxRef} className="mt-3">
                            <div className="relative">
                                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--ink-soft)" aria-hidden="true" />
                                <input
                                    value={query}
                                    onChange={(event) => {
                                        setQuery(event.target.value);
                                        setListOpen(true);
                                    }}
                                    onFocus={() => setListOpen(true)}
                                    placeholder="Search by name, size or SKU (min. 2 characters)"
                                    className="w-full rounded-xl border border-(--line) bg-white py-2 pl-9 pr-3"
                                />
                            </div>

                            {listOpen && searching ? <p className="mt-3 text-sm text-(--ink-soft)">Searching...</p> : null}
                            {listOpen && !searching && query.trim().length >= 2 && searchResults.length === 0 ? (
                                <p className="mt-3 text-sm text-(--ink-soft)">No products found.</p>
                            ) : null}

                            {listOpen && searchResults.length > 0 ? (
                                <div className="mt-3 overflow-hidden rounded-xl border border-(--line) bg-white">
                                    <ul className="max-h-72 divide-y divide-(--line) overflow-y-auto">
                                        {searchResults.map((product) => (
                                            <li key={product.id}>
                                                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-(--brand-soft)/30">
                                                    <input
                                                        type="checkbox"
                                                        checked={selected.has(product.id)}
                                                        onChange={() => toggleProduct(product)}
                                                    />
                                                    <span className="min-w-0 flex-1">
                                                        <span className="block truncate font-medium">{product.name}</span>
                                                        <span className="block truncate text-xs text-(--ink-soft)">
                                                            {[product.brandName, product.sku].filter(Boolean).join(" · ")}
                                                        </span>
                                                    </span>
                                                </label>
                                            </li>
                                        ))}
                                    </ul>
                                    <div className="flex items-center justify-between border-t border-(--line) bg-(--chip) px-3 py-2 text-xs text-(--ink-soft)">
                                        <span>{selectedProducts.length} selected</span>
                                        <button
                                            type="button"
                                            onClick={() => setListOpen(false)}
                                            className="rounded-lg bg-(--brand) px-3 py-1 font-medium text-white"
                                        >
                                            Done
                                        </button>
                                    </div>
                                </div>
                            ) : null}
                        </div>

                        {selectedProducts.length > 0 ? (
                            <div className="mt-4">
                                <p className="mb-2 text-sm font-medium">Selected ({selectedProducts.length})</p>
                                <div className="flex flex-wrap gap-2">
                                    {selectedProducts.map((product) => (
                                        <span
                                            key={product.id}
                                            className="inline-flex max-w-full items-center gap-1 rounded-full border border-(--line) bg-white px-3 py-1 text-xs"
                                        >
                                            <span className="truncate">{product.name}</span>
                                            <button
                                                type="button"
                                                onClick={() => toggleProduct(product)}
                                                aria-label={`Remove ${product.name}`}
                                            >
                                                <X className="h-3 w-3" aria-hidden="true" />
                                            </button>
                                        </span>
                                    ))}
                                </div>
                            </div>
                        ) : null}

                        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
                            <button
                                type="button"
                                onClick={() => void handleCheck()}
                                disabled={!canCheck}
                                className="rounded-xl bg-(--brand) px-5 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {checking ? "Checking prices..." : "Check Market Price"}
                            </button>
                            {pricelistOptions.length > 0 ? (
                                <label className="block text-sm">
                                    <span className="mb-1 block text-xs text-(--ink-soft)">Compare against Odoo pricelist</span>
                                    <select
                                        value={activePricelist}
                                        onChange={(event) => setPricelistName(event.target.value)}
                                        className="rounded-xl border border-(--line) bg-white px-3 py-2"
                                    >
                                        {pricelistOptions.map((name) => (
                                            <option key={name} value={name}>
                                                {name}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            ) : null}
                            {retailersLoaded && enabledRetailers.length === 0 ? (
                                <p className="text-sm text-(--ink-soft)">
                                    {retailers.length === 0 ? "Add at least one retailer on the right." : "Switch on at least one retailer on the right."}
                                </p>
                            ) : null}
                        </div>
                        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
                    </div>

                    {checking ? (
                        <div className="rounded-2xl border border-(--line) bg-(--card) p-4 text-sm">
                            <div className="flex items-center justify-between gap-3">
                                <p className="font-medium">
                                    Fetching prices{progress ? ` — ${progress.done}/${progress.total} done` : ""}
                                </p>
                            </div>
                            {progress && progress.total > 0 ? (
                                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-(--brand-soft)">
                                    <div
                                        className="h-full bg-(--brand) transition-all"
                                        style={{ width: `${(progress.done / progress.total) * 100}%` }}
                                    />
                                </div>
                            ) : null}
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                                <span className="text-xs text-(--ink-soft)">Now fetching from:</span>
                                {activeHosts.length === 0 ? (
                                    <span className="text-xs text-(--ink-soft)">...</span>
                                ) : (
                                    Array.from(new Set(activeHosts)).map((host) => (
                                        <span
                                            key={host}
                                            className="inline-flex items-center gap-2 rounded-full border border-(--line) bg-white px-3 py-1 text-xs font-medium"
                                        >
                                            <span className="h-2 w-2 animate-pulse rounded-full bg-(--brand)" aria-hidden="true" />
                                            {host}
                                        </span>
                                    ))
                                )}
                            </div>
                        </div>
                    ) : null}

                    {results ? (
                        <div className="space-y-4">
                            <div className="flex items-baseline justify-between gap-3">
                                <h2 className="font-display text-xl">Price comparison</h2>
                                {checkedAt ? (
                                    <p className="text-xs text-(--ink-soft)">Checked {checkedAt.replace("T", " ").slice(0, 16)} UTC</p>
                                ) : null}
                            </div>
                            {results.map((result) => {
                                const product = selected.get(result.productId);
                                if (!product) return null;
                                const ours = odooPrice(product, activePricelist);
                                const comparable = result.quotes.filter((quote) => quote.currency === "AED");
                                const prices = comparable.map((quote) => quote.price);
                                const lowest = prices.length > 0 ? Math.min(...prices) : null;
                                const average = prices.length > 0 ? prices.reduce((sum, value) => sum + value, 0) / prices.length : null;

                                return (
                                    <article key={result.productId} className="rounded-2xl border border-(--line) bg-(--card) p-5">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <h3 className="font-medium">{product.name}</h3>
                                            {ours !== null && lowest !== null ? (
                                                <span
                                                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                                                        ours > lowest ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"
                                                    }`}
                                                >
                                                    {ours > lowest
                                                        ? `Odoo is AED ${aed.format(ours - lowest)} above the lowest market price`
                                                        : "Odoo is at or below the lowest market price"}
                                                </span>
                                            ) : null}
                                        </div>
                                        <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
                                            <div>
                                                <dt className="text-xs text-(--ink-soft)">Odoo ({activePricelist || "n/a"})</dt>
                                                <dd className="font-medium">{ours !== null ? `AED ${aed.format(ours)}` : "-"}</dd>
                                            </div>
                                            <div>
                                                <dt className="text-xs text-(--ink-soft)">Lowest market</dt>
                                                <dd className="font-medium">{lowest !== null ? `AED ${aed.format(lowest)}` : "-"}</dd>
                                            </div>
                                            <div>
                                                <dt className="text-xs text-(--ink-soft)">Average market</dt>
                                                <dd className="font-medium">{average !== null ? `AED ${aed.format(average)}` : "-"}</dd>
                                            </div>
                                        </dl>
                                        {product.pricelists.length > 0 ? (
                                            <div className="mt-3 flex flex-wrap gap-2">
                                                {product.pricelists.map((entry) => (
                                                    <span
                                                        key={`${entry.pricelistName}|${entry.lotName ?? ""}`}
                                                        className={`rounded-full border px-3 py-1 text-xs ${
                                                            entry.pricelistName === activePricelist
                                                                ? "border-(--brand) bg-(--brand-soft)"
                                                                : "border-(--line) bg-white"
                                                        }`}
                                                    >
                                                        {entry.pricelistName}{entry.lotName ? ` · ${entry.lotName}` : ""}: AED {aed.format(entry.price)}
                                                    </span>
                                                ))}
                                            </div>
                                        ) : (
                                            <p className="mt-3 text-xs text-red-600">
                                                No Odoo pricelist price was found for this product.
                                            </p>
                                        )}

                                        {result.quotes.length > 0 ? (
                                            <div className="mt-4 overflow-x-auto">
                                                <table className="w-full text-left text-sm">
                                                    <thead className="text-xs text-(--ink-soft)">
                                                        <tr>
                                                            <th className="py-2 pr-3 font-medium">Retailer</th>
                                                            <th className="py-2 pr-3 font-medium">Listing</th>
                                                            <th className="py-2 pr-3 text-right font-medium">Price</th>
                                                            <th className="py-2 pr-3 text-right font-medium">Odoo vs market</th>
                                                            <th className="py-2 font-medium">Stock</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {[...result.quotes]
                                                            .sort((a, b) => a.price - b.price)
                                                            .map((quote) => {
                                                                const diff =
                                                                    ours !== null && quote.currency === "AED" ? ours - quote.price : null;
                                                                return (
                                                                    <tr key={quote.retailerUrl} className="border-t border-(--line)">
                                                                        <td className="py-2 pr-3 font-medium">{quote.retailer}</td>
                                                                        <td className="max-w-xs py-2 pr-3">
                                                                            <a
                                                                                href={quote.productUrl}
                                                                                target="_blank"
                                                                                rel="noopener noreferrer"
                                                                                className="inline-flex items-center gap-1 hover:underline"
                                                                            >
                                                                                <span className="truncate">{quote.title}</span>
                                                                                <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                                                                            </a>
                                                                            {quote.matchScore < 0.9 ? (
                                                                                <span className="mt-0.5 block text-xs text-amber-700">
                                                                                    Partial match — pattern/details differ, verify
                                                                                </span>
                                                                            ) : null}
                                                                        </td>
                                                                        <td className="whitespace-nowrap py-2 pr-3 text-right">
                                                                            {quote.currency} {aed.format(quote.price)}
                                                                        </td>
                                                                        <td className="whitespace-nowrap py-2 pr-3 text-right">
                                                                            {diff === null ? (
                                                                                "-"
                                                                            ) : (
                                                                                <span
                                                                                    className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                                                                                        diff > 0
                                                                                            ? "bg-red-100 text-red-700"
                                                                                            : "bg-green-100 text-green-700"
                                                                                    }`}
                                                                                >
                                                                                    {diff > 0 ? "▲ +" : diff < 0 ? "▼ " : "= "}
                                                                                    {aed.format(diff)} ({diff > 0 ? "+" : ""}
                                                                                    {((diff / quote.price) * 100).toFixed(1)}%)
                                                                                </span>
                                                                            )}
                                                                        </td>
                                                                        <td className="py-2">
                                                                            {quote.inStock === null ? "-" : quote.inStock ? "In stock" : "Out of stock"}
                                                                        </td>
                                                                    </tr>
                                                                );
                                                            })}
                                                    </tbody>
                                                </table>
                                            </div>
                                        ) : (
                                            <p className="mt-4 text-sm text-(--ink-soft)">No matching listing found at any retailer.</p>
                                        )}

                                        {result.errors.length > 0 ? (
                                            <p className="mt-3 text-xs text-(--ink-soft)">
                                                Could not read: {result.errors.map((entry) => `${entry.retailer} (${entry.message})`).join(", ")}
                                            </p>
                                        ) : null}
                                    </article>
                                );
                            })}
                            <p className="text-xs text-(--ink-soft)">
                                &quot;Odoo vs market&quot; is Odoo price minus retailer price: <span className="text-red-600">red</span> = Odoo is more expensive than the retailer, <span className="text-green-700">green</span> = Odoo is cheaper or equal.
                            </p>
                        </div>
                    ) : null}
                </div>

                <aside className="h-fit rounded-2xl border border-(--line) bg-(--card) p-5">
                    <h2 className="font-display text-xl">Retailers</h2>
                    <p className="mt-1 text-xs font-medium text-(--ink-soft)">
                        Shared list — everyone sees the same retailers. Switch a retailer off to skip it ({enabledRetailers.length} of {retailers.length} on, saved in this browser).
                    </p>
                    <p className="mt-1 text-xs text-(--ink-soft)">
                        Paste a retailer&apos;s website. If its search isn&apos;t auto-detected, use a search URL with{" "}
                        <code>{"{query}"}</code>, e.g. <code>{"https://shop.ae/search?q={query}"}</code>.
                    </p>

                    <form onSubmit={handleAddRetailer} className="mt-3 flex gap-2">
                        <input
                            value={retailerInput}
                            onChange={(event) => setRetailerInput(event.target.value)}
                            placeholder="https://www.retailer.ae"
                            className="min-w-0 flex-1 rounded-xl border border-(--line) bg-white px-3 py-2 text-sm"
                        />
                        <button
                            type="submit"
                            className="inline-flex items-center rounded-xl bg-(--brand) px-3 text-white"
                            aria-label="Add retailer"
                        >
                            <Plus className="h-4 w-4" aria-hidden="true" />
                        </button>
                    </form>
                    {retailerError ? <p className="mt-2 text-sm text-red-600">{retailerError}</p> : null}

                    {retailers.length > 1 ? (
                        <div className="mt-3 flex gap-2 text-xs">
                            <button
                                type="button"
                                onClick={() => setAllRetailers(true)}
                                disabled={enabledRetailers.length === retailers.length}
                                className="rounded-lg border border-(--line) bg-white px-3 py-1 font-medium disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                Enable all
                            </button>
                            <button
                                type="button"
                                onClick={() => setAllRetailers(false)}
                                disabled={enabledRetailers.length === 0}
                                className="rounded-lg border border-(--line) bg-white px-3 py-1 font-medium disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                Disable all
                            </button>
                        </div>
                    ) : null}

                    <ul className="mt-3 space-y-2">
                        {retailers.map((url) => (
                            <li
                                key={url}
                                className="flex items-center justify-between gap-2 rounded-xl border border-(--line) bg-white px-3 py-2 text-sm"
                            >
                                <button
                                    type="button"
                                    role="switch"
                                    aria-checked={!disabledRetailers.includes(url)}
                                    aria-label={`Fetch from ${hostLabel(url)}`}
                                    onClick={() => toggleRetailer(url)}
                                    className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                                        disabledRetailers.includes(url) ? "bg-gray-300" : "bg-green-500"
                                    }`}
                                >
                                    <span
                                        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
                                            disabledRetailers.includes(url) ? "left-0.5" : "left-[1.125rem]"
                                        }`}
                                    />
                                </button>
                                <span className={`min-w-0 flex-1 ${disabledRetailers.includes(url) ? "opacity-50" : ""}`}>
                                    <span className="block truncate font-medium">{hostLabel(url)}</span>
                                    <span className="block truncate text-xs text-(--ink-soft)">{url}</span>
                                </span>
                                <button
                                    type="button"
                                    onClick={() => void updateRetailers(() => removeMsrpRetailer(url))}
                                    aria-label={`Remove ${hostLabel(url)}`}
                                    className="text-(--ink-soft) hover:text-red-600"
                                >
                                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                                </button>
                            </li>
                        ))}
                        {retailersLoaded && retailers.length === 0 ? (
                            <li className="text-sm text-(--ink-soft)">No retailers yet.</li>
                        ) : null}
                    </ul>
                </aside>
            </div>
        </section>
    );
}
