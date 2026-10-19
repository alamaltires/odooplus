"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowDown, ArrowUp, ArrowUpDown, Check, ChevronDown, Download, FileSpreadsheet, Search, X } from "lucide-react";
import {
    getPriceListFilterOptions,
    getPriceListRequest,
    getPricelists,
    getProductBrands,
    getProductOrigins,
    type PriceListFilterOptions,
    type PriceListResponse,
    type PriceListRow,
    type PricelistOption,
} from "@/lib/client-odoo";

type Option = { id: number | string; name: string };
// Very long lists (lot numbers) only render the first matches; typing narrows them.
const MAX_SHOWN = 200;
// 0 means "show all".
const PAGE_SIZES = [25, 50, 100, 250, 0];

/** A searchable dropdown with tick boxes; the picks show as removable chips underneath. */
function MultiPick({
    label,
    hint,
    tone,
    options,
    value,
    onChange,
}: {
    label: string;
    hint: string;
    tone: "include" | "exclude";
    options: Option[];
    value: Array<number | string>;
    onChange: (next: Array<number | string>) => void;
}) {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        function onDown(event: MouseEvent) {
            if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
        }
        function onKey(event: KeyboardEvent) {
            if (event.key === "Escape") setOpen(false);
        }
        document.addEventListener("mousedown", onDown);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("mousedown", onDown);
            document.removeEventListener("keydown", onKey);
        };
    }, [open]);

    const filtered = useMemo(() => {
        const query = search.trim().toLowerCase();
        return query ? options.filter((option) => option.name.toLowerCase().includes(query)) : options;
    }, [options, search]);
    const chipTone = tone === "include" ? "bg-[rgba(74,184,72,0.14)] text-emerald-800" : "bg-[rgba(229,26,39,0.1)] text-(--brand)";
    const picked = useMemo(() => {
        const byId = new Map(options.map((option) => [option.id, option]));
        return value.map((id) => byId.get(id) ?? { id, name: String(id) });
    }, [options, value]);

    return (
        <div ref={ref} className="relative">
            <p className="mb-1 text-sm font-medium">{label}</p>
            <button
                type="button"
                onClick={() => setOpen((current) => !current)}
                className="flex w-full items-center justify-between gap-2 rounded-xl border border-(--line) bg-white px-3 py-2 text-left text-sm"
                aria-expanded={open}
            >
                <span className={value.length === 0 ? "text-(--ink-soft)" : "font-medium"}>{value.length === 0 ? hint : `${value.length} selected`}</span>
                <ChevronDown className={`h-4 w-4 text-(--ink-soft) transition ${open ? "rotate-180" : ""}`} aria-hidden="true" />
            </button>

            {open ? (
                <div className="absolute inset-x-0 z-30 mt-1 overflow-hidden rounded-xl border border-(--line) bg-white shadow-lg">
                    <div className="relative border-b border-(--line) p-2">
                        <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-(--ink-soft)" aria-hidden="true" />
                        <input
                            autoFocus
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Search..."
                            className="w-full rounded-lg border border-(--line) py-1.5 pl-8 pr-3 text-sm focus:outline-none"
                        />
                    </div>
                    <ul className="max-h-60 overflow-x-hidden overflow-y-auto p-1">
                        {filtered.length === 0 ? <li className="px-3 py-2 text-sm text-(--ink-soft)">No matches.</li> : null}
                        {filtered.slice(0, MAX_SHOWN).map((option) => {
                            const checked = value.includes(option.id);
                            return (
                                <li key={option.id}>
                                    <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm hover:bg-(--chip)">
                                        <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={() => onChange(checked ? value.filter((id) => id !== option.id) : [...value, option.id])}
                                            className="h-4 w-4 rounded border-(--line)"
                                        />
                                        <span className="min-w-0 break-words">{option.name}</span>
                                    </label>
                                </li>
                            );
                        })}
                        {filtered.length > MAX_SHOWN ? (
                            <li className="px-3 py-2 text-center text-xs text-(--ink-soft)">
                                Showing {MAX_SHOWN} of {filtered.length.toLocaleString("en-US")} — keep typing to narrow down.
                            </li>
                        ) : null}
                    </ul>
                </div>
            ) : null}

            {picked.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                    {picked.map((option) => (
                        <span key={option.id} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${chipTone}`}>
                            {option.name}
                            <button type="button" onClick={() => onChange(value.filter((id) => id !== option.id))} aria-label={`Remove ${option.name}`}>
                                <X className="h-3 w-3" aria-hidden="true" />
                            </button>
                        </span>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

const RULE_COMPUTE: Record<string, string> = { fixed: "fixed price", percentage: "percentage discount", formula: "formula" };
const RULE_APPLIED: Record<string, string> = {
    "0_product_variant": "a product variant",
    "1_product": "a product template",
    "2_product_category": "a category",
    "3_global": "all products",
};

function lotLabel(row: PriceListRow) {
    if (!row.lotName) return "";
    return row.lotYear ? `${row.lotName} (${row.lotYear})` : row.lotName;
}

function formatPrice(value: number | null | undefined) {
    return value === null || value === undefined ? "-" : value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function PriceListRequest() {
    const [brands, setBrands] = useState<Option[]>([]);
    const [origins, setOrigins] = useState<Option[]>([]);
    const [pricelists, setPricelists] = useState<PricelistOption[]>([]);
    const [optionsError, setOptionsError] = useState<string | null>(null);
    const [listsLoaded, setListsLoaded] = useState(false);

    const [filterOptions, setFilterOptions] = useState<PriceListFilterOptions | null>(null);
    const [brandIds, setBrandIds] = useState<Array<number | string>>([]);
    const [excludeBrandIds, setExcludeBrandIds] = useState<Array<number | string>>([]);
    const [originIds, setOriginIds] = useState<Array<number | string>>([]);
    const [excludeOriginIds, setExcludeOriginIds] = useState<Array<number | string>>([]);
    const [categoryIds, setCategoryIds] = useState<Array<number | string>>([]);
    const [excludeCategoryIds, setExcludeCategoryIds] = useState<Array<number | string>>([]);
    const [oeValues, setOeValues] = useState<Array<number | string>>([]);
    const [excludeOeValues, setExcludeOeValues] = useState<Array<number | string>>([]);
    const lotOptions = useMemo(() => (filterOptions?.lots ?? []).map((name) => ({ id: name, name })), [filterOptions]);
    const [lotNames, setLotNames] = useState<Array<number | string>>([]);
    const [excludeLotNames, setExcludeLotNames] = useState<Array<number | string>>([]);
    const [pricelistIds, setPricelistIds] = useState<number[]>([]);
    const [hideOutOfStock, setHideOutOfStock] = useState(true);
    const [hideUnpriced, setHideUnpriced] = useState(true);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<PriceListResponse | null>(null);
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(50);
    // null = the order Odoo data came in (brand, then product). The same order is used for the Excel file.
    const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);
    const [exporting, setExporting] = useState(false);

    // Each list loads on its own, so one failing never hides the others (the pricelists in particular).
    useEffect(() => {
        const failures: string[] = [];
        const report = (what: string, reason: unknown) =>
            failures.push(`${what}: ${reason instanceof Error ? reason.message : "failed to load"}`);
        Promise.allSettled([getProductBrands(), getProductOrigins(), getPricelists(), getPriceListFilterOptions()]).then(([brandData, originData, listData, extraData]) => {
            if (brandData.status === "fulfilled") setBrands(brandData.value.brands);
            else report("Brands", brandData.reason);
            if (originData.status === "fulfilled") setOrigins(originData.value.origins);
            else report("Origins", originData.reason);
            if (listData.status === "fulfilled") setPricelists(listData.value.pricelists);
            else report("Pricelists", listData.reason);
            if (extraData.status === "fulfilled") setFilterOptions(extraData.value);
            else report("Categories / OE / lots", extraData.reason);
            setListsLoaded(true);
            if (failures.length > 0) setOptionsError(failures.join(" · "));
        });
    }, []);

    async function generate() {
        if (pricelistIds.length === 0) {
            setError("Choose at least one pricelist.");
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const numbers = (values: Array<number | string>) => values.map(Number);
            const data = await getPriceListRequest({
                brandIds: numbers(brandIds),
                excludeBrandIds: numbers(excludeBrandIds),
                originIds: numbers(originIds),
                excludeOriginIds: numbers(excludeOriginIds),
                categoryIds: numbers(categoryIds),
                excludeCategoryIds: numbers(excludeCategoryIds),
                oeValues,
                excludeOeValues,
                lotNames: lotNames.map(String),
                excludeLotNames: excludeLotNames.map(String),
                pricelistIds,
                inStockOnly: hideOutOfStock,
                onlyPriced: hideUnpriced,
            });
            setResult(data);
            setPage(1);
            setSearch("");
        } catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : "Failed to build the price list.");
        } finally {
            setLoading(false);
        }
    }

    const shownRows = useMemo(() => {
        if (!result) return [];
        const query = search.trim().toLowerCase();
        const filtered = query ? result.rows.filter((row) => `${row.searchName} ${row.name} ${row.category} ${row.brand} ${row.origin} ${row.pattern} ${row.rim} ${row.lotName} ${row.lotYear}`.toLowerCase().includes(query)) : result.rows;
        if (!sort) return filtered;

        const text = (row: PriceListRow): string | number | null => {
            switch (sort.key) {
                case "searchName": return row.searchName;
                case "name": return row.name;
                case "category": return row.category;
                case "brand": return row.brand;
                case "origin": return row.origin;
                case "pattern": return row.pattern;
                case "rim": return row.rim;
                case "lot": return row.lotName;
                case "available": return row.available;
                default: return sort.key.startsWith("price:") ? row.prices[sort.key.slice(6)] ?? null : "";
            }
        };
        const factor = sort.dir === "asc" ? 1 : -1;
        return [...filtered].sort((a, b) => {
            const left = text(a);
            const right = text(b);
            // Empty values always go last, whichever way it is sorted.
            if (left === null || left === "") return right === null || right === "" ? 0 : 1;
            if (right === null || right === "") return -1;
            if (typeof left === "number" && typeof right === "number") return (left - right) * factor;
            return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" }) * factor;
        });
    }, [result, search, sort]);
    const pageCount = pageSize === 0 ? 1 : Math.max(1, Math.ceil(shownRows.length / pageSize));
    const currentPage = Math.min(page, pageCount);
    const pageRows = pageSize === 0 ? shownRows : shownRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
    const firstShown = shownRows.length === 0 ? 0 : (currentPage - 1) * (pageSize === 0 ? 0 : pageSize) + 1;
    const lastShown = firstShown === 0 ? 0 : firstShown - 1 + pageRows.length;

    // First, last, and a window of pages around the current one.
    const pageNumbers = (() => {
        const numbers = new Set<number>([1, pageCount, currentPage - 1, currentPage, currentPage + 1]);
        if (currentPage <= 3) [2, 3, 4].forEach((n) => numbers.add(n));
        if (currentPage >= pageCount - 2) [pageCount - 1, pageCount - 2, pageCount - 3].forEach((n) => numbers.add(n));
        const sorted = Array.from(numbers).filter((n) => n >= 1 && n <= pageCount).sort((a, b) => a - b);
        const out: Array<number | "gap"> = [];
        sorted.forEach((n, index) => {
            if (index > 0 && n - sorted[index - 1] > 1) out.push("gap");
            out.push(n);
        });
        return out;
    })();

    function sortBy(key: string) {
        setSort((current) => (current?.key !== key ? { key, dir: "asc" } : current.dir === "asc" ? { key, dir: "desc" } : null));
        setPage(1);
    }

    const sortHeader = (key: string, label: string, align: "left" | "right" = "left") => (
        <th
            key={key}
            aria-sort={sort?.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
            className={`whitespace-nowrap border border-(--line) p-0 font-medium ${align === "right" ? "text-right" : ""}`}
        >
            <button
                type="button"
                onClick={() => sortBy(key)}
                className={`flex w-full items-center gap-1 px-3 py-2 transition hover:bg-white/70 hover:text-(--ink) ${align === "right" ? "justify-end" : ""} ${sort?.key === key ? "text-(--brand)" : ""}`}
                title="Click to sort; click again to reverse, and a third time to clear"
            >
                {label}
                {sort?.key === key ? (
                    sort.dir === "asc" ? <ArrowUp className="h-3 w-3" aria-hidden="true" /> : <ArrowDown className="h-3 w-3" aria-hidden="true" />
                ) : (
                    <ArrowUpDown className="h-3 w-3 opacity-40" aria-hidden="true" />
                )}
            </button>
        </th>
    );

    const priceHeader = (list: PricelistOption) => (list.currency ? `${list.name} (${list.currency})` : list.name);

    async function download() {
        if (!result || shownRows.length === 0) return;
        setExporting(true);
        try {
            const XLSX = await import("xlsx");
            const sheetRows = shownRows.map((row: PriceListRow) => {
                const out: Record<string, string | number> = {
                    "Search Name": row.searchName,
                    Product: row.name,
                    Category: row.category,
                    Brand: row.brand,
                    Origin: row.origin,
                    Pattern: row.pattern,
                    Rim: row.rim,
                    Year: row.lotYear,
                    "Available Qty": row.available,
                };
                for (const list of result.pricelists) out[priceHeader(list)] = row.prices[String(list.id)] ?? "";
                return out;
            });
            const worksheet = XLSX.utils.json_to_sheet(sheetRows);
            worksheet["!cols"] = [{ wch: 24 }, { wch: 46 }, { wch: 18 }, { wch: 16 }, { wch: 14 }, { wch: 18 }, { wch: 8 }, { wch: 8 }, { wch: 12 }, ...result.pricelists.map(() => ({ wch: 18 }))];
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, "Price List");
            XLSX.writeFile(workbook, `price-list-${new Date().toISOString().slice(0, 10)}.xlsx`);
        } catch (exportError) {
            setError(exportError instanceof Error ? exportError.message : "Failed to create the Excel file.");
        } finally {
            setExporting(false);
        }
    }

    return (
        <div className="space-y-4">
            <div className="rounded-2xl border border-(--line) bg-(--card) p-5">
                <div className="flex items-start gap-3">
                    <FileSpreadsheet className="mt-0.5 h-5 w-5 shrink-0 text-(--brand)" aria-hidden="true" />
                    <div>
                        <h2 className="font-display text-xl">Price List Request</h2>
                        <p className="mt-1 text-sm text-(--ink-soft)">
                            Pick what the customer should see, choose the Odoo pricelists to show, check the result here, then download it as Excel.
                        </p>
                    </div>
                </div>

                {optionsError ? <p className="mt-3 text-sm text-red-600">{optionsError}</p> : null}

                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                    <MultiPick label="Brands" hint="All brands" tone="include" options={brands} value={brandIds} onChange={setBrandIds} />
                    <MultiPick label="Exclude brands" hint="None excluded" tone="exclude" options={brands} value={excludeBrandIds} onChange={setExcludeBrandIds} />
                    <MultiPick label="Origin" hint="All origins" tone="include" options={origins} value={originIds} onChange={setOriginIds} />
                    <MultiPick label="Exclude origin" hint="None excluded" tone="exclude" options={origins} value={excludeOriginIds} onChange={setExcludeOriginIds} />
                    <MultiPick label="Category" hint="All categories" tone="include" options={filterOptions?.categories ?? []} value={categoryIds} onChange={setCategoryIds} />
                    <MultiPick label="Exclude category" hint="None excluded" tone="exclude" options={filterOptions?.categories ?? []} value={excludeCategoryIds} onChange={setExcludeCategoryIds} />
                    {filterOptions && !filterOptions.oe ? (
                        <p className="rounded-xl bg-(--chip) px-3 py-2 text-xs text-(--ink-soft) sm:col-span-2">
                            The &ldquo;OE Specifications&rdquo; field was not found on products in Odoo, so that filter is not available.
                        </p>
                    ) : (
                        <>
                            <MultiPick label={filterOptions?.oe?.label ?? "OE Specifications"} hint="Any" tone="include" options={filterOptions?.oe?.options ?? []} value={oeValues} onChange={setOeValues} />
                            <MultiPick label={`Exclude ${filterOptions?.oe?.label ?? "OE Specifications"}`} hint="None excluded" tone="exclude" options={filterOptions?.oe?.options ?? []} value={excludeOeValues} onChange={setExcludeOeValues} />
                        </>
                    )}
                    <MultiPick label="Lot" hint="All lots" tone="include" options={lotOptions} value={lotNames} onChange={setLotNames} />
                    <MultiPick label="Exclude lot" hint="None excluded" tone="exclude" options={lotOptions} value={excludeLotNames} onChange={setExcludeLotNames} />
                </div>

                <div className="mt-5">
                    <p className="mb-1.5 text-sm font-medium">
                        Pricelists <span className="text-(--brand)" aria-hidden="true">*</span>
                        <span className="ml-1.5 text-xs font-normal text-(--ink-soft)">each one becomes a price column</span>
                    </p>
                    {!listsLoaded ? <p className="text-sm text-(--ink-soft)">Loading pricelists...</p> : null}
                    {listsLoaded && pricelists.length === 0 ? (
                        <p className="text-sm text-(--ink-soft)">No pricelists were found for the selected companies.</p>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                        {pricelists.map((list) => {
                            const checked = pricelistIds.includes(list.id);
                            return (
                                <button
                                    key={list.id}
                                    type="button"
                                    onClick={() => setPricelistIds(checked ? pricelistIds.filter((id) => id !== list.id) : [...pricelistIds, list.id])}
                                    aria-pressed={checked}
                                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition ${
                                        checked ? "border-(--brand) bg-[rgba(229,26,39,0.08)] font-medium text-(--brand)" : "border-(--line) bg-white hover:bg-(--chip)"
                                    }`}
                                >
                                    {checked ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                                    {list.name}
                                    {list.currency ? <span className="text-xs opacity-70">{list.currency}</span> : null}
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-(--line) pt-4">
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                        <label className="inline-flex cursor-pointer items-center gap-2">
                            <input type="checkbox" checked={hideOutOfStock} onChange={(event) => setHideOutOfStock(event.target.checked)} className="h-4 w-4 rounded border-(--line)" />
                            Hide out of stock products
                        </label>
                        <label className="inline-flex cursor-pointer items-center gap-2">
                            <input type="checkbox" checked={hideUnpriced} onChange={(event) => setHideUnpriced(event.target.checked)} className="h-4 w-4 rounded border-(--line)" />
                            Hide products without list prices
                        </label>
                    </div>
                    <button
                        type="button"
                        onClick={() => void generate()}
                        disabled={loading}
                        className="rounded-xl bg-(--brand) px-5 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-70"
                    >
                        {loading ? "Building..." : "Show price list"}
                    </button>
                </div>
                {error ? (
                    <p className="mt-3 flex items-start gap-2 text-sm text-red-600">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {error}
                    </p>
                ) : null}
            </div>

            {result ? (
                <div className={`rounded-2xl border border-(--line) bg-(--card) p-5 transition-opacity ${loading ? "opacity-60" : ""}`}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-sm text-(--ink-soft)">
                            <span className="font-semibold text-(--ink)">{shownRows.length.toLocaleString("en-US")}</span> product{shownRows.length === 1 ? "" : "s"}
                            {search.trim() ? " match your search" : ""}.
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                            <div className="relative">
                                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-(--ink-soft)" aria-hidden="true" />
                                <input
                                    value={search}
                                    onChange={(event) => {
                                        setSearch(event.target.value);
                                        setPage(1);
                                    }}
                                    placeholder="Filter this list"
                                    className="w-48 rounded-xl border border-(--line) bg-white py-2 pl-8 pr-3 text-sm"
                                />
                            </div>
                            <button
                                type="button"
                                onClick={() => void download()}
                                disabled={exporting || shownRows.length === 0}
                                className="inline-flex items-center gap-2 rounded-xl bg-(--accent) px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                <Download className="h-4 w-4" aria-hidden="true" />
                                {exporting ? "Preparing..." : "Download Excel"}
                            </button>
                        </div>
                    </div>
                    {result.rows.length > 0 && result.diagnostics.rowsWithPrice < result.rows.length ? (
                        <details className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900" open={result.diagnostics.rowsWithPrice === 0}>
                            <summary className="cursor-pointer font-medium">
                                {result.diagnostics.rowsWithPrice === 0
                                    ? "No prices were found. Here is what the selected pricelists contain:"
                                    : `${(result.rows.length - result.diagnostics.rowsWithPrice).toLocaleString("en-US")} rows have no price. Details:`}
                            </summary>
                            <ul className="mt-2 list-disc space-y-0.5 pl-5">
                                {result.diagnostics.ruleTypes.length === 0 ? <li>The selected pricelists have no rules at all.</li> : null}
                                {result.diagnostics.ruleTypes.map((rule) => (
                                    <li key={`${rule.computePrice}-${rule.appliedOn}`}>
                                        {rule.count.toLocaleString("en-US")} rule{rule.count === 1 ? "" : "s"}: {RULE_COMPUTE[rule.computePrice] ?? rule.computePrice}, applied on {RULE_APPLIED[rule.appliedOn] ?? rule.appliedOn}
                                    </li>
                                ))}
                                <li>
                                    Used for these products: {result.diagnostics.matchedRules.toLocaleString("en-US")} fixed-price rules ({result.diagnostics.lotRules.toLocaleString("en-US")} for a specific lot).
                                </li>
                                {result.diagnostics.skippedQuantityBreaks > 0 ? <li>{result.diagnostics.skippedQuantityBreaks.toLocaleString("en-US")} skipped: minimum quantity above 1.</li> : null}
                                {result.diagnostics.skippedDates > 0 ? <li>{result.diagnostics.skippedDates.toLocaleString("en-US")} skipped: outside their start/end dates.</li> : null}
                            </ul>
                            <p className="mt-2">Only fixed-price rules applied on a product, a template or a lot are read; percentage, formula, category and global rules are not.</p>
                        </details>
                    ) : null}
                    {result.truncated ? (
                        <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
                            More than 5,000 products matched; only the first 5,000 are listed. Narrow the brands or origins to get all of them.
                        </p>
                    ) : null}

                    {shownRows.length > 0 ? (
                        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                            <p className="text-xs text-(--ink-soft)">
                                Showing {firstShown.toLocaleString("en-US")}&ndash;{lastShown.toLocaleString("en-US")} of {shownRows.length.toLocaleString("en-US")}. The Excel file always contains all of them.
                            </p>
                            <div className="flex flex-wrap items-center justify-end gap-3 text-xs">
                                <label className="inline-flex items-center gap-2 text-(--ink-soft)">
                                    Show
                                    <select
                                        value={pageSize}
                                        onChange={(event) => {
                                            setPageSize(Number(event.target.value));
                                            setPage(1);
                                        }}
                                        className="rounded-lg border border-(--line) bg-white px-2 py-1.5 text-(--ink)"
                                    >
                                        {PAGE_SIZES.map((size) => (
                                            <option key={size} value={size}>
                                                {size === 0 ? "All" : size}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                {pageCount > 1 ? (
                                    <nav className="inline-flex items-center gap-1" aria-label="Pagination">
                                        <button
                                            type="button"
                                            onClick={() => setPage(currentPage - 1)}
                                            disabled={currentPage <= 1}
                                            className="rounded-lg border border-(--line) bg-white px-2.5 py-1.5 font-medium disabled:cursor-not-allowed disabled:opacity-40"
                                        >
                                            Prev
                                        </button>
                                        {pageNumbers.map((entry, index) =>
                                            entry === "gap" ? (
                                                <span key={`gap-${index}`} className="px-1 text-(--ink-soft)">
                                                    &hellip;
                                                </span>
                                            ) : (
                                                <button
                                                    key={entry}
                                                    type="button"
                                                    onClick={() => setPage(entry)}
                                                    aria-current={entry === currentPage ? "page" : undefined}
                                                    className={`min-w-8 rounded-lg border px-2 py-1.5 font-medium transition ${entry === currentPage ? "border-(--brand) bg-(--brand) text-white shadow-sm" : "border-(--line) bg-white hover:bg-(--chip)"}`}
                                                >
                                                    {entry}
                                                </button>
                                            )
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => setPage(currentPage + 1)}
                                            disabled={currentPage >= pageCount}
                                            className="rounded-lg border border-(--line) bg-white px-2.5 py-1.5 font-medium disabled:cursor-not-allowed disabled:opacity-40"
                                        >
                                            Next
                                        </button>
                                    </nav>
                                ) : null}
                            </div>
                        </div>
                    ) : null}

                    {shownRows.length === 0 ? (
                        <p className="mt-4 rounded-xl border border-dashed border-(--line) p-8 text-center text-sm text-(--ink-soft)">
                            No products matched these filters and pricelists.
                        </p>
                    ) : (
                        <div className="mt-4 overflow-x-auto rounded-xl border border-(--line)">
                            <table className="min-w-full border-collapse text-left text-sm">
                                <thead className="bg-(--chip) text-xs text-(--ink-soft)">
                                    <tr>
                                        {sortHeader("searchName", "Search name")}
                                        {sortHeader("name", "Product")}
                                        {sortHeader("category", "Category")}
                                        {sortHeader("brand", "Brand")}
                                        {sortHeader("origin", "Origin")}
                                        {sortHeader("pattern", "Pattern")}
                                        {sortHeader("rim", "Rim")}
                                        {sortHeader("lot", "Lot (Year)")}
                                        {sortHeader("available", "Available", "right")}
                                        {result.pricelists.map((list) => sortHeader(`price:${list.id}`, priceHeader(list), "right"))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {pageRows.map((row) => (
                                        <tr key={row.key} className="hover:bg-(--chip)/40">
                                            <td className="whitespace-nowrap border border-(--line)/70 px-3 py-2 text-(--ink-soft)">{row.searchName || "-"}</td>
                                            <td className="border border-(--line)/70 px-3 py-2 font-medium">{row.name}</td>
                                            <td className="whitespace-nowrap border border-(--line)/70 px-3 py-2">{row.category || "-"}</td>
                                            <td className="whitespace-nowrap border border-(--line)/70 px-3 py-2">{row.brand || "-"}</td>
                                            <td className="whitespace-nowrap border border-(--line)/70 px-3 py-2">{row.origin || "-"}</td>
                                            <td className="whitespace-nowrap border border-(--line)/70 px-3 py-2">{row.pattern || "-"}</td>
                                            <td className="whitespace-nowrap border border-(--line)/70 px-3 py-2">{row.rim || "-"}</td>
                                            <td className="whitespace-nowrap border border-(--line)/70 px-3 py-2">
                                                {row.lotName ? (
                                                    <span className="inline-flex items-center gap-1 rounded-full border border-[rgba(229,26,39,0.25)] bg-[rgba(229,26,39,0.08)] px-2.5 py-0.5 text-xs font-semibold text-(--brand)">
                                                        {lotLabel(row)}
                                                    </span>
                                                ) : (
                                                    "-"
                                                )}
                                            </td>
                                            <td className="whitespace-nowrap border border-(--line)/70 px-3 py-2 text-right font-semibold tabular-nums text-(--accent)">
                                                {row.available.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                                            </td>
                                            {result.pricelists.map((list) => (
                                                <td key={list.id} className="whitespace-nowrap border border-(--line)/70 px-3 py-2 text-right tabular-nums">
                                                    {formatPrice(row.prices[String(list.id)])}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                </div>
            ) : null}
        </div>
    );
}
