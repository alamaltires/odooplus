"use client";

import { useEffect, useMemo, useState } from "react";
import {
    CheckCircle2,
    Copy,
    LayoutGrid,
    List,
    Minus,
    Package,
    Plus,
    Search,
    SlidersHorizontal,
    ShoppingCart,
    Trash2,
    X,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import {
    createSalesQuotation,
    getCustomers,
    getLotNames,
    getPatternImages,
    getProductBrands,
    getProductCategories,
    getProductOrigins,
    getRimDiameters,
    getTirePatterns,
    searchSalesStock,
    type SalesStockFilters,
    type ProductRequestType,
    type SalesStockRow,
} from "@/lib/client-odoo";
import { Select2, type Select2Option } from "@/components/select2";

const MIN_SEARCH_QUERY_LENGTH = 2;
const PAGE_SIZE = 30;
const CART_STORAGE_KEY = "odoopp:salesCart";
const VIEW_STORAGE_KEY = "odoopp:salesView";

type CartLine = {
    quantId: number;
    productId: number;
    productName: string;
    lotName: string;
    location: string;
    companyId: number | null;
    companyName: string;
    availableQty: number;
    retailPrice: number | null;
    qty: number;
};

type ViewMode = "cards" | "list";

type SmartFilterValues = {
    category: string;
    brand: string;
    rim: string;
    lot: string;
    origin: string;
    pattern: string;
};

const EMPTY_SMART_FILTERS: SmartFilterValues = { category: "", brand: "", rim: "", lot: "", origin: "", pattern: "" };

type SmartOptions = Record<keyof SmartFilterValues, Select2Option[]>;

const SMART_FIELDS: Array<{ key: keyof SmartFilterValues; label: string }> = [
    { key: "category", label: "Category" },
    { key: "brand", label: "Brand" },
    { key: "rim", label: "Rim Size" },
    { key: "lot", label: "Lot" },
    { key: "origin", label: "Origin" },
    { key: "pattern", label: "Pattern" },
];

function readStorage<T>(key: string, fallback: T): T {
    try {
        const raw = window.localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
        return fallback;
    }
}

function writeStorage(key: string, value: unknown) {
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Storage can be unavailable (private window) — the cart just won't persist.
    }
}

function formatQty(value: number | null) {
    return value === null ? "-" : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatMoney(value: number | null) {
    return value === null ? "-" : value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function SalesStockBrowser({
    query,
    onQueryChange,
    onRequest,
    onRequestFromRow,
}: {
    query: string;
    onQueryChange: (value: string) => void;
    onRequest: (type?: ProductRequestType) => void;
    onRequestFromRow: (row: SalesStockRow) => void;
}) {
    const { role } = useAuth();
    // Same rule as the sales targets page: salespeople don't see cost/margin data.
    const showCosts = role !== "salesperson";

    const [view, setView] = useState<ViewMode>("list");
    const [rows, setRows] = useState<SalesStockRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [hasMore, setHasMore] = useState(false);
    const [totalCount, setTotalCount] = useState(0);
    const [unresolved, setUnresolved] = useState<string[]>([]);
    // Smart Search: `smartDraft` is what's being edited in the modal,
    // `smartApplied` is what the search actually uses.
    const [smartOpen, setSmartOpen] = useState(false);
    const [smartDraft, setSmartDraft] = useState<SmartFilterValues>(EMPTY_SMART_FILTERS);
    const [smartApplied, setSmartApplied] = useState<SmartFilterValues>(EMPTY_SMART_FILTERS);
    const [smartPatternName, setSmartPatternName] = useState<string | null>(null);
    const [smartOptions, setSmartOptions] = useState<SmartOptions | null>(null);
    const [smartLoading, setSmartLoading] = useState(false);
    const [smartError, setSmartError] = useState<string | null>(null);
    const [copiedId, setCopiedId] = useState<number | null>(null);
    // Pattern images (tire.pattern.image_512) by pattern id; an id mapped to ""
    // means "looked up, no image" so it isn't requested again.
    const [patternImages, setPatternImages] = useState<Record<number, string>>({});

    const [cart, setCart] = useState<CartLine[]>([]);
    const [cartLoaded, setCartLoaded] = useState(false);
    const [cartOpen, setCartOpen] = useState(false);
    const [customers, setCustomers] = useState<Select2Option[]>([]);
    const [customersLoading, setCustomersLoading] = useState(false);
    const [customerId, setCustomerId] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [created, setCreated] = useState<Array<{ id: number; name: string; companyName: string }> | null>(null);

    useEffect(() => {
        setView(readStorage<ViewMode>(VIEW_STORAGE_KEY, "list"));
        setCart(readStorage<CartLine[]>(CART_STORAGE_KEY, []));
        setCartLoaded(true);
    }, []);

    useEffect(() => {
        if (cartLoaded) writeStorage(CART_STORAGE_KEY, cart);
    }, [cart, cartLoaded]);

    function changeView(next: ViewMode) {
        setView(next);
        writeStorage(VIEW_STORAGE_KEY, next);
    }

    const trimmed = query.trim();
    const activeSmartCount = Object.values(smartApplied).filter(Boolean).length;
    const canSearch = trimmed.length >= MIN_SEARCH_QUERY_LENGTH || activeSmartCount > 0;

    const smartFilters = useMemo<SalesStockFilters>(() => {
        return {
            categoryId: smartApplied.category ? Number(smartApplied.category) : null,
            brandId: smartApplied.brand ? Number(smartApplied.brand) : null,
            rimId: smartApplied.rim ? Number(smartApplied.rim) : null,
            originId: smartApplied.origin ? Number(smartApplied.origin) : null,
            patternId: smartApplied.pattern ? Number(smartApplied.pattern) : null,
            patternName: smartApplied.pattern ? smartPatternName : null,
            lotName: smartApplied.lot || null,
        };
    }, [smartApplied, smartPatternName]);

    useEffect(() => {
        if (!smartOpen || smartOptions || smartLoading) return;
        setSmartLoading(true);
        setSmartError(null);
        Promise.all([
            getProductCategories(),
            getProductBrands(),
            getRimDiameters(),
            getLotNames(),
            getProductOrigins(),
            getTirePatterns(),
        ])
            .then(([categories, brands, rims, lots, origins, patterns]) => {
                setSmartOptions({
                    category: categories.categories.map((item) => ({ value: String(item.id), label: item.name })),
                    brand: brands.brands.map((item) => ({ value: String(item.id), label: item.name })),
                    rim: rims.rimDiameters.map((item) => ({ value: String(item.id), label: item.name })),
                    lot: lots.lots.map((name) => ({ value: name, label: name })),
                    origin: origins.origins.map((item) => ({ value: String(item.id), label: item.name })),
                    // `description` carries the plain pattern name, used when the
                    // product's pattern field is text rather than a link.
                    pattern: patterns.patterns.map((item) => ({
                        value: String(item.id),
                        label: item.brandName ? `${item.name} (${item.brandName})` : item.name,
                        description: item.name,
                    })),
                });
            })
            .catch((loadError) => setSmartError(loadError instanceof Error ? loadError.message : "Failed to load filter options."))
            .finally(() => setSmartLoading(false));
    }, [smartOpen, smartOptions, smartLoading]);

    useEffect(() => {
        if (!canSearch) {
            setRows([]);
            setHasMore(false);
            setTotalCount(0);
            setError(null);
            return;
        }
        const debounceId = window.setTimeout(() => {
            setLoading(true);
            setError(null);
            searchSalesStock({ query: trimmed, limit: PAGE_SIZE, offset: 0, filters: smartFilters })
                .then((data) => {
                    setRows(data.rows);
                    setHasMore(data.hasMore);
                    setTotalCount(data.totalCount);
                    setUnresolved(data.unresolvedFields);
                })
                .catch((fetchError) => {
                    setError(fetchError instanceof Error ? fetchError.message : "Failed to search products.");
                    setRows([]);
                    setHasMore(false);
                })
                .finally(() => setLoading(false));
        }, 300);
        return () => window.clearTimeout(debounceId);
    }, [trimmed, canSearch, smartFilters]);

    useEffect(() => {
        const missing = Array.from(
            new Set(rows.map((row) => row.patternId).filter((id): id is number => id !== null && patternImages[id] === undefined))
        );
        if (missing.length === 0) return;
        let cancelled = false;
        getPatternImages(missing)
            .then((data) => {
                if (cancelled) return;
                setPatternImages((current) => {
                    const next = { ...current };
                    for (const id of missing) next[id] = data.images[String(id)] ?? "";
                    return next;
                });
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rows]);

    function renderPatternImage(row: SalesStockRow, size: "thumb" | "large") {
        const src = row.patternId !== null ? patternImages[row.patternId] : "";
        const box = size === "thumb" ? "h-12 w-12" : "h-32 w-full";
        if (!src) {
            return (
                <div className={`${box} flex shrink-0 items-center justify-center rounded-lg bg-(--chip) text-(--ink-soft)`}>
                    <Package className="h-5 w-5" aria-hidden="true" />
                </div>
            );
        }
        return (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt={row.pattern ? `${row.pattern} pattern` : "Pattern"} className={`${box} shrink-0 rounded-lg bg-white object-contain`} />
        );
    }

    function loadMore() {
        if (loading || loadingMore || !hasMore) return;
        setLoadingMore(true);
        searchSalesStock({ query: trimmed, limit: PAGE_SIZE, offset: rows.length, filters: smartFilters })
            .then((data) => {
                setRows((current) => [...current, ...data.rows]);
                setHasMore(data.hasMore);
            })
            .catch(() => setHasMore(false))
            .finally(() => setLoadingMore(false));
    }

    // --- Cart ---
    const cartByQuantId = useMemo(() => new Map(cart.map((line) => [line.quantId, line])), [cart]);
    const cartCount = cart.reduce((sum, line) => sum + line.qty, 0);
    const cartRetailTotal = cart.reduce((sum, line) => sum + (line.retailPrice ?? 0) * line.qty, 0);

    function setLineQty(row: SalesStockRow, qty: number) {
        const max = Math.max(0, Math.floor(row.availableQty));
        const next = Math.min(Math.max(0, Math.floor(qty)), max);
        setCreated(null);
        setCart((current) => {
            const without = current.filter((line) => line.quantId !== row.id);
            if (next <= 0) return without;
            const line: CartLine = {
                quantId: row.id,
                productId: row.productId,
                productName: row.productName,
                lotName: row.lotName,
                location: row.location,
                companyId: row.companyId,
                companyName: row.companyName,
                availableQty: row.availableQty,
                retailPrice: row.retailPrice,
                qty: next,
            };
            const index = current.findIndex((item) => item.quantId === row.id);
            return index === -1 ? [...without, line] : current.map((item) => (item.quantId === row.id ? line : item));
        });
    }

    function setCartLineQty(quantId: number, qty: number) {
        setCart((current) =>
            current
                .map((line) =>
                    line.quantId === quantId
                        ? { ...line, qty: Math.min(Math.max(0, Math.floor(qty)), Math.max(0, Math.floor(line.availableQty))) }
                        : line
                )
                .filter((line) => line.qty > 0)
        );
    }

    useEffect(() => {
        if (!cartOpen || customers.length > 0) return;
        setCustomersLoading(true);
        getCustomers()
            .then((data) => setCustomers(data.customers.map((customer) => ({ value: String(customer.id), label: customer.name }))))
            .catch((loadError) => setSubmitError(loadError instanceof Error ? loadError.message : "Failed to load customers."))
            .finally(() => setCustomersLoading(false));
    }, [cartOpen, customers.length]);

    async function handleCreateQuotation() {
        setSubmitError(null);
        if (!customerId) {
            setSubmitError("Select a customer first.");
            return;
        }
        setSubmitting(true);
        try {
            const result = await createSalesQuotation({
                customerId: Number(customerId),
                lines: cart.map((line) => ({
                    productId: line.productId,
                    quantity: line.qty,
                    companyId: line.companyId,
                    description: line.lotName ? `${line.productName}\nLot: ${line.lotName}` : undefined,
                })),
            });
            setCreated(result.quotations);
            setCart([]);
        } catch (createError) {
            setSubmitError(createError instanceof Error ? createError.message : "Failed to create quotation.");
        } finally {
            setSubmitting(false);
        }
    }

    async function copyName(row: SalesStockRow) {
        try {
            await navigator.clipboard.writeText(row.copyName || row.productName);
            setCopiedId(row.id);
            window.setTimeout(() => setCopiedId((current) => (current === row.id ? null : current)), 1500);
        } catch {
            // Clipboard can be blocked; nothing else to do.
        }
    }

    function renderCartControl(row: SalesStockRow) {
        const line = cartByQuantId.get(row.id);
        const max = Math.max(0, Math.floor(row.availableQty));
        if (!line) {
            return (
                <button
                    type="button"
                    disabled={max <= 0}
                    onClick={() => setLineQty(row, 1)}
                    className="inline-flex items-center gap-1 rounded-lg bg-(--brand) px-2.5 py-1 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    Add
                </button>
            );
        }
        return (
            <div className="inline-flex items-center rounded-lg border border-(--line) bg-white">
                <button type="button" onClick={() => setLineQty(row, line.qty - 1)} className="px-2 py-1" aria-label="Decrease quantity">
                    <Minus className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <input
                    type="number"
                    min={0}
                    max={max}
                    value={line.qty}
                    onChange={(event) => setLineQty(row, Number(event.target.value))}
                    className="w-12 border-x border-(--line) py-1 text-center text-xs"
                    aria-label="Quantity"
                />
                <button
                    type="button"
                    disabled={line.qty >= max}
                    onClick={() => setLineQty(row, line.qty + 1)}
                    className="px-2 py-1 disabled:opacity-40"
                    aria-label="Increase quantity"
                >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
            </div>
        );
    }

    const columns: Array<{ label: string; render: (row: SalesStockRow) => React.ReactNode; align?: "right" }> = [
        { label: "Image", render: (row) => renderPatternImage(row, "thumb") },
        { label: "Location", render: (row) => row.location || "-" },
        { label: "Product", render: (row) => <span className="font-medium">{row.productName}</span> },
        {
            label: "Copy Name",
            render: (row) => (
                <span className="inline-flex items-center gap-1.5">
                    <span>{row.copyName || row.productName}</span>
                    <button type="button" onClick={() => void copyName(row)} className="text-(--ink-soft) hover:text-(--brand)" aria-label="Copy name">
                        {copiedId === row.id ? <CheckCircle2 className="h-3.5 w-3.5 text-(--accent)" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
                    </button>
                </span>
            ),
        },
        { label: "Country", render: (row) => row.country || "-" },
        { label: "Product Category", render: (row) => row.categoryName || "-" },
        { label: "Brand", render: (row) => row.brand || "-" },
        { label: "Lot Year", render: (row) => row.lotYear || "-" },
        { label: "Pattern", render: (row) => row.pattern || "-" },
        { label: "Company", render: (row) => row.companyName || "-" },
        { label: "Lot/Serial Number", render: (row) => row.lotName || "-" },
        { label: "Available Qty", align: "right", render: (row) => <span className="font-semibold text-(--accent)">{formatQty(row.availableQty)}</span> },
        { label: "Incoming", align: "right", render: (row) => formatQty(row.incomingQty) },
        { label: "Forecasted", align: "right", render: (row) => formatQty(row.forecastedQty) },
        { label: "Reserved", align: "right", render: (row) => formatQty(row.reservedQty) },
        { label: "On Hand Qty", align: "right", render: (row) => formatQty(row.onHandQty) },
        ...(showCosts
            ? [
                  { label: "Real Cost Lot", align: "right" as const, render: (row: SalesStockRow) => formatMoney(row.realCostLot) },
                  { label: "Lot Average Cost", align: "right" as const, render: (row: SalesStockRow) => formatMoney(row.lotAverageCost) },
              ]
            : []),
        { label: "Retail Price", align: "right", render: (row) => formatMoney(row.retailPrice) },
        { label: "Wholesale Price", align: "right", render: (row) => formatMoney(row.wholesalePrice) },
        { label: "Special Price", align: "right", render: (row) => formatMoney(row.specialPrice) },
    ];

    return (
        <div className="space-y-4">
            <div className="flex flex-col gap-3 rounded-2xl border border-(--line) bg-(--card) p-5 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--ink-soft)" aria-hidden="true" />
                    <input
                        value={query}
                        onChange={(event) => onQueryChange(event.target.value)}
                        placeholder="Search by size, brand, pattern, or SKU (e.g. 265/65R17 Michelin)"
                        className="w-full rounded-xl border border-(--line) bg-white py-2.5 pl-10 pr-3"
                    />
                </div>
                <div className="inline-flex shrink-0 overflow-hidden rounded-xl border border-(--line) bg-white" role="group" aria-label="View">
                    <button
                        type="button"
                        onClick={() => changeView("cards")}
                        aria-pressed={view === "cards"}
                        className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm ${view === "cards" ? "bg-(--chip) font-medium text-(--brand)" : "text-(--ink-soft)"}`}
                    >
                        <LayoutGrid className="h-4 w-4" aria-hidden="true" />
                        Cards
                    </button>
                    <button
                        type="button"
                        onClick={() => changeView("list")}
                        aria-pressed={view === "list"}
                        className={`inline-flex items-center gap-1.5 border-l border-(--line) px-3 py-2 text-sm ${view === "list" ? "bg-(--chip) font-medium text-(--brand)" : "text-(--ink-soft)"}`}
                    >
                        <List className="h-4 w-4" aria-hidden="true" />
                        List
                    </button>
                </div>
                <button
                    type="button"
                    onClick={() => {
                        setSmartDraft(smartApplied);
                        setSmartOpen(true);
                    }}
                    className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-(--line) bg-white px-4 py-2.5 text-sm font-medium text-(--ink) hover:bg-(--chip)"
                >
                    <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                    Smart Search
                    {activeSmartCount > 0 ? (
                        <span className="rounded-full bg-(--brand) px-2 py-0.5 text-xs font-semibold text-white">{activeSmartCount}</span>
                    ) : null}
                </button>
                <button
                    type="button"
                    onClick={() => setCartOpen(true)}
                    className="relative inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-(--brand) px-4 py-2.5 text-sm font-medium text-white"
                >
                    <ShoppingCart className="h-4 w-4" aria-hidden="true" />
                    Cart
                    {cart.length > 0 ? (
                        <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-(--brand)">{cartCount}</span>
                    ) : null}
                </button>
            </div>

            {created ? (
                <div className="flex items-start gap-2 rounded-2xl border border-(--accent) bg-[rgba(74,184,72,0.1)] p-4 text-sm">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-(--accent)" aria-hidden="true" />
                    <div>
                        <p className="font-medium">
                            Quotation{created.length === 1 ? "" : "s"} created in Odoo:{" "}
                            {created.map((order) => (order.companyName ? `${order.name} (${order.companyName})` : order.name)).join(", ")}
                        </p>
                    </div>
                </div>
            ) : null}

            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            {!error && rows.length > 0 && unresolved.length > 0 ? (
                <p className="text-xs text-(--ink-soft)">
                    Some columns couldn&rsquo;t be matched to Odoo fields and show &ldquo;-&rdquo;: {unresolved.join(", ")}.
                </p>
            ) : null}

            {activeSmartCount > 0 ? (
                <div className="flex flex-wrap items-center gap-2 text-xs text-(--ink-soft)">
                    <span>
                        Smart Search: matches any of {activeSmartCount} filter{activeSmartCount === 1 ? "" : "s"}
                        {trimmed ? " and the typed keyword" : ""}.
                    </span>
                    <button type="button" onClick={() => setSmartApplied(EMPTY_SMART_FILTERS)} className="font-medium text-(--brand)">
                        Clear filters
                    </button>
                </div>
            ) : null}

            {!canSearch ? (
                <p className="rounded-2xl border border-dashed border-(--line) bg-(--card) p-8 text-center text-sm text-(--ink-soft)">
                    Type at least {MIN_SEARCH_QUERY_LENGTH} characters, or use Smart Search, to find stock.
                </p>
            ) : loading ? (
                <p className="rounded-2xl border border-dashed border-(--line) bg-(--card) p-8 text-center text-sm text-(--ink-soft)">Searching...</p>
            ) : rows.length === 0 && !error ? (
                <div className="rounded-2xl border border-dashed border-(--line) bg-(--card) p-8 text-center">
                    <Package className="mx-auto h-8 w-8 text-(--ink-soft)" aria-hidden="true" />
                    <p className="mt-3 text-sm font-medium">No stock matched &ldquo;{trimmed}&rdquo;.</p>
                    <p className="mt-1 text-sm text-(--ink-soft)">Can&rsquo;t find it? Send a request for what&rsquo;s missing:</p>
                    <div className="mt-4 flex flex-wrap justify-center gap-2">
                        {(
                            [
                                ["new_product", "Request this product"],
                                ["missing_pattern", "Request a pattern"],
                                ["missing_size", "Request a size"],
                                ["more_quantity", "Request more quantity"],
                            ] as Array<[ProductRequestType, string]>
                        ).map(([type, label]) => (
                            <button
                                key={type}
                                type="button"
                                onClick={() => onRequest(type)}
                                className="inline-flex items-center gap-2 rounded-xl bg-(--brand) px-4 py-2 text-sm font-medium text-white"
                            >
                                <Plus className="h-4 w-4" aria-hidden="true" />
                                {label}
                            </button>
                        ))}
                    </div>
                </div>
            ) : rows.length > 0 ? (
                <>
                    <p className="text-xs text-(--ink-soft)">
                        Showing {rows.length} of {totalCount} stock line{totalCount === 1 ? "" : "s"}.
                    </p>

                    {view === "list" ? (
                        <div className="overflow-x-auto rounded-2xl border border-(--line) bg-(--card)">
                            <table className="min-w-full border-collapse text-left text-xs">
                                <thead className="bg-(--chip) text-(--ink-soft)">
                                    <tr>
                                        {columns.map((column) => (
                                            <th key={column.label} className={`whitespace-nowrap px-3 py-2.5 font-medium ${column.align === "right" ? "text-right" : ""}`}>
                                                {column.label}
                                            </th>
                                        ))}
                                        <th className="whitespace-nowrap px-3 py-2.5 font-medium">Cart</th>
                                        <th className="px-3 py-2.5" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map((row) => (
                                        <tr key={row.id} className="border-t border-(--line)">
                                            {columns.map((column) => (
                                                <td key={column.label} className={`whitespace-nowrap px-3 py-2 ${column.align === "right" ? "text-right" : ""}`}>
                                                    {column.render(row)}
                                                </td>
                                            ))}
                                            <td className="whitespace-nowrap px-3 py-2">
                                                {renderCartControl(row)}
                                            </td>
                                            <td className="whitespace-nowrap px-3 py-2">
                                                <button type="button" onClick={() => onRequestFromRow(row)} className="text-(--ink-soft) hover:text-(--brand)">
                                                    Request size/pattern
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                            {rows.map((row) => (
                                <article key={row.id} className="rounded-2xl border border-(--line) bg-(--card) p-5 shadow-[0_8px_20px_rgba(8,23,41,0.05)]">
                                    <div className="mb-3">{renderPatternImage(row, "large")}</div>
                                    <div className="flex items-start justify-between gap-2">
                                        <h3 className="text-base font-bold leading-snug">{row.productName}</h3>
                                        <button type="button" onClick={() => void copyName(row)} className="shrink-0 text-(--ink-soft) hover:text-(--brand)" aria-label="Copy name" title={row.copyName || row.productName}>
                                            {copiedId === row.id ? <CheckCircle2 className="h-4 w-4 text-(--accent)" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
                                        </button>
                                    </div>
                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                        {[row.brand, row.pattern, row.country, row.lotYear && `Lot ${row.lotYear}`].filter(Boolean).map((chip) => (
                                            <span key={String(chip)} className="rounded-full bg-(--chip) px-2.5 py-1 text-xs font-semibold text-(--ink)">
                                                {chip}
                                            </span>
                                        ))}
                                    </div>
                                    <p className="mt-2 text-xs text-(--ink-soft)">{row.categoryName}</p>
                                    <p className="mt-1 text-xs text-(--ink-soft)">
                                        {row.location} · {row.companyName}
                                        {row.lotName ? ` · ${row.lotName}` : ""}
                                    </p>

                                    <div className="mt-3 grid grid-cols-3 gap-2 border-t border-(--line) pt-3 text-center">
                                        <div>
                                            <p className="text-[11px] text-(--ink-soft)">Available</p>
                                            <p className="text-base font-bold text-(--accent)">{formatQty(row.availableQty)}</p>
                                        </div>
                                        <div>
                                            <p className="text-[11px] text-(--ink-soft)">On hand</p>
                                            <p className="text-base font-semibold">{formatQty(row.onHandQty)}</p>
                                        </div>
                                        <div>
                                            <p className="text-[11px] text-(--ink-soft)">Reserved</p>
                                            <p className="text-base font-semibold">{formatQty(row.reservedQty)}</p>
                                        </div>
                                        <div>
                                            <p className="text-[11px] text-(--ink-soft)">Incoming</p>
                                            <p className="text-sm">{formatQty(row.incomingQty)}</p>
                                        </div>
                                        <div>
                                            <p className="text-[11px] text-(--ink-soft)">Forecasted</p>
                                            <p className="text-sm">{formatQty(row.forecastedQty)}</p>
                                        </div>
                                    </div>

                                    <div className="mt-3 grid grid-cols-3 gap-2 border-t border-(--line) pt-3 text-center">
                                        <div>
                                            <p className="text-[11px] text-(--ink-soft)">Retail</p>
                                            <p className="text-sm font-semibold">{formatMoney(row.retailPrice)}</p>
                                        </div>
                                        <div>
                                            <p className="text-[11px] text-(--ink-soft)">Wholesale</p>
                                            <p className="text-sm font-semibold">{formatMoney(row.wholesalePrice)}</p>
                                        </div>
                                        <div>
                                            <p className="text-[11px] text-(--ink-soft)">Special</p>
                                            <p className="text-sm font-semibold">{formatMoney(row.specialPrice)}</p>
                                        </div>
                                    </div>
                                    {showCosts ? (
                                        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-(--line) pt-3 text-center">
                                            <div>
                                                <p className="text-[11px] text-(--ink-soft)">Real cost (lot)</p>
                                                <p className="text-sm">{formatMoney(row.realCostLot)}</p>
                                            </div>
                                            <div>
                                                <p className="text-[11px] text-(--ink-soft)">Lot avg cost</p>
                                                <p className="text-sm">{formatMoney(row.lotAverageCost)}</p>
                                            </div>
                                        </div>
                                    ) : null}

                                    <div className="mt-3 flex items-center justify-between gap-2 border-t border-(--line) pt-3">
                                        {renderCartControl(row)}
                                        <button type="button" onClick={() => onRequestFromRow(row)} className="text-xs text-(--ink-soft) hover:text-(--brand)">
                                            Request size/pattern
                                        </button>
                                    </div>
                                </article>
                            ))}
                        </div>
                    )}

                    {hasMore ? (
                        <div className="flex justify-center">
                            <button
                                type="button"
                                onClick={loadMore}
                                disabled={loadingMore}
                                className="rounded-xl border border-(--line) bg-white px-5 py-2 text-sm font-medium text-(--ink) disabled:cursor-not-allowed disabled:opacity-70"
                            >
                                {loadingMore ? "Loading..." : "Load more"}
                            </button>
                        </div>
                    ) : null}
                </>
            ) : null}

            {smartOpen ? (
                <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8" onClick={() => setSmartOpen(false)}>
                    <div className="w-full max-w-lg rounded-2xl border border-(--line) bg-(--card) p-6 shadow-xl" onClick={(event) => event.stopPropagation()}>
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <h2 className="font-display text-xl">Smart Search</h2>
                                <p className="mt-1 text-sm text-(--ink-soft)">
                                    Stock matching <span className="font-medium">any</span> selected filter is shown. If you also typed a keyword,
                                    it must match that as well.
                                </p>
                            </div>
                            <button type="button" onClick={() => setSmartOpen(false)} className="rounded-full p-1.5 text-(--ink-soft) hover:bg-(--chip)" aria-label="Close">
                                <X className="h-4 w-4" aria-hidden="true" />
                            </button>
                        </div>

                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                            {SMART_FIELDS.map((field) => (
                                <label key={field.key} className="block">
                                    <span className="mb-1 block text-sm font-medium">{field.label}</span>
                                    <Select2
                                        value={smartDraft[field.key]}
                                        onChange={(value) => setSmartDraft((current) => ({ ...current, [field.key]: value }))}
                                        options={[{ value: "", label: "Any" }, ...(smartOptions?.[field.key] ?? [])]}
                                        loading={smartLoading}
                                        placeholder="Any"
                                    />
                                </label>
                            ))}
                        </div>
                        {smartError ? <p className="mt-3 text-sm text-red-600">{smartError}</p> : null}

                        <div className="mt-5 flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => {
                                    setSmartPatternName(
                                        smartOptions?.pattern.find((option) => option.value === smartDraft.pattern)?.description ?? null
                                    );
                                    setSmartApplied(smartDraft);
                                    setSmartOpen(false);
                                }}
                                className="flex-1 rounded-xl bg-(--brand) px-4 py-2.5 text-sm font-medium text-white"
                            >
                                Apply
                            </button>
                            <button
                                type="button"
                                onClick={() => setSmartDraft(EMPTY_SMART_FILTERS)}
                                className="rounded-xl border border-(--line) bg-white px-4 py-2.5 text-sm text-(--ink-soft)"
                            >
                                Clear
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}

            {cartOpen ? (
                <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={() => setCartOpen(false)}>
                    <aside
                        className="flex h-full w-full max-w-md flex-col bg-(--card) shadow-xl"
                        onClick={(event) => event.stopPropagation()}
                        aria-label="Cart"
                    >
                        <div className="flex items-center justify-between border-b border-(--line) px-5 py-4">
                            <h2 className="font-display text-xl">Cart</h2>
                            <button type="button" onClick={() => setCartOpen(false)} className="rounded-full p-1.5 text-(--ink-soft) hover:bg-(--chip)" aria-label="Close cart">
                                <X className="h-4 w-4" aria-hidden="true" />
                            </button>
                        </div>

                        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
                            {cart.length === 0 ? (
                                <p className="text-sm text-(--ink-soft)">Your cart is empty. Add products from the search results.</p>
                            ) : (
                                cart.map((line) => (
                                    <div key={line.quantId} className="rounded-xl border border-(--line) bg-white p-3">
                                        <div className="flex items-start justify-between gap-2">
                                            <p className="text-sm font-medium leading-snug">{line.productName}</p>
                                            <button type="button" onClick={() => setCartLineQty(line.quantId, 0)} className="shrink-0 text-(--ink-soft) hover:text-red-600" aria-label="Remove">
                                                <Trash2 className="h-4 w-4" aria-hidden="true" />
                                            </button>
                                        </div>
                                        <p className="mt-0.5 text-xs text-(--ink-soft)">
                                            {[line.lotName, line.companyName, line.location].filter(Boolean).join(" · ")}
                                        </p>
                                        <div className="mt-2 flex items-center justify-between">
                                            <div className="inline-flex items-center rounded-lg border border-(--line)">
                                                <button type="button" onClick={() => setCartLineQty(line.quantId, line.qty - 1)} className="px-2 py-1" aria-label="Decrease quantity">
                                                    <Minus className="h-3.5 w-3.5" aria-hidden="true" />
                                                </button>
                                                <input
                                                    type="number"
                                                    min={1}
                                                    max={Math.floor(line.availableQty)}
                                                    value={line.qty}
                                                    onChange={(event) => setCartLineQty(line.quantId, Number(event.target.value))}
                                                    className="w-14 border-x border-(--line) py-1 text-center text-sm"
                                                    aria-label="Quantity"
                                                />
                                                <button
                                                    type="button"
                                                    disabled={line.qty >= Math.floor(line.availableQty)}
                                                    onClick={() => setCartLineQty(line.quantId, line.qty + 1)}
                                                    className="px-2 py-1 disabled:opacity-40"
                                                    aria-label="Increase quantity"
                                                >
                                                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                                                </button>
                                            </div>
                                            <span className="text-xs text-(--ink-soft)">of {formatQty(line.availableQty)} available</span>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>

                        {cart.length > 0 ? (
                            <div className="space-y-3 border-t border-(--line) px-5 py-4">
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-(--ink-soft)">{cartCount} item{cartCount === 1 ? "" : "s"}</span>
                                    {cartRetailTotal > 0 ? (
                                        <span className="font-medium">Est. at retail: {formatMoney(cartRetailTotal)}</span>
                                    ) : null}
                                </div>
                                <label className="block">
                                    <span className="mb-1 block text-sm font-medium">Customer</span>
                                    <Select2
                                        value={customerId}
                                        onChange={setCustomerId}
                                        options={customers}
                                        loading={customersLoading}
                                        placeholder="Select a customer"
                                    />
                                </label>
                                {submitError ? <p className="text-sm text-red-600">{submitError}</p> : null}
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => void handleCreateQuotation()}
                                        disabled={submitting}
                                        className="flex-1 rounded-xl bg-(--brand) px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-70"
                                    >
                                        {submitting ? "Creating..." : "Create Quotation in Odoo"}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setCart([])}
                                        disabled={submitting}
                                        className="rounded-xl border border-(--line) bg-white px-3 py-2.5 text-sm text-(--ink-soft)"
                                    >
                                        Clear
                                    </button>
                                </div>
                                <p className="text-xs text-(--ink-soft)">
                                    Lines from different companies become separate quotations. Prices come from the customer&rsquo;s pricelist in Odoo.
                                </p>
                            </div>
                        ) : null}
                    </aside>
                </div>
            ) : null}
        </div>
    );
}
