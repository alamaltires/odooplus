"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import {
    CheckCircle2,
    ChevronDown,
    ChevronsDownUp,
    ChevronsUpDown,
    Copy,
    LayoutGrid,
    List,
    MessageSquarePlus,
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
const PAGE_SIZES = [20, 30, 50, 100];
const DEFAULT_PAGE_SIZE = 30;
const PAGE_SIZE_STORAGE_KEY = "fast-orders:page-size";
const CART_STORAGE_KEY = "odoopp:salesCart";
const VIEW_STORAGE_KEY = "odoopp:salesView:v2";

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

type SearchAnswer = Awaited<ReturnType<typeof searchSalesStock>>;
/** Recent searches of this visit (cleared on reload, so stock changes show up after a refresh). */
const searchCache = new Map<string, SearchAnswer>();

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
    const [error, setError] = useState<string | null>(null);
    const [totalCount, setTotalCount] = useState(0);
    const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
    // The page number belongs to one search; a new keyword / filter / page size starts again at page 1.
    const [pageState, setPageState] = useState<{ key: string; page: number }>({ key: "", page: 1 });
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
    const [customerMissing, setCustomerMissing] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [created, setCreated] = useState<Array<{ id: number; name: string; companyName: string }> | null>(null);

    useEffect(() => {
        setView(readStorage<ViewMode>(VIEW_STORAGE_KEY, "list"));
        const savedSize = readStorage<number>(PAGE_SIZE_STORAGE_KEY, DEFAULT_PAGE_SIZE);
        if (PAGE_SIZES.includes(savedSize)) setPageSize(savedSize);
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

    const searchKey = JSON.stringify([trimmed, smartFilters, pageSize]);
    const page = pageState.key === searchKey ? pageState.page : 1;
    const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));

    useEffect(() => {
        if (!canSearch) {
            setRows([]);
            setTotalCount(0);
            setError(null);
            return;
        }
        // Pages already seen in this visit come back instantly; a slow older answer can never replace a newer one.
        const cacheKey = JSON.stringify([searchKey, page]);
        const cachedAnswer = searchCache.get(cacheKey);
        let stale = false;
        const debounceId = window.setTimeout(() => {
            if (cachedAnswer) {
                setRows(cachedAnswer.rows);
                setTotalCount(cachedAnswer.totalCount);
                setUnresolved(cachedAnswer.unresolvedFields);
                setError(null);
                setLoading(false);
                return;
            }
            setLoading(true);
            setError(null);
            searchSalesStock({ query: trimmed, limit: pageSize, offset: (page - 1) * pageSize, filters: smartFilters })
                .then((data) => {
                    if (stale) return;
                    searchCache.set(cacheKey, data);
                    if (searchCache.size > 60) searchCache.delete(searchCache.keys().next().value as string);
                    setRows(data.rows);
                    setTotalCount(data.totalCount);
                    setUnresolved(data.unresolvedFields);
                })
                .catch((fetchError) => {
                    if (stale) return;
                    setError(fetchError instanceof Error ? fetchError.message : "Failed to search products.");
                    setRows([]);
                })
                .finally(() => {
                    if (!stale) setLoading(false);
                });
        }, cachedAnswer || page > 1 ? 0 : 180);
        return () => {
            stale = true;
            window.clearTimeout(debounceId);
        };
    }, [trimmed, canSearch, smartFilters, searchKey, page, pageSize]);

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

    function goToPage(next: number) {
        setPageState({ key: searchKey, page: Math.min(Math.max(1, next), pageCount) });
    }

    function changePageSize(next: number) {
        setPageSize(next);
        writeStorage(PAGE_SIZE_STORAGE_KEY, next);
    }

    // First, last, and a window of pages around the current one.
    const pageNumbers = (() => {
        const numbers = new Set<number>([1, pageCount, page - 1, page, page + 1]);
        if (page <= 3) [2, 3, 4].forEach((n) => numbers.add(n));
        if (page >= pageCount - 2) [pageCount - 1, pageCount - 2, pageCount - 3].forEach((n) => numbers.add(n));
        const sorted = Array.from(numbers).filter((n) => n >= 1 && n <= pageCount).sort((a, b) => a - b);
        const out: Array<number | "gap"> = [];
        sorted.forEach((n, index) => {
            if (index > 0 && n - sorted[index - 1] > 1) out.push("gap");
            out.push(n);
        });
        return out;
    })();

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
            setCustomerMissing(true);
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
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-(--brand) text-white shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label="Add to cart"
                    title={max <= 0 ? "Nothing available to add" : "Add to cart"}
                >
                    <Plus className="h-4 w-4" aria-hidden="true" />
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

    // The same product and lot sitting in several locations is folded into one line; opening it shows each location.
    const groups = useMemo(() => {
        const byKey = new Map<string, SalesStockRow[]>();
        for (const row of rows) {
            const key = `${row.productId}|${row.lotName}`;
            const list = byKey.get(key);
            if (list) list.push(row);
            else byKey.set(key, [row]);
        }
        return Array.from(byKey, ([key, items]) => ({
            key,
            rows: items,
            summary: {
                ...items[0],
                location: `${items.length} locations`,
                availableQty: items.reduce((total, item) => total + item.availableQty, 0),
                onHandQty: items.reduce((total, item) => total + item.onHandQty, 0),
                reservedQty: items.reduce((total, item) => total + item.reservedQty, 0),
            } as SalesStockRow,
        }));
    }, [rows]);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const toggleGroup = (key: string) =>
        setExpanded((current) => {
            const next = new Set(current);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });

    // Related fields share a column (stacked on two or three lines) so the whole row fits without sideways scrolling.
    const pair = (label: string, value: React.ReactNode) => (
        <div className="flex items-baseline justify-between gap-3 whitespace-nowrap">
            <span className="text-[10px] uppercase tracking-wide text-(--ink-soft)">{label}</span>
            <span className="tabular-nums">{value}</span>
        </div>
    );
    const columns: Array<{ label: string; render: (row: SalesStockRow) => React.ReactNode; align?: "right" }> = [
        {
            label: "Product",
            render: (row) => (
                <div className="flex min-w-0 items-start gap-3">
                    {renderPatternImage(row, "thumb")}
                    <div className="min-w-0">
                        <div className="flex items-start gap-1.5">
                            <span className="font-semibold leading-snug">{row.productName}</span>
                            <button
                                type="button"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    void copyName(row);
                                }}
                                className="mt-0.5 shrink-0 text-(--ink-soft) hover:text-(--brand)"
                                aria-label="Copy name"
                                title={row.copyName || row.productName}
                            >
                                {copiedId === row.id ? <CheckCircle2 className="h-3.5 w-3.5 text-(--accent)" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
                            </button>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                            {row.brand ? (
                                <span className="inline-flex items-center gap-1 rounded-full border border-(--ink) bg-(--ink) px-2.5 py-0.5 text-[11px] font-semibold text-white">
                                    <span className="text-[9px] font-medium uppercase tracking-wider opacity-60">Brand</span>
                                    {row.brand}
                                </span>
                            ) : null}
                            {[row.pattern, row.country, row.lotYear && `Lot ${row.lotYear}`].filter(Boolean).map((chip) => (
                                <span key={String(chip)} className="rounded-full bg-(--chip) px-2 py-0.5 text-[11px] font-medium">
                                    {chip}
                                </span>
                            ))}
                        </div>
                        {row.categoryName ? <p className="mt-1 text-[11px] text-(--ink-soft)">{row.categoryName}</p> : null}
                    </div>
                </div>
            ),
        },
        {
            label: "Location",
            render: (row) => (
                <div>
                    <p className="font-medium">{row.location || "-"}</p>
                    <p className="text-[11px] text-(--ink-soft)">{row.companyName || "-"}</p>
                    {row.lotName ? (
                        <span className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-[rgba(229,26,39,0.25)] bg-[rgba(229,26,39,0.08)] px-2.5 py-0.5 text-[11px] font-semibold text-(--brand)">
                            <span className="text-[9px] font-medium uppercase tracking-wider opacity-70">Lot</span>
                            {row.lotName}
                        </span>
                    ) : (
                        <span className="mt-1.5 inline-flex rounded-full bg-(--chip) px-2.5 py-0.5 text-[11px] text-(--ink-soft)">No lot</span>
                    )}
                </div>
            ),
        },
        {
            label: "Stock",
            render: (row) => (
                <div className="min-w-28">
                    {pair("Available", <span className="font-bold text-(--accent)">{formatQty(row.availableQty)}</span>)}
                    {pair("On hand", formatQty(row.onHandQty))}
                    {pair("Reserved", formatQty(row.reservedQty))}
                </div>
            ),
        },
        {
            label: "Incoming",
            render: (row) => (
                <div className="min-w-24">
                    {pair("Incoming", formatQty(row.incomingQty))}
                    {pair("Forecast", formatQty(row.forecastedQty))}
                </div>
            ),
        },
        {
            label: "Prices",
            render: (row) => (
                <div className="min-w-32">
                    {pair("Retail", <span className="font-semibold">{formatMoney(row.retailPrice)}</span>)}
                    {pair("Wholesale", formatMoney(row.wholesalePrice))}
                    {pair("Special", formatMoney(row.specialPrice))}
                </div>
            ),
        },
        ...(showCosts
            ? [
                  {
                      label: "Cost",
                      render: (row: SalesStockRow) => (
                          <div className="min-w-32">
                              {pair("Real", formatMoney(row.realCostLot))}
                              {pair("Average", formatMoney(row.lotAverageCost))}
                          </div>
                      ),
                  },
              ]
            : []),
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
            ) : loading && rows.length === 0 ? (
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
                <div className={`space-y-4 transition-opacity duration-200 ${loading ? "pointer-events-none opacity-60" : ""}`}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-xs text-(--ink-soft)">
                            Showing {(page - 1) * pageSize + 1}&ndash;{(page - 1) * pageSize + rows.length} of {totalCount} stock line{totalCount === 1 ? "" : "s"}.
                        </p>
                        <div className="flex flex-wrap items-center justify-end gap-3 text-xs">
                            <label className="inline-flex items-center gap-2 text-(--ink-soft)">
                                Show
                                <select
                                    value={pageSize}
                                    onChange={(event) => changePageSize(Number(event.target.value))}
                                    className="rounded-lg border border-(--line) bg-white px-2 py-1.5 text-(--ink)"
                                >
                                    {PAGE_SIZES.map((size) => (
                                        <option key={size} value={size}>
                                            {size}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            {pageCount > 1 ? (
                                <nav className="inline-flex items-center gap-1" aria-label="Pagination">
                                    <button
                                        type="button"
                                        onClick={() => goToPage(page - 1)}
                                        disabled={page <= 1 || loading}
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
                                                onClick={() => goToPage(entry)}
                                                disabled={loading}
                                                aria-current={entry === page ? "page" : undefined}
                                                className={`min-w-8 rounded-lg border px-2 py-1.5 font-medium transition ${entry === page ? "border-(--brand) bg-(--brand) text-white shadow-sm" : "border-(--line) bg-white hover:bg-(--chip)"}`}
                                            >
                                                {entry}
                                            </button>
                                        )
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => goToPage(page + 1)}
                                        disabled={page >= pageCount || loading}
                                        className="rounded-lg border border-(--line) bg-white px-2.5 py-1.5 font-medium disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                        Next
                                    </button>
                                </nav>
                            ) : null}
                        </div>
                    </div>

                    {view === "list" ? (
                        <div className="overflow-x-auto rounded-2xl border border-(--line) bg-(--card)">
                            <table className="min-w-full border-collapse text-left text-xs">
                                <thead className="bg-(--chip) text-(--ink-soft)">
                                    <tr>
                                        {columns.map((column) => (
                                            <th key={column.label} className="border border-(--line) px-3 py-2.5 font-medium">
                                                {column.label}
                                            </th>
                                        ))}
                                        <th className="whitespace-nowrap border border-(--line) px-3 py-2.5 font-medium">Cart</th>
                                        <th className="border border-(--line) px-3 py-2.5" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {groups.map((group) => {
                                        const renderRow = (row: SalesStockRow, mode: "single" | "parent" | "child") => (
                                            <tr
                                                key={mode === "parent" ? `group-${group.key}` : row.id}
                                                onClick={mode === "parent" ? () => toggleGroup(group.key) : undefined}
                                                className={`${mode === "parent" ? "cursor-pointer bg-(--chip)/40 hover:bg-(--chip)/70" : ""} ${mode === "child" ? "bg-white/60" : ""}`}
                                                aria-expanded={mode === "parent" ? expanded.has(group.key) : undefined}
                                            >
                                                {columns.map((column, index) => (
                                                    <td
                                                        key={column.label}
                                                        className={`border border-(--line)/70 px-3 py-2.5 align-top ${mode === "child" && index === 0 ? "border-l-2 border-l-(--brand)/40" : ""}`}
                                                    >
                                                        {index === 0 ? (
                                                            // Every row reserves the same slot for the fold arrow, so the images line up.
                                                            <div className="flex items-start gap-1">
                                                                <span className="flex h-5 w-5 shrink-0 items-center justify-center pt-0.5">
                                                                    {mode === "parent" ? (
                                                                        <ChevronDown className={`h-4 w-4 text-(--ink-soft) transition ${expanded.has(group.key) ? "" : "-rotate-90"}`} aria-hidden="true" />
                                                                    ) : null}
                                                                </span>
                                                                <div className="min-w-0 flex-1">{column.render(row)}</div>
                                                            </div>
                                                        ) : (
                                                            column.render(row)
                                                        )}
                                                    </td>
                                                ))}
                                                <td className="border border-(--line)/70 px-3 py-2.5 align-top" onClick={(event) => event.stopPropagation()}>
                                                    {mode === "parent" ? (
                                                        <button
                                                            type="button"
                                                            onClick={() => toggleGroup(group.key)}
                                                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-(--line) bg-white text-(--ink-soft) transition hover:border-(--brand) hover:text-(--brand)"
                                                            aria-label={expanded.has(group.key) ? "Hide locations" : "Show locations to add"}
                                                            title={expanded.has(group.key) ? "Hide locations" : "Show locations to add"}
                                                        >
                                                            {expanded.has(group.key) ? <ChevronsDownUp className="h-4 w-4" aria-hidden="true" /> : <ChevronsUpDown className="h-4 w-4" aria-hidden="true" />}
                                                        </button>
                                                    ) : (
                                                        renderCartControl(row)
                                                    )}
                                                </td>
                                                <td className="border border-(--line)/70 px-3 py-2.5 align-top" onClick={(event) => event.stopPropagation()}>
                                                    <button
                                                        type="button"
                                                        onClick={() => onRequestFromRow(row)}
                                                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-(--line) bg-white text-(--ink-soft) shadow-sm transition hover:border-(--brand) hover:bg-[rgba(229,26,39,0.06)] hover:text-(--brand)"
                                                        aria-label="Request a different size, pattern or quantity"
                                                        title="Request a different size, pattern or quantity"
                                                    >
                                                        <MessageSquarePlus className="h-4 w-4" aria-hidden="true" />
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                        if (group.rows.length === 1) return renderRow(group.rows[0], "single");
                                        return (
                                            <Fragment key={group.key}>
                                                {renderRow(group.summary, "parent")}
                                                {expanded.has(group.key) ? group.rows.map((row) => renderRow(row, "child")) : null}
                                            </Fragment>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                            {groups.map((group) => {
                                const row = group.rows.length > 1 ? group.summary : group.rows[0];
                                const folded = group.rows.length > 1;
                                return (
                                <article key={group.key} className="rounded-2xl border border-(--line) bg-(--card) p-5 shadow-[0_8px_20px_rgba(8,23,41,0.05)]">
                                    <div className="mb-3">{renderPatternImage(row, "large")}</div>
                                    <div className="flex items-start justify-between gap-2">
                                        <h3 className="text-base font-bold leading-snug">{row.productName}</h3>
                                        <button type="button" onClick={() => void copyName(row)} className="shrink-0 text-(--ink-soft) hover:text-(--brand)" aria-label="Copy name" title={row.copyName || row.productName}>
                                            {copiedId === row.id ? <CheckCircle2 className="h-4 w-4 text-(--accent)" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
                                        </button>
                                    </div>
                                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                        {row.brand ? (
                                            <span className="inline-flex items-center gap-1 rounded-full border border-(--ink) bg-(--ink) px-2.5 py-0.5 text-[11px] font-semibold text-white">
                                                <span className="text-[9px] font-medium uppercase tracking-wider opacity-60">Brand</span>
                                                {row.brand}
                                            </span>
                                        ) : null}
                                        {[row.pattern, row.country, row.lotYear && `Lot ${row.lotYear}`].filter(Boolean).map((chip) => (
                                            <span key={String(chip)} className="rounded-full bg-(--chip) px-2.5 py-1 text-xs font-semibold text-(--ink)">
                                                {chip}
                                            </span>
                                        ))}
                                    </div>
                                    <p className="mt-2 text-xs text-(--ink-soft)">{row.categoryName}</p>
                                    <p className="mt-1 text-xs text-(--ink-soft)">
                                        {row.location} · {row.companyName}
                                    </p>
                                    {row.lotName ? (
                                        <span className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-[rgba(229,26,39,0.25)] bg-[rgba(229,26,39,0.08)] px-2.5 py-0.5 text-[11px] font-semibold text-(--brand)">
                                            <span className="text-[9px] font-medium uppercase tracking-wider opacity-70">Lot</span>
                                            {row.lotName}
                                        </span>
                                    ) : null}
                                    {folded ? (
                                        <ul className="mt-2 space-y-1.5 rounded-xl bg-(--chip)/50 p-2 text-xs">
                                            {group.rows.map((item) => (
                                                <li key={item.id} className="flex items-center justify-between gap-2">
                                                    <span className="min-w-0 truncate" title={item.location}>
                                                        {item.location} <span className="font-semibold text-(--accent)">· {formatQty(item.availableQty)}</span>
                                                    </span>
                                                    {renderCartControl(item)}
                                                </li>
                                            ))}
                                        </ul>
                                    ) : null}

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
                                        {folded ? <span className="text-xs text-(--ink-soft)">Add from a location above</span> : renderCartControl(row)}
                                        <button
                                            type="button"
                                            onClick={() => onRequestFromRow(row)}
                                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-(--line) bg-white text-(--ink-soft) shadow-sm transition hover:border-(--brand) hover:bg-[rgba(229,26,39,0.06)] hover:text-(--brand)"
                                            aria-label="Request a different size, pattern or quantity"
                                            title="Request a different size, pattern or quantity"
                                        >
                                            <MessageSquarePlus className="h-4 w-4" aria-hidden="true" />
                                        </button>
                                    </div>
                                </article>
                                );
                            })}
                        </div>
                    )}
                </div>
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

                        {cart.length > 0 ? (
                            <div className="border-b border-(--line) bg-(--chip)/40 px-5 py-3">
                                <label className="block">
                                    <span className="mb-1 flex items-center gap-1 text-sm font-semibold">
                                        Customer <span className="text-(--brand)" aria-hidden="true">*</span>
                                        <span className="text-xs font-normal text-(--ink-soft)">required</span>
                                    </span>
                                    <div className={`rounded-xl ${customerMissing && !customerId ? "ring-2 ring-red-500" : ""}`}>
                                        <Select2
                                            value={customerId}
                                            onChange={(value) => {
                                                setCustomerId(value);
                                                setCustomerMissing(false);
                                            }}
                                            options={customers}
                                            loading={customersLoading}
                                            placeholder="Select a customer"
                                        />
                                    </div>
                                    {customerMissing && !customerId ? <span className="mt-1 block text-xs text-red-600">Choose the customer before creating the quotation.</span> : null}
                                </label>
                            </div>
                        ) : null}

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
