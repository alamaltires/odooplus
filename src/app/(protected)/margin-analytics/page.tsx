"use client";

import { Fragment, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Coins, Download, PiggyBank, Search } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import {
    getMarginAnalyticsReport,
    getProductBrands,
    getProductCategories,
    getProductOrigins,
    getProducts,
    getRimDiameters,
    searchUnifiedLots,
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
    const [selectedRimDiameter, setSelectedRimDiameter] = useState<Option | null>(null);

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
    const [selectedUnifiedLot, setSelectedUnifiedLot] = useState<Option | null>(null);

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
        selectedCategory || selectedBrand || selectedOrigin || selectedRimDiameter || selectedUnifiedLot || selectedProduct
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
            selectedRimDiameter?.name,
            selectedUnifiedLot?.name,
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
        selectedRimDiameter?.name,
        selectedUnifiedLot?.name,
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
                rimDiameterId: selectedRimDiameter?.id,
                unifiedLotId: selectedUnifiedLot?.id,
                productId: selectedProduct?.id,
                startDate,
                endDate,
                dateBasis,
            });
            setReport(data);
        } catch (generateError) {
            setReportError(generateError instanceof Error ? generateError.message : "Failed to generate margin analytics report.");
        } finally {
            setReportLoading(false);
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
                    <p className="mt-1 text-sm text-(--ink-soft)">
                        Pick at least one filter to scope exactly which products to analyze. Only purchase orders,
                        landed costs, operation-cost journal entries, and sales for those matched products (in the
                        selected date range) are counted — nothing broader is blended in.
                    </p>
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

                    <SearchableSelect
                        label="Rim Diameter"
                        placeholder="Search rim diameters"
                        query={rimDiameterQuery}
                        onQueryChange={(value) => {
                            setRimDiameterQuery(value);
                            setRimDiameterMenuOpen(true);
                            setSelectedRimDiameter(null);
                        }}
                        options={filteredRimDiameters}
                        onSelect={(option) => {
                            setSelectedRimDiameter(option);
                            setRimDiameterQuery(option.name);
                            setRimDiameterMenuOpen(false);
                        }}
                        loading={rimDiametersLoading}
                        error={rimDiametersError}
                        menuOpen={rimDiameterMenuOpen}
                        onFocus={() => setRimDiameterMenuOpen(true)}
                        onBlur={() => setRimDiameterMenuOpen(false)}
                    />

                    <label className="relative block">
                        <span className="mb-2 block text-sm font-medium">Unified Lot</span>
                        <div className="relative">
                            <Search
                                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--ink-soft)"
                                aria-hidden="true"
                            />
                            <input
                                value={unifiedLotQuery}
                                onChange={(event) => {
                                    setUnifiedLotQuery(event.target.value);
                                    setUnifiedLotMenuOpen(true);
                                    setUnifiedLotActivated(true);
                                    setSelectedUnifiedLot(null);
                                }}
                                onFocus={() => {
                                    setUnifiedLotMenuOpen(true);
                                    setUnifiedLotActivated(true);
                                }}
                                onBlur={() => window.setTimeout(() => setUnifiedLotMenuOpen(false), 120)}
                                placeholder="Search unified lot code"
                                className="w-full rounded-xl border border-(--line) bg-white py-2 pl-10 pr-3"
                            />
                        </div>

                        {unifiedLotMenuOpen ? (
                            <ul
                                onScroll={(event) => {
                                    const target = event.currentTarget;
                                    if (target.scrollHeight - target.scrollTop - target.clientHeight < SCROLL_LOAD_MORE_THRESHOLD_PX) {
                                        loadMoreUnifiedLots();
                                    }
                                }}
                                className="absolute z-20 mt-2 max-h-64 w-full overflow-auto rounded-xl border border-(--line) bg-white p-1 shadow-lg"
                            >
                                {unifiedLotQuery.trim().length < MIN_SEARCH_QUERY_LENGTH ? (
                                    <li className="px-3 py-2 text-sm text-(--ink-soft)">
                                        Type at least {MIN_SEARCH_QUERY_LENGTH} characters to search.
                                    </li>
                                ) : unifiedLotLoading ? (
                                    <li className="px-3 py-2 text-sm text-(--ink-soft)">Searching...</li>
                                ) : unifiedLotResults.length === 0 ? (
                                    <li className="px-3 py-2 text-sm text-(--ink-soft)">No unified lots found.</li>
                                ) : (
                                    <>
                                        {unifiedLotResults.map((lot) => (
                                            <li key={lot.id}>
                                                <button
                                                    type="button"
                                                    onMouseDown={() => {
                                                        setSelectedUnifiedLot(lot);
                                                        setUnifiedLotQuery(lot.name);
                                                        setUnifiedLotMenuOpen(false);
                                                    }}
                                                    className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-(--chip)"
                                                >
                                                    {lot.name}
                                                </button>
                                            </li>
                                        ))}
                                        {unifiedLotLoadingMore ? (
                                            <li className="px-3 py-2 text-center text-xs text-(--ink-soft)">Loading more...</li>
                                        ) : null}
                                    </>
                                )}
                            </ul>
                        ) : null}
                    </label>

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
                        <p className="mt-1 text-xs text-(--ink-soft)">
                            {dateBasis === "order"
                                ? "Scopes by the order's own date — when the PO or SO was placed, regardless of when goods moved or invoices were raised."
                                : "Scopes by when goods were actually received (purchases) and when the customer invoice was raised (sales) — a PO placed in one month but received the next counts toward the month it was received."}
                        </p>
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

                {!hasAnyFilter ? (
                    <p className="mt-4 text-xs text-(--ink-soft)">
                        Select a product, category, brand, origin, rim diameter, or unified lot (or mix them) to generate a report.
                    </p>
                ) : null}

                {reportError ? <p className="mt-4 text-sm text-red-600">{reportError}</p> : null}
            </form>

            {report ? (
                <div className="mt-6 space-y-6">
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                        <article className="rounded-2xl border border-(--line) bg-(--card) p-5 shadow-[0_8px_20px_rgba(8,23,41,0.05)]">
                            <p className="text-sm text-(--ink-soft)">
                                Avg Total Cost / Unit ({report.startDate} → {report.endDate})
                            </p>
                            <p className="mt-2 font-display text-3xl">
                                {formatCurrency(report.highlights.avgTotalCostPerUnit, report.currencyCode)}
                            </p>
                            <p className="mt-1 text-xs text-(--ink-soft)">
                                Purchase {formatCurrency(report.highlights.avgPurchasePrice, report.currencyCode)} · Landed{" "}
                                {formatCurrency(report.highlights.avgLandedCostPerUnit, report.currencyCode)} · Operation{" "}
                                {formatCurrency(report.highlights.avgOperationCostPerUnit, report.currencyCode)}
                            </p>
                        </article>
                        <article className="rounded-2xl border border-(--line) bg-(--card) p-5 shadow-[0_8px_20px_rgba(8,23,41,0.05)]">
                            <p className="text-sm text-(--ink-soft)">Avg Sales Price</p>
                            <p className="mt-2 font-display text-3xl">
                                {formatCurrency(report.highlights.avgSalesPrice, report.currencyCode)}
                            </p>
                            <p className="mt-1 text-xs text-(--ink-soft)">
                                {report.highlights.productsWithSales} of {report.matchedProductCount} products sold in period
                            </p>
                        </article>
                        <article className="rounded-2xl border border-(--line) bg-(--card) p-5 shadow-[0_8px_20px_rgba(8,23,41,0.05)]">
                            <p className="text-sm text-(--ink-soft)">Avg Margin %</p>
                            <p
                                className={`mt-2 font-display text-3xl ${
                                    report.highlights.avgMarginPercent < 0 ? "text-red-600" : ""
                                }`}
                            >
                                {formatNumber(report.highlights.avgMarginPercent)}%
                            </p>
                            <p className="mt-1 text-xs text-(--ink-soft)">Blended across all sold, matched products</p>
                        </article>
                        <article className="rounded-2xl border border-(--line) bg-(--card) p-5 shadow-[0_8px_20px_rgba(8,23,41,0.05)]">
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
                            <p className="mt-1 text-sm text-(--ink-soft)">
                                Products worth a closer look — no landed cost posted yet (understates true cost), never
                                sold in this period, sold without a matching purchase, a negative margin, or a
                                cost-correction journal entry.
                            </p>
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
                                <p className="mt-1 text-sm text-(--ink-soft)">
                                    Margin % and profit/loss are shown only for products purchased and sold within the period.
                                </p>
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
                                                            <td className="border border-(--line) bg-(--chip) px-4 py-3" />
                                                            <td colSpan={10} className="border border-(--line) bg-(--chip) px-4 py-3">
                                                                <p className="text-xs font-medium text-(--ink)">Cost breakdown (per unit)</p>
                                                                <div className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-3">
                                                                    <div className="flex items-center justify-between gap-3 text-sm">
                                                                        <span className="text-(--ink-soft)">Purchase price</span>
                                                                        <span className="font-medium">
                                                                            {formatCurrency(row.avgPurchasePrice, report.currencyCode)}
                                                                        </span>
                                                                    </div>
                                                                    <div className="flex items-center justify-between gap-3 text-sm">
                                                                        <span className="text-(--ink-soft)">Landed cost</span>
                                                                        <span className="font-medium">
                                                                            {formatCurrency(row.avgLandedCostPerUnit, report.currencyCode)}
                                                                        </span>
                                                                    </div>
                                                                    <div className="flex items-center justify-between gap-3 text-sm">
                                                                        <span className="text-(--ink-soft)">Operation cost</span>
                                                                        <span className="font-medium">
                                                                            {formatCurrency(row.avgOperationCostPerUnit, report.currencyCode)}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                                {row.originalCurrencies.length > 0 ? (
                                                                    <p className="mt-2 flex items-center gap-1 text-xs text-(--ink-soft)">
                                                                        <Coins className="h-3.5 w-3.5 text-purple-700" aria-hidden="true" />
                                                                        Originally priced in {row.originalCurrencies.join(", ")}, converted
                                                                        to {report.currencyCode} above using the home company&rsquo;s
                                                                        exchange rate.
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
        </section>
    );
}
