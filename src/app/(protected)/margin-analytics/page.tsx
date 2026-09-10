"use client";

import { Fragment, FormEvent, UIEvent, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Coins, Download, ListTree, PiggyBank, Search, X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import {
    getMarginAnalyticsBreakdown,
    getMarginAnalyticsReport,
    getProductBrands,
    getProductCategories,
    getProductOrigins,
    getProducts,
    getRimDiameters,
    searchUnifiedLots,
    type MarginBreakdown,
    type MarginBreakdownRow,
} from "@/lib/client-odoo";

type Option = { id: number; name: string };
type Category = Option & { model: "product.public.category" | "product.category" };

type RowFlag = "never-sold" | "sold-without-purchase" | "no-landed-cost" | "negative-margin" | "has-cost-correction";

type ReportRow = {
    productId: number;
    productName: string;
    brandName: string;
    categoryName: string;
    originName: string;
    rimDiameterName: string;
    purchasedQty: number;
    avgPurchasePrice: number;
    avgLandedCostPerUnit: number;
    avgOperationCostPerUnit: number;
    avgFinalLandedCostPerUnit: number;
    avgTotalCostPerUnit: number;
    soldQty: number;
    avgSalesPrice: number;
    hasSalesData: boolean;
    avgMarginPerUnit: number;
    marginPercent: number;
    estimatedProfitLoss: number;
    currentStock: number;
    flags: RowFlag[];
    originalCurrencies: string[];
};

const FLAG_LABELS: Record<RowFlag, string> = {
    "never-sold": "Never sold in period",
    "sold-without-purchase": "Sold without a purchase in period",
    "no-landed-cost": "No landed cost yet",
    "negative-margin": "Negative margin",
    "has-cost-correction": "Has cost correction",
};

const FLAG_STYLES: Record<RowFlag, string> = {
    "never-sold": "bg-(--chip) text-(--ink-soft)",
    "sold-without-purchase": "bg-(--chip) text-(--ink-soft)",
    "no-landed-cost": "bg-amber-100 text-amber-800",
    "negative-margin": "bg-red-100 text-red-700",
    "has-cost-correction": "bg-[rgba(32,98,176,0.12)] text-(--brand)",
};

type Highlights = {
    productsWithPurchases: number;
    productsWithSales: number;
    productsWithoutSales: number;
    productsWithoutLandedCost: number;
    totalPurchasedQty: number;
    totalSoldQty: number;
    totalCurrentStock: number;
    avgPurchasePrice: number;
    avgLandedCostPerUnit: number;
    avgOperationCostPerUnit: number;
    avgFinalLandedCostPerUnit: number;
    avgTotalCostPerUnit: number;
    avgSalesPrice: number;
    avgMarginPercent: number;
    totalEstimatedProfitLoss: number;
};

type Report = {
    startDate: string;
    endDate: string;
    currencyCode: string;
    matchedProductCount: number;
    rows: ReportRow[];
    highlights: Highlights;
    unconvertedCurrencyCodes: string[];
};

type SortColumn =
    | "productName"
    | "purchasedQty"
    | "avgTotalCostPerUnit"
    | "soldQty"
    | "avgSalesPrice"
    | "marginPercent"
    | "estimatedProfitLoss"
    | "currentStock";
type SortDirection = "asc" | "desc";

const SEARCH_PAGE_SIZE = 20;
const MIN_SEARCH_QUERY_LENGTH = 2;
const SCROLL_LOAD_MORE_THRESHOLD_PX = 48;

function todayISO() {
    return new Date().toISOString().slice(0, 10);
}

function formatNumber(value: number) {
    return value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatCurrency(value: number, currencyCode: string) {
    return `${currencyCode} ${formatNumber(value)}`;
}

function sanitizeFileName(value: string) {
    return (
        value
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "") || "margin-analytics"
    );
}

function SearchableSelect({
    label,
    placeholder,
    query,
    onQueryChange,
    options,
    onSelect,
    loading,
    error,
    menuOpen,
    onFocus,
    onBlur,
}: {
    label: string;
    placeholder: string;
    query: string;
    onQueryChange: (value: string) => void;
    options: Option[];
    onSelect: (option: Option) => void;
    loading: boolean;
    error: string | null;
    menuOpen: boolean;
    onFocus: () => void;
    onBlur: () => void;
}) {
    return (
        <label className="relative block">
            <span className="mb-2 block text-sm font-medium">{label}</span>
            <div className="relative">
                <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--ink-soft)"
                    aria-hidden="true"
                />
                <input
                    value={query}
                    onChange={(event) => onQueryChange(event.target.value)}
                    onFocus={onFocus}
                    onBlur={() => window.setTimeout(onBlur, 120)}
                    placeholder={loading ? "Loading..." : placeholder}
                    className="w-full rounded-xl border border-(--line) bg-white py-2 pl-10 pr-3"
                    disabled={loading || Boolean(error)}
                />
            </div>

            {menuOpen && options.length > 0 ? (
                <ul className="absolute z-20 mt-2 max-h-64 w-full overflow-auto rounded-xl border border-(--line) bg-white p-1 shadow-lg">
                    {options.map((option) => (
                        <li key={option.id}>
                            <button
                                type="button"
                                onMouseDown={() => onSelect(option)}
                                className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-(--chip)"
                            >
                                {option.name}
                            </button>
                        </li>
                    ))}
                </ul>
            ) : null}
            {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
        </label>
    );
}

function MultiSearchableSelect({
    label,
    placeholder,
    query,
    onQueryChange,
    options,
    selected,
    onToggle,
    onRemove,
    loading,
    loadingMore,
    error,
    minQueryLength,
    minQueryText,
    menuOpen,
    onFocus,
    onBlur,
    onScroll,
    emptyText,
}: {
    label: string;
    placeholder: string;
    query: string;
    onQueryChange: (value: string) => void;
    options: Option[];
    selected: Option[];
    onToggle: (option: Option) => void;
    onRemove: (id: number) => void;
    loading: boolean;
    loadingMore?: boolean;
    error?: string | null;
    minQueryLength?: number;
    minQueryText?: string;
    menuOpen: boolean;
    onFocus: () => void;
    onBlur: () => void;
    onScroll?: (event: UIEvent<HTMLUListElement>) => void;
    emptyText?: string;
}) {
    const selectedIds = useMemo(() => new Set(selected.map((option) => option.id)), [selected]);
    const belowMinLength = minQueryLength != null && query.trim().length < minQueryLength;

    return (
        <label className="relative block">
            <span className="mb-2 block text-sm font-medium">{label}</span>
            <div className="relative">
                <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--ink-soft)"
                    aria-hidden="true"
                />
                <input
                    value={query}
                    onChange={(event) => onQueryChange(event.target.value)}
                    onFocus={onFocus}
                    onBlur={() => window.setTimeout(onBlur, 120)}
                    placeholder={loading ? "Loading..." : placeholder}
                    className="w-full rounded-xl border border-(--line) bg-white py-2 pl-10 pr-3"
                    disabled={loading && options.length === 0}
                />
            </div>

            {selected.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                    {selected.map((option) => (
                        <span
                            key={option.id}
                            className="inline-flex items-center gap-1 rounded-full bg-(--chip) px-2.5 py-1 text-xs font-medium"
                        >
                            {option.name}
                            <button
                                type="button"
                                onMouseDown={(event) => {
                                    event.preventDefault();
                                    onRemove(option.id);
                                }}
                                aria-label={`Remove ${option.name}`}
                                className="cursor-pointer rounded-full hover:bg-black/10"
                            >
                                <X className="h-3 w-3" aria-hidden="true" />
                            </button>
                        </span>
                    ))}
                </div>
            ) : null}

            {menuOpen ? (
                <ul
                    onScroll={onScroll}
                    className="absolute z-20 mt-2 max-h-64 w-full overflow-auto rounded-xl border border-(--line) bg-white p-1 shadow-lg"
                >
                    {belowMinLength ? (
                        <li className="px-3 py-2 text-sm text-(--ink-soft)">
                            {minQueryText ?? `Type at least ${minQueryLength} characters to search.`}
                        </li>
                    ) : loading ? (
                        <li className="px-3 py-2 text-sm text-(--ink-soft)">Searching...</li>
                    ) : options.length === 0 ? (
                        <li className="px-3 py-2 text-sm text-(--ink-soft)">{emptyText ?? "No results found."}</li>
                    ) : (
                        <>
                            {options.map((option) => {
                                const isSelected = selectedIds.has(option.id);
                                return (
                                    <li key={option.id}>
                                        <button
                                            type="button"
                                            onMouseDown={() => onToggle(option)}
                                            className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-(--chip) ${
                                                isSelected ? "bg-(--chip)" : ""
                                            }`}
                                        >
                                            <span>{option.name}</span>
                                            {isSelected ? <span className="text-(--brand)">✓</span> : null}
                                        </button>
                                    </li>
                                );
                            })}
                            {loadingMore ? (
                                <li className="px-3 py-2 text-center text-xs text-(--ink-soft)">Loading more...</li>
                            ) : null}
                        </>
                    )}
                </ul>
            ) : null}
            {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
        </label>
    );
}

export default function MarginAnalyticsPage() {
    const { user } = useAuth();
    const hasLoadedCategoriesRef = useRef(false);
    const hasLoadedBrandsRef = useRef(false);
    const hasLoadedOriginsRef = useRef(false);
    const hasLoadedRimDiametersRef = useRef(false);

    const [categories, setCategories] = useState<Category[]>([]);
    const [categoriesLoading, setCategoriesLoading] = useState(true);
    const [categoriesError, setCategoriesError] = useState<string | null>(null);
    const [categoryQuery, setCategoryQuery] = useState("");
    const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
    const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);

    const [brands, setBrands] = useState<Option[]>([]);
    const [brandsLoading, setBrandsLoading] = useState(true);
    const [brandsError, setBrandsError] = useState<string | null>(null);
    const [brandQuery, setBrandQuery] = useState("");
    const [brandMenuOpen, setBrandMenuOpen] = useState(false);
    const [selectedBrand, setSelectedBrand] = useState<Option | null>(null);

    const [origins, setOrigins] = useState<Option[]>([]);
    const [originsLoading, setOriginsLoading] = useState(true);
    const [originsError, setOriginsError] = useState<string | null>(null);
    const [originQuery, setOriginQuery] = useState("");
    const [originMenuOpen, setOriginMenuOpen] = useState(false);
    const [selectedOrigin, setSelectedOrigin] = useState<Option | null>(null);

    const [rimDiameters, setRimDiameters] = useState<Option[]>([]);
    const [rimDiametersLoading, setRimDiametersLoading] = useState(true);
    const [rimDiametersError, setRimDiametersError] = useState<string | null>(null);
    const [rimDiameterQuery, setRimDiameterQuery] = useState("");
    const [rimDiameterMenuOpen, setRimDiameterMenuOpen] = useState(false);
    const [selectedRimDiameters, setSelectedRimDiameters] = useState<Option[]>([]);

    const [productQuery, setProductQuery] = useState("");
    const [productActivated, setProductActivated] = useState(false);
    const [productMenuOpen, setProductMenuOpen] = useState(false);
    const [productResults, setProductResults] = useState<Option[]>([]);
    const [productLoading, setProductLoading] = useState(false);
    const [productLoadingMore, setProductLoadingMore] = useState(false);
    const [productOffset, setProductOffset] = useState(0);
    const [productHasMore, setProductHasMore] = useState(false);
    const [selectedProduct, setSelectedProduct] = useState<Option | null>(null);

    const [unifiedLotQuery, setUnifiedLotQuery] = useState("");
    const [unifiedLotActivated, setUnifiedLotActivated] = useState(false);
    const [unifiedLotMenuOpen, setUnifiedLotMenuOpen] = useState(false);
    const [unifiedLotResults, setUnifiedLotResults] = useState<Option[]>([]);
    const [unifiedLotLoading, setUnifiedLotLoading] = useState(false);
    const [unifiedLotLoadingMore, setUnifiedLotLoadingMore] = useState(false);
    const [unifiedLotOffset, setUnifiedLotOffset] = useState(0);
    const [unifiedLotHasMore, setUnifiedLotHasMore] = useState(false);
    const [selectedUnifiedLots, setSelectedUnifiedLots] = useState<Option[]>([]);

    const [startDate, setStartDate] = useState(() => {
        const now = new Date();
        now.setMonth(now.getMonth() - 1);
        return now.toISOString().slice(0, 10);
    });
    const [endDate, setEndDate] = useState(todayISO);
    const [dateBasis, setDateBasis] = useState<"order" | "transaction">("order");

    const [report, setReport] = useState<Report | null>(null);
    const [reportLoading, setReportLoading] = useState(false);
    const [reportError, setReportError] = useState<string | null>(null);

    const [tableSearch, setTableSearch] = useState("");
    const [sortColumn, setSortColumn] = useState<SortColumn>("estimatedProfitLoss");
    const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
    const [expandedProductIds, setExpandedProductIds] = useState<Set<number>>(new Set());
    const [exportLoading, setExportLoading] = useState<"csv" | "xlsx" | null>(null);
    const [appliedParams, setAppliedParams] = useState<{
        unifiedLotIds: number[];
        startDate: string;
        endDate: string;
        dateBasis: "order" | "transaction";
    } | null>(null);
    const [breakdownProduct, setBreakdownProduct] = useState<ReportRow | null>(null);
    const [breakdown, setBreakdown] = useState<MarginBreakdown | null>(null);
    const [breakdownLoading, setBreakdownLoading] = useState(false);
    const [breakdownError, setBreakdownError] = useState<string | null>(null);

    useEffect(() => {
        async function loadCategories() {
            if (!user) {
                hasLoadedCategoriesRef.current = false;
                setCategoriesLoading(false);
                return;
            }
            if (hasLoadedCategoriesRef.current) {
                setCategoriesLoading(false);
                return;
            }
            hasLoadedCategoriesRef.current = true;
            try {
                const data = await getProductCategories();
                setCategories(data.categories.filter((category) => category.model === "product.category"));
            } catch (loadError) {
                setCategoriesError(loadError instanceof Error ? loadError.message : "Failed to load product categories.");
            } finally {
                setCategoriesLoading(false);
            }
        }
        void loadCategories();
    }, [user]);

    useEffect(() => {
        async function loadBrands() {
            if (!user) {
                hasLoadedBrandsRef.current = false;
                setBrandsLoading(false);
                return;
            }
            if (hasLoadedBrandsRef.current) {
                setBrandsLoading(false);
                return;
            }
            hasLoadedBrandsRef.current = true;
            try {
                const data = await getProductBrands();
                setBrands(data.brands);
            } catch (loadError) {
                setBrandsError(loadError instanceof Error ? loadError.message : "Failed to load product brands.");
            } finally {
                setBrandsLoading(false);
            }
        }
        void loadBrands();
    }, [user]);

    useEffect(() => {
        async function loadOrigins() {
            if (!user) {
                hasLoadedOriginsRef.current = false;
                setOriginsLoading(false);
                return;
            }
            if (hasLoadedOriginsRef.current) {
                setOriginsLoading(false);
                return;
            }
            hasLoadedOriginsRef.current = true;
            try {
                const data = await getProductOrigins();
                setOrigins(data.origins);
            } catch (loadError) {
                setOriginsError(loadError instanceof Error ? loadError.message : "Failed to load product origins.");
            } finally {
                setOriginsLoading(false);
            }
        }
        void loadOrigins();
    }, [user]);

    useEffect(() => {
        async function loadRimDiameters() {
            if (!user) {
                hasLoadedRimDiametersRef.current = false;
                setRimDiametersLoading(false);
                return;
            }
            if (hasLoadedRimDiametersRef.current) {
                setRimDiametersLoading(false);
                return;
            }
            hasLoadedRimDiametersRef.current = true;
            try {
                const data = await getRimDiameters();
                setRimDiameters(data.rimDiameters);
            } catch (loadError) {
                setRimDiametersError(loadError instanceof Error ? loadError.message : "Failed to load rim diameters.");
            } finally {
                setRimDiametersLoading(false);
            }
        }
        void loadRimDiameters();
    }, [user]);

    useEffect(() => {
        if (!productActivated) {
            return;
        }
        const trimmedQuery = productQuery.trim();
        if (trimmedQuery.length < MIN_SEARCH_QUERY_LENGTH) {
            setProductResults([]);
            setProductHasMore(false);
            setProductOffset(0);
            return;
        }
        const debounceId = window.setTimeout(() => {
            setProductLoading(true);
            getProducts({ query: trimmedQuery, limit: SEARCH_PAGE_SIZE, offset: 0 })
                .then((data) => {
                    setProductResults(data.products);
                    setProductHasMore(data.hasMore);
                    setProductOffset(data.products.length);
                })
                .catch(() => {
                    setProductResults([]);
                    setProductHasMore(false);
                })
                .finally(() => setProductLoading(false));
        }, 250);
        return () => window.clearTimeout(debounceId);
    }, [productActivated, productQuery]);

    function loadMoreProducts() {
        const trimmedQuery = productQuery.trim();
        if (productLoading || productLoadingMore || !productHasMore || trimmedQuery.length < MIN_SEARCH_QUERY_LENGTH) {
            return;
        }
        setProductLoadingMore(true);
        getProducts({ query: trimmedQuery, limit: SEARCH_PAGE_SIZE, offset: productOffset })
            .then((data) => {
                setProductResults((current) => [...current, ...data.products]);
                setProductHasMore(data.hasMore);
                setProductOffset((current) => current + data.products.length);
            })
            .catch(() => setProductHasMore(false))
            .finally(() => setProductLoadingMore(false));
    }

    useEffect(() => {
        if (!unifiedLotActivated) {
            return;
        }
        const trimmedQuery = unifiedLotQuery.trim();
        if (trimmedQuery.length < MIN_SEARCH_QUERY_LENGTH) {
            setUnifiedLotResults([]);
            setUnifiedLotHasMore(false);
            setUnifiedLotOffset(0);
            return;
        }
        const debounceId = window.setTimeout(() => {
            setUnifiedLotLoading(true);
            searchUnifiedLots({ query: trimmedQuery, limit: SEARCH_PAGE_SIZE, offset: 0 })
                .then((data) => {
                    setUnifiedLotResults(data.unifiedLots);
                    setUnifiedLotHasMore(data.hasMore);
                    setUnifiedLotOffset(data.unifiedLots.length);
                })
                .catch(() => {
                    setUnifiedLotResults([]);
                    setUnifiedLotHasMore(false);
                })
                .finally(() => setUnifiedLotLoading(false));
        }, 250);
        return () => window.clearTimeout(debounceId);
    }, [unifiedLotActivated, unifiedLotQuery]);

    function loadMoreUnifiedLots() {
        const trimmedQuery = unifiedLotQuery.trim();
        if (unifiedLotLoading || unifiedLotLoadingMore || !unifiedLotHasMore || trimmedQuery.length < MIN_SEARCH_QUERY_LENGTH) {
            return;
        }
        setUnifiedLotLoadingMore(true);
        searchUnifiedLots({ query: trimmedQuery, limit: SEARCH_PAGE_SIZE, offset: unifiedLotOffset })
            .then((data) => {
                setUnifiedLotResults((current) => [...current, ...data.unifiedLots]);
                setUnifiedLotHasMore(data.hasMore);
                setUnifiedLotOffset((current) => current + data.unifiedLots.length);
            })
            .catch(() => setUnifiedLotHasMore(false))
            .finally(() => setUnifiedLotLoadingMore(false));
    }

    const filteredCategories = useMemo(() => {
        if (!categoryQuery.trim()) return categories;
        const q = categoryQuery.toLowerCase();
        return categories.filter((category) => category.name.toLowerCase().includes(q));
    }, [categoryQuery, categories]);

    const filteredBrands = useMemo(() => {
        if (!brandQuery.trim()) return brands;
        const q = brandQuery.toLowerCase();
        return brands.filter((brand) => brand.name.toLowerCase().includes(q));
    }, [brandQuery, brands]);

    const filteredOrigins = useMemo(() => {
        if (!originQuery.trim()) return origins;
        const q = originQuery.toLowerCase();
        return origins.filter((origin) => origin.name.toLowerCase().includes(q));
    }, [originQuery, origins]);

    const filteredRimDiameters = useMemo(() => {
        if (!rimDiameterQuery.trim()) return rimDiameters;
        const q = rimDiameterQuery.toLowerCase();
        return rimDiameters.filter((rim) => rim.name.toLowerCase().includes(q));
    }, [rimDiameterQuery, rimDiameters]);

    const hasAnyFilter = Boolean(
        selectedCategory ||
            selectedBrand ||
            selectedOrigin ||
            selectedRimDiameters.length > 0 ||
            selectedUnifiedLots.length > 0 ||
            selectedProduct
    );

    const filteredSortedRows = useMemo(() => {
        if (!report) return [];
        const query = tableSearch.trim().toLowerCase();
        const filtered = query
            ? report.rows.filter(
                  (row) =>
                      row.productName.toLowerCase().includes(query) ||
                      row.brandName.toLowerCase().includes(query) ||
                      row.categoryName.toLowerCase().includes(query) ||
                      row.originName.toLowerCase().includes(query)
              )
            : report.rows;

        const sorted = [...filtered].sort((a, b) => {
            if (sortColumn === "productName") {
                return a.productName.localeCompare(b.productName);
            }
            return a[sortColumn] - b[sortColumn];
        });

        return sortDirection === "asc" ? sorted : sorted.reverse();
    }, [report, sortColumn, sortDirection, tableSearch]);

    const flaggedRows = useMemo(() => {
        if (!report) return [];
        return report.rows.filter((row) => row.flags.length > 0);
    }, [report]);

    const exportFileName = useMemo(() => {
        const parts = [
            selectedCategory?.name,
            selectedBrand?.name,
            selectedOrigin?.name,
            selectedRimDiameters.map((option) => option.name).join("/"),
            selectedUnifiedLots.map((option) => option.name).join("/"),
            selectedProduct?.name,
        ].filter(Boolean);
        const scope = parts.join("-") || "margin-analytics";
        return `margin-analytics-${sanitizeFileName(scope)}-${startDate}-to-${endDate}`;
    }, [
        endDate,
        selectedBrand?.name,
        selectedCategory?.name,
        selectedOrigin?.name,
        selectedProduct?.name,
        selectedRimDiameters,
        selectedUnifiedLots,
        startDate,
    ]);

    async function handleGenerate(event: FormEvent) {
        event.preventDefault();
        if (!hasAnyFilter) {
            return;
        }

        setReportLoading(true);
        setReportError(null);
        setTableSearch("");
        setExpandedProductIds(new Set());

        try {
            const data = await getMarginAnalyticsReport({
                categoryId: selectedCategory?.id,
                brandId: selectedBrand?.id,
                originId: selectedOrigin?.id,
                rimDiameterIds: selectedRimDiameters.map((option) => option.id),
                unifiedLotIds: selectedUnifiedLots.map((option) => option.id),
                productId: selectedProduct?.id,
                startDate,
                endDate,
                dateBasis,
            });
            setReport(data);
            // Pin the filters this report was actually built from, so a
            // breakdown opened later reflects the numbers on screen even if
            // the form has since been edited without regenerating.
            setAppliedParams({
                unifiedLotIds: selectedUnifiedLots.map((option) => option.id),
                startDate,
                endDate,
                dateBasis,
            });
        } catch (generateError) {
            setReportError(generateError instanceof Error ? generateError.message : "Failed to generate margin analytics report.");
        } finally {
            setReportLoading(false);
        }
    }

    async function openBreakdown(row: ReportRow) {
        if (!appliedParams) {
            return;
        }

        setBreakdownProduct(row);
        setBreakdown(null);
        setBreakdownError(null);
        setBreakdownLoading(true);

        try {
            const data = await getMarginAnalyticsBreakdown({
                productId: row.productId,
                unifiedLotIds: appliedParams.unifiedLotIds,
                startDate: appliedParams.startDate,
                endDate: appliedParams.endDate,
                dateBasis: appliedParams.dateBasis,
            });
            setBreakdown(data);
        } catch (error) {
            setBreakdownError(error instanceof Error ? error.message : "Failed to load the breakdown.");
        } finally {
            setBreakdownLoading(false);
        }
    }

    function toggleExpanded(productId: number) {
        setExpandedProductIds((current) => {
            const next = new Set(current);
            if (next.has(productId)) {
                next.delete(productId);
            } else {
                next.add(productId);
            }
            return next;
        });
    }

    function handleSort(column: SortColumn) {
        if (sortColumn === column) {
            setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
            return;
        }
        setSortColumn(column);
        setSortDirection(column === "productName" ? "asc" : "desc");
    }

    function getSortIndicator(column: SortColumn) {
        if (sortColumn !== column) return "";
        return sortDirection === "asc" ? " ▲" : " ▼";
    }

    async function handleExport(format: "csv" | "xlsx") {
        if (!report || filteredSortedRows.length === 0) return;

        setExportLoading(format);
        setReportError(null);

        try {
            const XLSX = await import("xlsx");
            const exportData = filteredSortedRows.map((row) => ({
                "Product Name": row.productName,
                Brand: row.brandName,
                Category: row.categoryName,
                Origin: row.originName,
                "Rim Diameter": row.rimDiameterName,
                "Purchased Qty": row.purchasedQty,
                "Remaining Stock": row.currentStock,
                [`Avg Purchase Price (${report.currencyCode})`]: row.avgPurchasePrice,
                [`Avg Landed Cost (${report.currencyCode})`]: row.avgLandedCostPerUnit,
                [`Avg Operation Cost (${report.currencyCode})`]: row.avgOperationCostPerUnit,
                [`Final Landed Cost (${report.currencyCode})`]: row.avgFinalLandedCostPerUnit,
                [`Avg Total Cost (${report.currencyCode})`]: row.avgTotalCostPerUnit,
                "Sold Qty": row.soldQty,
                [`Avg Sales Price (${report.currencyCode})`]: row.avgSalesPrice,
                "Margin %": row.hasSalesData ? row.marginPercent : "",
                [`Est. Profit/Loss (${report.currencyCode})`]: row.hasSalesData ? row.estimatedProfitLoss : "",
                "Originally Priced In": row.originalCurrencies.join(", ") || "-",
                Flags: row.flags.map((flag) => FLAG_LABELS[flag]).join("; "),
            }));

            const worksheet = XLSX.utils.json_to_sheet(exportData);
            worksheet["!cols"] = [
                { wch: 42 },
                { wch: 16 },
                { wch: 18 },
                { wch: 14 },
                { wch: 12 },
                { wch: 14 },
                { wch: 12 },
                { wch: 18 },
                { wch: 16 },
                { wch: 18 },
                { wch: 16 },
                { wch: 10 },
                { wch: 16 },
                { wch: 10 },
                { wch: 18 },
                { wch: 18 },
                { wch: 48 },
            ];

            if (format === "csv") {
                const csv = XLSX.utils.sheet_to_csv(worksheet);
                const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
                const url = window.URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = url;
                link.download = `${exportFileName}.csv`;
                link.click();
                window.URL.revokeObjectURL(url);
                return;
            }

            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, "Margin Analytics");
            XLSX.writeFile(workbook, `${exportFileName}.xlsx`);
        } catch (exportError) {
            setReportError(exportError instanceof Error ? exportError.message : "Failed to export margin analytics report.");
        } finally {
            setExportLoading(null);
        }
    }

    return (
        <section>
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="font-display text-3xl">Margin Analytics</h1>
                </div>
                <PiggyBank className="h-8 w-8 text-(--brand)" aria-hidden="true" />
            </div>

            <form onSubmit={handleGenerate} className="mt-6 rounded-2xl border border-(--line) bg-(--card) p-5">
                <div className="grid gap-4 lg:grid-cols-2">
                    <label className="relative block">
                        <span className="mb-2 block text-sm font-medium">Product</span>
                        <div className="relative">
                            <Search
                                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--ink-soft)"
                                aria-hidden="true"
                            />
                            <input
                                value={productQuery}
                                onChange={(event) => {
                                    setProductQuery(event.target.value);
                                    setProductMenuOpen(true);
                                    setProductActivated(true);
                                    setSelectedProduct(null);
                                }}
                                onFocus={() => {
                                    setProductMenuOpen(true);
                                    setProductActivated(true);
                                }}
                                onBlur={() => window.setTimeout(() => setProductMenuOpen(false), 120)}
                                placeholder="Search for a single product to scan"
                                className="w-full rounded-xl border border-(--line) bg-white py-2 pl-10 pr-3"
                            />
                        </div>

                        {productMenuOpen ? (
                            <ul
                                onScroll={(event) => {
                                    const target = event.currentTarget;
                                    if (target.scrollHeight - target.scrollTop - target.clientHeight < SCROLL_LOAD_MORE_THRESHOLD_PX) {
                                        loadMoreProducts();
                                    }
                                }}
                                className="absolute z-20 mt-2 max-h-64 w-full overflow-auto rounded-xl border border-(--line) bg-white p-1 shadow-lg"
                            >
                                {productQuery.trim().length < MIN_SEARCH_QUERY_LENGTH ? (
                                    <li className="px-3 py-2 text-sm text-(--ink-soft)">
                                        Type at least {MIN_SEARCH_QUERY_LENGTH} characters to search.
                                    </li>
                                ) : productLoading ? (
                                    <li className="px-3 py-2 text-sm text-(--ink-soft)">Searching...</li>
                                ) : productResults.length === 0 ? (
                                    <li className="px-3 py-2 text-sm text-(--ink-soft)">No products found.</li>
                                ) : (
                                    <>
                                        {productResults.map((product) => (
                                            <li key={product.id}>
                                                <button
                                                    type="button"
                                                    onMouseDown={() => {
                                                        setSelectedProduct(product);
                                                        setProductQuery(product.name);
                                                        setProductMenuOpen(false);
                                                    }}
                                                    className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-(--chip)"
                                                >
                                                    {product.name}
                                                </button>
                                            </li>
                                        ))}
                                        {productLoadingMore ? (
                                            <li className="px-3 py-2 text-center text-xs text-(--ink-soft)">Loading more...</li>
                                        ) : null}
                                    </>
                                )}
                            </ul>
                        ) : null}
                    </label>

                    <SearchableSelect
                        label="Product Category"
                        placeholder="Search categories"
                        query={categoryQuery}
                        onQueryChange={(value) => {
                            setCategoryQuery(value);
                            setCategoryMenuOpen(true);
                            setSelectedCategory(null);
                        }}
                        options={filteredCategories}
                        onSelect={(option) => {
                            setSelectedCategory(option as Category);
                            setCategoryQuery(option.name);
                            setCategoryMenuOpen(false);
                        }}
                        loading={categoriesLoading}
                        error={categoriesError}
                        menuOpen={categoryMenuOpen}
                        onFocus={() => setCategoryMenuOpen(true)}
                        onBlur={() => setCategoryMenuOpen(false)}
                    />

                    <SearchableSelect
                        label="Brand"
                        placeholder="Search brands"
                        query={brandQuery}
                        onQueryChange={(value) => {
                            setBrandQuery(value);
                            setBrandMenuOpen(true);
                            setSelectedBrand(null);
                        }}
                        options={filteredBrands}
                        onSelect={(option) => {
                            setSelectedBrand(option);
                            setBrandQuery(option.name);
                            setBrandMenuOpen(false);
                        }}
                        loading={brandsLoading}
                        error={brandsError}
                        menuOpen={brandMenuOpen}
                        onFocus={() => setBrandMenuOpen(true)}
                        onBlur={() => setBrandMenuOpen(false)}
                    />

                    <SearchableSelect
                        label="Product Origin"
                        placeholder="Search countries of origin"
                        query={originQuery}
                        onQueryChange={(value) => {
                            setOriginQuery(value);
                            setOriginMenuOpen(true);
                            setSelectedOrigin(null);
                        }}
                        options={filteredOrigins}
                        onSelect={(option) => {
                            setSelectedOrigin(option);
                            setOriginQuery(option.name);
                            setOriginMenuOpen(false);
                        }}
                        loading={originsLoading}
                        error={originsError}
                        menuOpen={originMenuOpen}
                        onFocus={() => setOriginMenuOpen(true)}
                        onBlur={() => setOriginMenuOpen(false)}
                    />

                    <MultiSearchableSelect
                        label="Rim Diameter"
                        placeholder="Search rim diameters"
                        query={rimDiameterQuery}
                        onQueryChange={(value) => {
                            setRimDiameterQuery(value);
                            setRimDiameterMenuOpen(true);
                        }}
                        options={filteredRimDiameters}
                        selected={selectedRimDiameters}
                        onToggle={(option) => {
                            setSelectedRimDiameters((current) =>
                                current.some((item) => item.id === option.id)
                                    ? current.filter((item) => item.id !== option.id)
                                    : [...current, option]
                            );
                            setRimDiameterQuery("");
                        }}
                        onRemove={(id) => setSelectedRimDiameters((current) => current.filter((item) => item.id !== id))}
                        loading={rimDiametersLoading}
                        error={rimDiametersError}
                        menuOpen={rimDiameterMenuOpen}
                        onFocus={() => setRimDiameterMenuOpen(true)}
                        onBlur={() => setRimDiameterMenuOpen(false)}
                    />

                    <MultiSearchableSelect
                        label="Unified Lot"
                        placeholder="Search unified lot code"
                        query={unifiedLotQuery}
                        onQueryChange={(value) => {
                            setUnifiedLotQuery(value);
                            setUnifiedLotMenuOpen(true);
                            setUnifiedLotActivated(true);
                        }}
                        options={unifiedLotResults}
                        selected={selectedUnifiedLots}
                        onToggle={(option) => {
                            setSelectedUnifiedLots((current) =>
                                current.some((item) => item.id === option.id)
                                    ? current.filter((item) => item.id !== option.id)
                                    : [...current, option]
                            );
                            setUnifiedLotQuery("");
                        }}
                        onRemove={(id) => setSelectedUnifiedLots((current) => current.filter((item) => item.id !== id))}
                        loading={unifiedLotLoading}
                        loadingMore={unifiedLotLoadingMore}
                        minQueryLength={MIN_SEARCH_QUERY_LENGTH}
                        emptyText="No unified lots found."
                        menuOpen={unifiedLotMenuOpen}
                        onFocus={() => {
                            setUnifiedLotMenuOpen(true);
                            setUnifiedLotActivated(true);
                        }}
                        onBlur={() => setUnifiedLotMenuOpen(false)}
                        onScroll={(event) => {
                            const target = event.currentTarget;
                            if (target.scrollHeight - target.scrollTop - target.clientHeight < SCROLL_LOAD_MORE_THRESHOLD_PX) {
                                loadMoreUnifiedLots();
                            }
                        }}
                    />

                    <div className="grid gap-4 sm:grid-cols-2">
                        <label className="block">
                            <span className="mb-2 block text-sm font-medium">Start Date</span>
                            <input
                                type="date"
                                value={startDate}
                                onChange={(event) => setStartDate(event.target.value)}
                                className="w-full rounded-xl border border-(--line) bg-white px-3 py-2"
                                required
                            />
                        </label>
                        <label className="block">
                            <span className="mb-2 block text-sm font-medium">End Date</span>
                            <input
                                type="date"
                                value={endDate}
                                onChange={(event) => setEndDate(event.target.value)}
                                min={startDate}
                                className="w-full rounded-xl border border-(--line) bg-white px-3 py-2"
                                required
                            />
                        </label>
                    </div>

                    <label className="block">
                        <span className="mb-2 block text-sm font-medium">Date Basis</span>
                        <select
                            value={dateBasis}
                            onChange={(event) => setDateBasis(event.target.value as "order" | "transaction")}
                            className="w-full rounded-xl border border-(--line) bg-white px-3 py-2.5"
                        >
                            <option value="order">Default (Purchase Order + Sales Order date)</option>
                            <option value="transaction">Receiving (validation) + Invoice date</option>
                        </select>
                    </label>
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-3">
                    <button
                        type="submit"
                        disabled={reportLoading || !hasAnyFilter}
                        className="rounded-xl bg-(--brand) px-5 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-70"
                    >
                        {reportLoading ? "Generating..." : "Generate"}
                    </button>
                    {report ? <p className="text-sm text-(--ink-soft)">{report.matchedProductCount} product(s) matched.</p> : null}
                </div>

                {reportError ? <p className="mt-4 text-sm text-red-600">{reportError}</p> : null}
            </form>

            {report ? (
                <div className="mt-6 space-y-6">
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                        <article className="flex flex-col items-center rounded-2xl border border-(--line) bg-(--card) p-5 text-center shadow-[0_8px_20px_rgba(8,23,41,0.05)]">
                            <p className="text-sm text-(--ink-soft)">
                                Avg Total Cost / Unit ({report.startDate} → {report.endDate})
                            </p>
                            <p className="mt-2 font-display text-3xl">
                                {formatCurrency(report.highlights.avgTotalCostPerUnit, report.currencyCode)}
                            </p>
                            <div className="mt-3 grid w-full grid-cols-2 gap-1.5">
                                <div className="rounded-lg bg-(--chip) px-2.5 py-1.5">
                                    <p className="text-[10px] text-(--ink-soft)">Purchase</p>
                                    <p className="text-xs font-semibold">
                                        {formatCurrency(report.highlights.avgPurchasePrice, report.currencyCode)}
                                    </p>
                                </div>
                                <div className="rounded-lg bg-(--chip) px-2.5 py-1.5">
                                    <p className="text-[10px] text-(--ink-soft)">Landed</p>
                                    <p className="text-xs font-semibold">
                                        {formatCurrency(report.highlights.avgLandedCostPerUnit, report.currencyCode)}
                                    </p>
                                </div>
                                <div className="rounded-lg bg-(--chip) px-2.5 py-1.5">
                                    <p className="text-[10px] text-(--ink-soft)">Operation</p>
                                    <p
                                        className={`text-xs font-semibold ${
                                            report.highlights.avgOperationCostPerUnit < 0 ? "text-red-600" : ""
                                        }`}
                                    >
                                        {formatCurrency(report.highlights.avgOperationCostPerUnit, report.currencyCode)}
                                    </p>
                                </div>
                                <div className="rounded-lg bg-[rgba(32,98,176,0.08)] px-2.5 py-1.5">
                                    <p className="text-[10px] text-(--ink-soft)">Final Landed</p>
                                    <p className="text-xs font-semibold text-(--brand)">
                                        {formatCurrency(report.highlights.avgFinalLandedCostPerUnit, report.currencyCode)}
                                    </p>
                                </div>
                            </div>
                        </article>
                        <article className="flex flex-col items-center justify-center rounded-2xl border border-(--line) bg-(--card) p-5 text-center shadow-[0_8px_20px_rgba(8,23,41,0.05)]">
                            <p className="text-sm text-(--ink-soft)">Avg Sales Price</p>
                            <p className="mt-2 font-display text-3xl">
                                {formatCurrency(report.highlights.avgSalesPrice, report.currencyCode)}
                            </p>
                            <p className="mt-1 text-xs text-(--ink-soft)">
                                {report.highlights.productsWithSales} of {report.matchedProductCount} products sold in period
                            </p>
                        </article>
                        <article className="flex flex-col items-center justify-center rounded-2xl border border-(--line) bg-(--card) p-5 text-center shadow-[0_8px_20px_rgba(8,23,41,0.05)]">
                            <p className="text-sm text-(--ink-soft)">Avg Margin %</p>
                            <p
                                className={`mt-2 font-display text-3xl ${
                                    report.highlights.avgMarginPercent < 0 ? "text-red-600" : ""
                                }`}
                            >
                                {formatNumber(report.highlights.avgMarginPercent)}%
                            </p>
                        </article>
                        <article className="flex flex-col items-center justify-center rounded-2xl border border-(--line) bg-(--card) p-5 text-center shadow-[0_8px_20px_rgba(8,23,41,0.05)]">
                            <p className="text-sm text-(--ink-soft)">Est. Profit / Loss</p>
                            <p
                                className={`mt-2 font-display text-3xl ${
                                    report.highlights.totalEstimatedProfitLoss < 0 ? "text-red-600" : ""
                                }`}
                            >
                                {formatCurrency(report.highlights.totalEstimatedProfitLoss, report.currencyCode)}
                            </p>
                            <p className="mt-1 text-xs text-(--ink-soft)">
                                {formatNumber(report.highlights.totalSoldQty)} units sold · avg cost applied
                            </p>
                        </article>
                    </div>

                    {flaggedRows.length > 0 ? (
                        <div className="rounded-2xl border border-(--line) bg-(--card) p-5">
                            <h2 className="font-display text-xl">Flagged Products ({flaggedRows.length})</h2>
                            <div className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">
                                {flaggedRows.map((row) => (
                                    <div
                                        key={row.productId}
                                        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-(--line) px-3 py-2"
                                    >
                                        <span className="text-sm font-medium">{row.productName}</span>
                                        <div className="flex flex-wrap gap-1.5">
                                            {row.flags.map((flag) => (
                                                <span
                                                    key={flag}
                                                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${FLAG_STYLES[flag]}`}
                                                >
                                                    {FLAG_LABELS[flag]}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : null}

                    {report.unconvertedCurrencyCodes.length > 0 ? (
                        <p className="text-sm text-red-600">
                            No exchange rate is configured for {report.unconvertedCurrencyCodes.join(", ")} at your home
                            company — amounts in those currencies are excluded above.
                        </p>
                    ) : null}

                    <div className="rounded-2xl border border-(--line) bg-(--card) p-5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                                <h2 className="font-display text-2xl">Margin by Product</h2>
                            </div>

                            {report.rows.length > 0 ? (
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        onClick={() => void handleExport("csv")}
                                        disabled={exportLoading !== null}
                                        className="inline-flex items-center gap-2 rounded-xl border border-(--line) bg-white px-4 py-2 text-sm font-medium text-(--ink) disabled:cursor-not-allowed disabled:opacity-70"
                                    >
                                        <Download className="h-4 w-4" aria-hidden="true" />
                                        {exportLoading === "csv" ? "Exporting CSV..." : "Export CSV"}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => void handleExport("xlsx")}
                                        disabled={exportLoading !== null}
                                        className="inline-flex items-center gap-2 rounded-xl bg-(--brand) px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-70"
                                    >
                                        <Download className="h-4 w-4" aria-hidden="true" />
                                        {exportLoading === "xlsx" ? "Exporting Excel..." : "Export Excel"}
                                    </button>
                                </div>
                            ) : null}
                        </div>

                        {reportLoading ? <p className="mt-3 text-sm">Loading report data...</p> : null}

                        {!reportLoading && report.rows.length === 0 ? (
                            <p className="mt-3 text-sm text-(--ink-soft)">No products matched these filters for the selected period.</p>
                        ) : null}

                        {report.rows.length > 0 ? (
                            <div className="mt-4 relative">
                                <Search
                                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--ink-soft)"
                                    aria-hidden="true"
                                />
                                <input
                                    type="search"
                                    value={tableSearch}
                                    onChange={(event) => setTableSearch(event.target.value)}
                                    placeholder="Search products, brands, categories, or origin…"
                                    className="w-full rounded-xl border border-(--line) bg-white py-2 pl-10 pr-4 text-sm"
                                />
                            </div>
                        ) : null}

                        {report.rows.length > 0 ? (
                            <div className="mt-3 overflow-x-auto rounded-xl border border-(--line)">
                                <table className="min-w-full border-collapse text-left text-sm">
                                    <thead className="bg-(--chip) text-(--ink-soft)">
                                        <tr>
                                            <th className="border border-(--line) px-4 py-3 font-medium" />
                                            <th className="border border-(--line) px-4 py-3 font-medium">
                                                <button type="button" onClick={() => handleSort("productName")} className="cursor-pointer">
                                                    Product{getSortIndicator("productName")}
                                                </button>
                                            </th>
                                            <th className="border border-(--line) px-4 py-3 font-medium">Brand</th>
                                            <th className="border border-(--line) px-4 py-3 font-medium">Origin</th>
                                            <th className="border border-(--line) px-4 py-3 font-medium">Rim</th>
                                            <th className="border border-(--line) px-4 py-3 font-medium">
                                                <button type="button" onClick={() => handleSort("purchasedQty")} className="cursor-pointer">
                                                    Purchased Qty{getSortIndicator("purchasedQty")}
                                                </button>
                                            </th>
                                            <th className="border border-(--line) px-4 py-3 font-medium">
                                                <button type="button" onClick={() => handleSort("currentStock")} className="cursor-pointer">
                                                    Remaining Stock{getSortIndicator("currentStock")}
                                                </button>
                                            </th>
                                            <th className="border border-(--line) px-4 py-3 font-medium">
                                                <button type="button" onClick={() => handleSort("avgTotalCostPerUnit")} className="cursor-pointer">
                                                    Avg Total Cost{getSortIndicator("avgTotalCostPerUnit")}
                                                </button>
                                            </th>
                                            <th className="border border-(--line) px-4 py-3 font-medium">
                                                <button type="button" onClick={() => handleSort("soldQty")} className="cursor-pointer">
                                                    Sold Qty{getSortIndicator("soldQty")}
                                                </button>
                                            </th>
                                            <th className="border border-(--line) px-4 py-3 font-medium">
                                                <button type="button" onClick={() => handleSort("avgSalesPrice")} className="cursor-pointer">
                                                    Avg Sales Price{getSortIndicator("avgSalesPrice")}
                                                </button>
                                            </th>
                                            <th className="border border-(--line) px-4 py-3 font-medium">
                                                <button type="button" onClick={() => handleSort("marginPercent")} className="cursor-pointer">
                                                    Margin %{getSortIndicator("marginPercent")}
                                                </button>
                                            </th>
                                            <th className="border border-(--line) px-4 py-3 font-medium">
                                                <button type="button" onClick={() => handleSort("estimatedProfitLoss")} className="cursor-pointer">
                                                    Est. Profit/Loss{getSortIndicator("estimatedProfitLoss")}
                                                </button>
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredSortedRows.length === 0 ? (
                                            <tr>
                                                <td colSpan={11} className="border border-(--line) px-4 py-6 text-center text-sm text-(--ink-soft)">
                                                    No products match &ldquo;{tableSearch}&rdquo;.
                                                </td>
                                            </tr>
                                        ) : null}
                                        {filteredSortedRows.map((row) => {
                                            const expanded = expandedProductIds.has(row.productId);
                                            return (
                                                <Fragment key={row.productId}>
                                                    <tr>
                                                        <td className="border border-(--line) px-2 py-3 text-center">
                                                            <button
                                                                type="button"
                                                                onClick={() => toggleExpanded(row.productId)}
                                                                className="inline-flex items-center justify-center rounded-lg p-1 hover:bg-(--chip)"
                                                                aria-label={expanded ? "Hide cost breakdown" : "Show cost breakdown"}
                                                            >
                                                                {expanded ? (
                                                                    <ChevronDown className="h-4 w-4" aria-hidden="true" />
                                                                ) : (
                                                                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                                                                )}
                                                            </button>
                                                        </td>
                                                        <td className="border border-(--line) px-4 py-3">
                                                            <div className="flex items-center gap-1.5">
                                                                <span>{row.productName}</span>
                                                                {row.originalCurrencies.length > 0 ? (
                                                                    <span
                                                                        title={`Originally priced in ${row.originalCurrencies.join(
                                                                            ", "
                                                                        )}, converted to ${report.currencyCode} using the home company's exchange rate.`}
                                                                        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[rgba(109,40,217,0.1)] px-1.5 py-0.5 text-[10px] font-medium text-purple-700"
                                                                    >
                                                                        <Coins className="h-3 w-3" aria-hidden="true" />
                                                                        {row.originalCurrencies.join("/")}
                                                                    </span>
                                                                ) : null}
                                                            </div>
                                                            <div className="text-xs text-(--ink-soft)">{row.categoryName}</div>
                                                            {row.flags.length > 0 ? (
                                                                <div className="mt-1 flex flex-wrap gap-1">
                                                                    {row.flags.map((flag) => (
                                                                        <span
                                                                            key={flag}
                                                                            className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${FLAG_STYLES[flag]}`}
                                                                        >
                                                                            {FLAG_LABELS[flag]}
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                            ) : null}
                                                            <button
                                                                type="button"
                                                                onClick={() => void openBreakdown(row)}
                                                                className="mt-1.5 inline-flex cursor-pointer items-center gap-1 rounded-lg border border-(--line) bg-white px-2 py-1 text-[11px] font-medium text-(--brand) hover:bg-(--chip)"
                                                            >
                                                                <ListTree className="h-3 w-3" aria-hidden="true" />
                                                                Breakdown
                                                            </button>
                                                        </td>
                                                        <td className="border border-(--line) px-4 py-3 text-(--ink-soft)">{row.brandName}</td>
                                                        <td className="border border-(--line) px-4 py-3 text-(--ink-soft)">{row.originName}</td>
                                                        <td className="border border-(--line) px-4 py-3 text-(--ink-soft)">{row.rimDiameterName}</td>
                                                        <td className="border border-(--line) px-4 py-3">{formatNumber(row.purchasedQty)}</td>
                                                        <td className="border border-(--line) px-4 py-3">{formatNumber(row.currentStock)}</td>
                                                        <td className="border border-(--line) px-4 py-3">
                                                            {formatCurrency(row.avgTotalCostPerUnit, report.currencyCode)}
                                                        </td>
                                                        <td className="border border-(--line) px-4 py-3">{formatNumber(row.soldQty)}</td>
                                                        <td className="border border-(--line) px-4 py-3">
                                                            {row.soldQty > 0 ? formatCurrency(row.avgSalesPrice, report.currencyCode) : "-"}
                                                        </td>
                                                        <td className="border border-(--line) px-4 py-3">
                                                            {row.hasSalesData ? (
                                                                <span className={row.marginPercent < 0 ? "text-red-600" : "text-(--accent)"}>
                                                                    {formatNumber(row.marginPercent)}%
                                                                </span>
                                                            ) : (
                                                                <span className="text-(--ink-soft)">-</span>
                                                            )}
                                                        </td>
                                                        <td className="border border-(--line) px-4 py-3 font-medium">
                                                            {row.hasSalesData ? (
                                                                <span className={row.estimatedProfitLoss < 0 ? "text-red-600" : ""}>
                                                                    {formatCurrency(row.estimatedProfitLoss, report.currencyCode)}
                                                                </span>
                                                            ) : (
                                                                <span className="text-(--ink-soft)">-</span>
                                                            )}
                                                        </td>
                                                    </tr>
                                                    {expanded ? (
                                                        <tr>
                                                            <td className="border border-(--line) bg-(--chip) px-4 py-4" colSpan={11}>
                                                                <p className="text-xs font-semibold uppercase tracking-wide text-(--ink-soft)">
                                                                    Cost breakdown · per unit
                                                                </p>
                                                                <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
                                                                    <div className="rounded-xl border border-(--line) bg-(--card) px-3.5 py-2.5">
                                                                        <p className="text-[11px] text-(--ink-soft)">Purchase price</p>
                                                                        <p className="mt-1 text-sm font-semibold">
                                                                            {formatCurrency(row.avgPurchasePrice, report.currencyCode)}
                                                                        </p>
                                                                    </div>
                                                                    <div className="rounded-xl border border-(--line) bg-(--card) px-3.5 py-2.5">
                                                                        <p className="text-[11px] text-(--ink-soft)">Landed cost</p>
                                                                        <p className="mt-1 text-sm font-semibold">
                                                                            {formatCurrency(row.avgLandedCostPerUnit, report.currencyCode)}
                                                                        </p>
                                                                    </div>
                                                                    <div className="rounded-xl border border-(--line) bg-(--card) px-3.5 py-2.5">
                                                                        <p className="text-[11px] text-(--ink-soft)">Operation cost</p>
                                                                        <p
                                                                            className={`mt-1 text-sm font-semibold ${
                                                                                row.avgOperationCostPerUnit < 0 ? "text-red-600" : ""
                                                                            }`}
                                                                        >
                                                                            {formatCurrency(row.avgOperationCostPerUnit, report.currencyCode)}
                                                                        </p>
                                                                    </div>
                                                                    <div className="rounded-xl border border-(--brand)/30 bg-[rgba(32,98,176,0.06)] px-3.5 py-2.5">
                                                                        <p className="text-[11px] text-(--ink-soft)">Final landed cost</p>
                                                                        <p className="mt-1 text-sm font-semibold text-(--brand)">
                                                                            {formatCurrency(row.avgFinalLandedCostPerUnit, report.currencyCode)}
                                                                        </p>
                                                                    </div>
                                                                    <div className="rounded-xl border border-(--line) bg-(--card) px-3.5 py-2.5">
                                                                        <p className="text-[11px] text-(--ink-soft)">Total cost</p>
                                                                        <p className="mt-1 text-sm font-semibold">
                                                                            {formatCurrency(row.avgTotalCostPerUnit, report.currencyCode)}
                                                                        </p>
                                                                    </div>
                                                                </div>
                                                                {row.originalCurrencies.length > 0 ? (
                                                                    <p className="mt-3 flex items-center gap-1.5 text-xs text-(--ink-soft)">
                                                                        <Coins className="h-3.5 w-3.5 text-purple-700" aria-hidden="true" />
                                                                        {`Originally priced in ${row.originalCurrencies.join(", ")}, converted to ${report.currencyCode} using the home company's exchange rate.`}
                                                                    </p>
                                                                ) : null}
                                                            </td>
                                                        </tr>
                                                    ) : null}
                                                </Fragment>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        ) : null}
                    </div>
                </div>
            ) : null}

            {breakdownProduct ? (
                <BreakdownModal
                    product={breakdownProduct}
                    currencyCode={report?.currencyCode ?? breakdown?.currencyCode ?? "AED"}
                    breakdown={breakdown}
                    loading={breakdownLoading}
                    error={breakdownError}
                    onClose={() => {
                        setBreakdownProduct(null);
                        setBreakdown(null);
                        setBreakdownError(null);
                    }}
                />
            ) : null}
        </section>
    );
}

function BreakdownSection({
    title,
    subtitle,
    rows,
    currencyCode,
    quantityLabel,
    unitLabel,
    emptyText,
}: {
    title: string;
    subtitle: string;
    rows: MarginBreakdownRow[];
    currencyCode: string;
    quantityLabel: string;
    unitLabel: string;
    emptyText: string;
}) {
    const totalQty = rows.reduce((sum, row) => sum + row.quantity, 0);
    const totalAmount = rows.reduce((sum, row) => sum + row.amount, 0);

    return (
        <section className="rounded-xl border border-(--line)">
            <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-(--line) bg-(--chip) px-4 py-2.5">
                <div>
                    <h3 className="text-sm font-semibold">
                        {title} <span className="font-normal text-(--ink-soft)">({rows.length})</span>
                    </h3>
                    <p className="text-[11px] text-(--ink-soft)">{subtitle}</p>
                </div>
                <p className="text-sm font-semibold">{formatCurrency(totalAmount, currencyCode)}</p>
            </header>

            {rows.length === 0 ? (
                <p className="px-4 py-3 text-sm text-(--ink-soft)">{emptyText}</p>
            ) : (
                <div className="max-h-72 overflow-auto">
                    <table className="min-w-full border-collapse text-left text-xs">
                        <thead className="sticky top-0 bg-(--card) text-(--ink-soft) shadow-[0_1px_0_var(--line)]">
                            <tr>
                                <th className="px-3 py-2 font-medium">Reference</th>
                                <th className="px-3 py-2 font-medium">Date</th>
                                <th className="px-3 py-2 font-medium">Partner / Order</th>
                                <th className="px-3 py-2 font-medium">Lot</th>
                                <th className="px-3 py-2 text-right font-medium">{quantityLabel}</th>
                                <th className="px-3 py-2 text-right font-medium">{unitLabel}</th>
                                <th className="px-3 py-2 text-right font-medium">Amount</th>
                                <th className="px-3 py-2 font-medium">Note</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row, index) => (
                                <tr key={`${row.reference}-${index}`} className="border-t border-(--line)">
                                    <td className="px-3 py-2 font-medium">{row.reference}</td>
                                    <td className="px-3 py-2 text-(--ink-soft)">{row.date || "-"}</td>
                                    <td className="px-3 py-2 text-(--ink-soft)">{row.partnerName || "-"}</td>
                                    <td className="px-3 py-2 text-(--ink-soft)">
                                        {row.lots.length > 0 ? row.lots.join(", ") : "-"}
                                    </td>
                                    <td className="px-3 py-2 text-right">{formatNumber(row.quantity)}</td>
                                    <td className="px-3 py-2 text-right">{formatNumber(row.unitPrice)}</td>
                                    <td className={`px-3 py-2 text-right font-medium ${row.amount < 0 ? "text-red-600" : ""}`}>
                                        {formatNumber(row.amount)}
                                    </td>
                                    <td className="px-3 py-2 text-(--ink-soft)">{row.note || "-"}</td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot className="sticky bottom-0 bg-(--chip)">
                            <tr className="border-t border-(--line) font-semibold">
                                <td className="px-3 py-2" colSpan={4}>
                                    Total
                                </td>
                                <td className="px-3 py-2 text-right">{formatNumber(totalQty)}</td>
                                <td className="px-3 py-2" />
                                <td className="px-3 py-2 text-right">{formatNumber(totalAmount)}</td>
                                <td className="px-3 py-2" />
                            </tr>
                        </tfoot>
                    </table>
                </div>
            )}
        </section>
    );
}

function BreakdownModal({
    product,
    currencyCode: reportCurrencyCode,
    breakdown,
    loading,
    error,
    onClose,
}: {
    product: ReportRow;
    currencyCode: string;
    breakdown: MarginBreakdown | null;
    loading: boolean;
    error: string | null;
    onClose: () => void;
}) {
    const [exportLoading, setExportLoading] = useState(false);
    const [exportError, setExportError] = useState<string | null>(null);

    useEffect(() => {
        function onKeyDown(event: KeyboardEvent) {
            if (event.key === "Escape") {
                onClose();
            }
        }
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [onClose]);

    const currencyCode = breakdown?.currencyCode ?? reportCurrencyCode;

    async function handleExportBreakdown() {
        if (!breakdown) return;

        setExportLoading(true);
        setExportError(null);

        try {
            const XLSX = await import("xlsx");
            const workbook = XLSX.utils.book_new();

            const summarySheet = XLSX.utils.json_to_sheet([
                {
                    Product: product.productName,
                    Brand: product.brandName,
                    Origin: product.originName,
                    Rim: product.rimDiameterName,
                    "Purchased Qty": product.purchasedQty,
                    "Remaining Stock": product.currentStock,
                    [`Avg Total Cost (${reportCurrencyCode})`]: product.avgTotalCostPerUnit,
                    "Sold Qty": product.soldQty,
                    [`Avg Sales Price (${reportCurrencyCode})`]: product.soldQty > 0 ? product.avgSalesPrice : "",
                    "Margin %": product.hasSalesData ? product.marginPercent : "",
                    [`Est. Profit/Loss (${reportCurrencyCode})`]: product.hasSalesData ? product.estimatedProfitLoss : "",
                },
            ]);
            XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");

            function appendSection(rows: MarginBreakdownRow[], sheetName: string, quantityLabel: string, unitLabel: string) {
                const data = rows.map((row) => ({
                    Reference: row.reference,
                    Date: row.date,
                    "Partner / Order": row.partnerName,
                    Lot: row.lots.join(", "),
                    [quantityLabel]: row.quantity,
                    [unitLabel]: row.unitPrice,
                    Amount: row.amount,
                    Note: row.note,
                }));
                const sheet = XLSX.utils.json_to_sheet(data.length > 0 ? data : [{ Reference: "No records" }]);
                XLSX.utils.book_append_sheet(workbook, sheet, sheetName.slice(0, 31));
            }

            appendSection(breakdown.purchases, "Purchase Orders", "Qty", `Unit (${currencyCode})`);
            appendSection(breakdown.landedCosts, "Landed Cost Records", "Qty", `Per unit (${currencyCode})`);
            appendSection(breakdown.operationCosts, "Accounting Corrections", "Share %", `Entry (${currencyCode})`);
            appendSection(breakdown.sales, "Sales Orders", "Qty", `Unit (${currencyCode})`);

            XLSX.writeFile(workbook, `${sanitizeFileName(product.productName)}-breakdown.xlsx`);
        } catch (exportErr) {
            setExportError(exportErr instanceof Error ? exportErr.message : "Failed to export breakdown.");
        } finally {
            setExportLoading(false);
        }
    }

    return (
        <div
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
            onClick={onClose}
        >
            <div
                className="w-full max-w-6xl rounded-2xl border border-(--line) bg-(--card) shadow-xl"
                onClick={(event) => event.stopPropagation()}
            >
                <header className="flex items-start justify-between gap-4 border-b border-(--line) px-5 py-4">
                    <div>
                        <h2 className="font-display text-xl">{product.productName}</h2>
                        {breakdown ? (
                            <p className="mt-0.5 text-xs text-(--ink-soft)">
                                {breakdown.startDate} → {breakdown.endDate} ·{" "}
                                {breakdown.dateBasis === "order" ? "Order date basis" : "Receiving / invoice date basis"}
                                {breakdown.unifiedLotNames.length > 0
                                    ? ` · Unified Lot ${breakdown.unifiedLotNames.join(", ")}`
                                    : ""}
                            </p>
                        ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                        {breakdown ? (
                            <button
                                type="button"
                                onClick={() => void handleExportBreakdown()}
                                disabled={exportLoading}
                                className="inline-flex items-center gap-2 rounded-xl bg-(--brand) px-3.5 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-70"
                            >
                                <Download className="h-4 w-4" aria-hidden="true" />
                                {exportLoading ? "Exporting..." : "Export Excel"}
                            </button>
                        ) : null}
                        <button
                            type="button"
                            onClick={onClose}
                            aria-label="Close breakdown"
                            className="cursor-pointer rounded-lg p-1 text-(--ink-soft) hover:bg-(--chip)"
                        >
                            <X className="h-5 w-5" aria-hidden="true" />
                        </button>
                    </div>
                </header>

                <div className="space-y-4 px-5 py-4">
                    {loading ? <p className="text-sm">Loading every underlying record…</p> : null}
                    {error ? <p className="text-sm text-red-600">{error}</p> : null}
                    {exportError ? <p className="text-sm text-red-600">{exportError}</p> : null}

                    {breakdown ? (
                        <>
                            <div className="overflow-x-auto rounded-xl border border-(--line)">
                                <table className="min-w-full border-collapse text-left text-xs">
                                    <thead className="bg-(--chip) text-(--ink-soft)">
                                        <tr>
                                            <th className="px-3 py-2 font-medium">Product</th>
                                            <th className="px-3 py-2 font-medium">Brand</th>
                                            <th className="px-3 py-2 font-medium">Origin</th>
                                            <th className="px-3 py-2 font-medium">Rim</th>
                                            <th className="px-3 py-2 text-right font-medium">Purchased Qty</th>
                                            <th className="px-3 py-2 text-right font-medium">Remaining Stock</th>
                                            <th className="px-3 py-2 text-right font-medium">Avg Total Cost</th>
                                            <th className="px-3 py-2 text-right font-medium">Sold Qty</th>
                                            <th className="px-3 py-2 text-right font-medium">Avg Sales Price</th>
                                            <th className="px-3 py-2 text-right font-medium">Margin %</th>
                                            <th className="px-3 py-2 text-right font-medium">Est. Profit/Loss</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr className="border-t border-(--line)">
                                            <td className="px-3 py-2 font-medium">{product.productName}</td>
                                            <td className="px-3 py-2 text-(--ink-soft)">{product.brandName}</td>
                                            <td className="px-3 py-2 text-(--ink-soft)">{product.originName}</td>
                                            <td className="px-3 py-2 text-(--ink-soft)">{product.rimDiameterName}</td>
                                            <td className="px-3 py-2 text-right">{formatNumber(product.purchasedQty)}</td>
                                            <td className="px-3 py-2 text-right">{formatNumber(product.currentStock)}</td>
                                            <td className="px-3 py-2 text-right">
                                                {formatCurrency(product.avgTotalCostPerUnit, reportCurrencyCode)}
                                            </td>
                                            <td className="px-3 py-2 text-right">{formatNumber(product.soldQty)}</td>
                                            <td className="px-3 py-2 text-right">
                                                {product.soldQty > 0
                                                    ? formatCurrency(product.avgSalesPrice, reportCurrencyCode)
                                                    : "-"}
                                            </td>
                                            <td className="px-3 py-2 text-right">
                                                {product.hasSalesData ? (
                                                    <span className={product.marginPercent < 0 ? "text-red-600" : "text-(--accent)"}>
                                                        {formatNumber(product.marginPercent)}%
                                                    </span>
                                                ) : (
                                                    "-"
                                                )}
                                            </td>
                                            <td className="px-3 py-2 text-right font-medium">
                                                {product.hasSalesData ? (
                                                    <span className={product.estimatedProfitLoss < 0 ? "text-red-600" : ""}>
                                                        {formatCurrency(product.estimatedProfitLoss, reportCurrencyCode)}
                                                    </span>
                                                ) : (
                                                    "-"
                                                )}
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>

                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                                {[
                                    { label: "Purchased Qty", value: formatNumber(breakdown.totals.purchasedQty) },
                                    { label: "Purchase Value", value: formatNumber(breakdown.totals.purchaseValue) },
                                    { label: "Landed Cost", value: formatNumber(breakdown.totals.landedCostValue) },
                                    { label: "Operation Cost", value: formatNumber(breakdown.totals.operationCostValue) },
                                    { label: "Sold Qty", value: formatNumber(breakdown.totals.soldQty) },
                                    { label: "Sales Value", value: formatNumber(breakdown.totals.salesValue) },
                                ].map((tile) => (
                                    <div key={tile.label} className="rounded-lg bg-(--chip) px-3 py-2">
                                        <p className="text-[10px] text-(--ink-soft)">{tile.label}</p>
                                        <p className="mt-0.5 text-sm font-semibold">{tile.value}</p>
                                    </div>
                                ))}
                            </div>

                            <BreakdownSection
                                title="Purchase Orders"
                                subtitle="Every purchase line counted toward the purchase price"
                                rows={breakdown.purchases}
                                currencyCode={currencyCode}
                                quantityLabel="Qty"
                                unitLabel={`Unit (${currencyCode})`}
                                emptyText="No purchases matched this product in the selected period."
                            />

                            <BreakdownSection
                                title="Landed Cost Records"
                                subtitle="Odoo landed-cost allocations posted against these receipts"
                                rows={breakdown.landedCosts}
                                currencyCode={currencyCode}
                                quantityLabel="Qty"
                                unitLabel={`Per unit (${currencyCode})`}
                                emptyText="No landed cost has been allocated to these receipts yet."
                            />

                            <BreakdownSection
                                title="Accounting Corrections"
                                subtitle={`Miscellaneous Operations entries on account ${"400001.1"} — "Qty" is this product's % share of the order, "Unit" the full entry, "Amount" the allocated share`}
                                rows={breakdown.operationCosts}
                                currencyCode={currencyCode}
                                quantityLabel="Share %"
                                unitLabel={`Entry (${currencyCode})`}
                                emptyText="No operation-cost corrections were found for these purchase orders."
                            />

                            <BreakdownSection
                                title="Sales Orders"
                                subtitle="Every sale counted toward the selling price, with the lot each shipped from"
                                rows={breakdown.sales}
                                currencyCode={currencyCode}
                                quantityLabel="Qty"
                                unitLabel={`Unit (${currencyCode})`}
                                emptyText="No sales matched this product in the selected period."
                            />

                            <p className="text-[11px] text-(--ink-soft)">
                                All amounts converted to {currencyCode}. These are the exact records the report totals were
                                built from — the section totals above add up to the figures on the product row.
                            </p>
                        </>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
