"use client";

import { Fragment, FormEvent, UIEvent, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Download, Search, TrendingUp } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import {
    getProductBrands,
    getProductCategories,
    getProducts,
    getProductsPerformanceReport,
    searchPurchaseOrders,
} from "@/lib/client-odoo";

type Category = {
    id: number;
    name: string;
    model: "product.public.category" | "product.category";
};

type Brand = {
    id: number;
    name: string;
};

type PurchaseOrderOption = {
    id: number;
    name: string;
    vendorName: string;
    dateOrder: string;
};

type ProductOption = {
    id: number;
    name: string;
};

type WarehouseStock = {
    warehouseId: number;
    warehouseName: string;
    quantity: number;
};

type ReportRow = {
    productId: number;
    productName: string;
    brandName: string;
    categoryName: string;
    lots: string[];
    soldQty: number;
    salesValue: number;
    averageSellingPrice: number;
    purchasedQty: number;
    averagePurchasePrice: number;
    totalStock: number;
    stockByWarehouse: WarehouseStock[];
};

type PurchaseOrderDetails = {
    name: string;
    vendorName: string;
    vendorReference: string;
    confirmationDate: string;
    expectedArrival: string;
    arrival: string;
    deliverTo: string;
};

type Report = {
    startDate: string;
    endDate: string;
    currencyCode: string;
    matchedProductCount: number;
    rows: ReportRow[];
    totals: { soldQty: number; salesValue: number; purchasedQty: number; totalStock: number };
    unconvertedCurrencyCodes: string[];
    purchaseOrderDetails: PurchaseOrderDetails | null;
};

type SortColumn =
    | "productName"
    | "soldQty"
    | "averageSellingPrice"
    | "salesValue"
    | "purchasedQty"
    | "averagePurchasePrice"
    | "totalStock";
type SortDirection = "asc" | "desc";

function todayISO() {
    return new Date().toISOString().slice(0, 10);
}

function formatNumber(value: number) {
    return value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatCurrency(value: number, currencyCode: string) {
    return `${currencyCode} ${formatNumber(value)}`;
}

function formatDateTime(value: string) {
    return value ? value.replace("T", " ") : "-";
}

const SEARCH_PAGE_SIZE = 20;
const MIN_SEARCH_QUERY_LENGTH = 3;
const SCROLL_LOAD_MORE_THRESHOLD_PX = 48;

function sanitizeFileName(value: string) {
    return (
        value
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "") || "report"
    );
}

export default function ProductsPerformancePage() {
    const { user } = useAuth();
    const hasLoadedCategoriesRef = useRef(false);
    const hasLoadedBrandsRef = useRef(false);

    const [categories, setCategories] = useState<Category[]>([]);
    const [categoriesLoading, setCategoriesLoading] = useState(true);
    const [categoriesError, setCategoriesError] = useState<string | null>(null);
    const [categoryQuery, setCategoryQuery] = useState("");
    const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
    const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);

    const [brands, setBrands] = useState<Brand[]>([]);
    const [brandsLoading, setBrandsLoading] = useState(true);
    const [brandsError, setBrandsError] = useState<string | null>(null);
    const [brandQuery, setBrandQuery] = useState("");
    const [brandMenuOpen, setBrandMenuOpen] = useState(false);
    const [selectedBrand, setSelectedBrand] = useState<Brand | null>(null);

    const [poQuery, setPoQuery] = useState("");
    const [poActivated, setPoActivated] = useState(false);
    const [poMenuOpen, setPoMenuOpen] = useState(false);
    const [poResults, setPoResults] = useState<PurchaseOrderOption[]>([]);
    const [poLoading, setPoLoading] = useState(false);
    const [poLoadingMore, setPoLoadingMore] = useState(false);
    const [poOffset, setPoOffset] = useState(0);
    const [poHasMore, setPoHasMore] = useState(false);
    const [selectedPurchaseOrder, setSelectedPurchaseOrder] = useState<PurchaseOrderOption | null>(null);

    const [productQuery, setProductQuery] = useState("");
    const [productActivated, setProductActivated] = useState(false);
    const [productMenuOpen, setProductMenuOpen] = useState(false);
    const [productResults, setProductResults] = useState<ProductOption[]>([]);
    const [productLoading, setProductLoading] = useState(false);
    const [productLoadingMore, setProductLoadingMore] = useState(false);
    const [productOffset, setProductOffset] = useState(0);
    const [productHasMore, setProductHasMore] = useState(false);
    const [selectedProduct, setSelectedProduct] = useState<ProductOption | null>(null);

    const [startDate, setStartDate] = useState(() => {
        const now = new Date();
        now.setMonth(now.getMonth() - 1);
        return now.toISOString().slice(0, 10);
    });
    const [endDate, setEndDate] = useState(todayISO);

    const [report, setReport] = useState<Report | null>(null);
    const [reportLoading, setReportLoading] = useState(false);
    const [reportError, setReportError] = useState<string | null>(null);

    const [tableSearch, setTableSearch] = useState("");
    const [sortColumn, setSortColumn] = useState<SortColumn>("soldQty");
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
                setCategoriesError(
                    loadError instanceof Error ? loadError.message : "Failed to load product categories."
                );
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
        if (!poActivated) {
            return;
        }

        const trimmedQuery = poQuery.trim();
        if (trimmedQuery.length < MIN_SEARCH_QUERY_LENGTH) {
            setPoResults([]);
            setPoHasMore(false);
            setPoOffset(0);
            return;
        }

        const debounceId = window.setTimeout(() => {
            setPoLoading(true);
            searchPurchaseOrders({ query: trimmedQuery, limit: SEARCH_PAGE_SIZE, offset: 0 })
                .then((data) => {
                    setPoResults(data.purchaseOrders);
                    setPoHasMore(data.hasMore);
                    setPoOffset(data.purchaseOrders.length);
                })
                .catch(() => {
                    setPoResults([]);
                    setPoHasMore(false);
                })
                .finally(() => setPoLoading(false));
        }, 250);

        return () => window.clearTimeout(debounceId);
    }, [poActivated, poQuery]);

    function loadMorePurchaseOrders() {
        const trimmedQuery = poQuery.trim();
        if (poLoading || poLoadingMore || !poHasMore || trimmedQuery.length < MIN_SEARCH_QUERY_LENGTH) {
            return;
        }

        setPoLoadingMore(true);
        searchPurchaseOrders({ query: trimmedQuery, limit: SEARCH_PAGE_SIZE, offset: poOffset })
            .then((data) => {
                setPoResults((current) => [...current, ...data.purchaseOrders]);
                setPoHasMore(data.hasMore);
                setPoOffset((current) => current + data.purchaseOrders.length);
            })
            .catch(() => setPoHasMore(false))
            .finally(() => setPoLoadingMore(false));
    }

    function handlePoResultsScroll(event: UIEvent<HTMLUListElement>) {
        const target = event.currentTarget;
        if (target.scrollHeight - target.scrollTop - target.clientHeight < SCROLL_LOAD_MORE_THRESHOLD_PX) {
            loadMorePurchaseOrders();
        }
    }

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

    function handleProductResultsScroll(event: UIEvent<HTMLUListElement>) {
        const target = event.currentTarget;
        if (target.scrollHeight - target.scrollTop - target.clientHeight < SCROLL_LOAD_MORE_THRESHOLD_PX) {
            loadMoreProducts();
        }
    }

    const filteredCategories = useMemo(() => {
        if (!categoryQuery.trim()) {
            return categories;
        }

        const query = categoryQuery.toLowerCase();
        return categories.filter((category) => category.name.toLowerCase().includes(query));
    }, [categoryQuery, categories]);

    const filteredBrands = useMemo(() => {
        if (!brandQuery.trim()) {
            return brands;
        }

        const query = brandQuery.toLowerCase();
        return brands.filter((brand) => brand.name.toLowerCase().includes(query));
    }, [brandQuery, brands]);

    const hasAnyScanner = Boolean(selectedPurchaseOrder || selectedProduct || selectedBrand || selectedCategory);

    const filteredSortedRows = useMemo(() => {
        if (!report) {
            return [];
        }

        const query = tableSearch.trim().toLowerCase();
        const filtered = query
            ? report.rows.filter(
                  (row) =>
                      row.productName.toLowerCase().includes(query) ||
                      row.brandName.toLowerCase().includes(query) ||
                      row.categoryName.toLowerCase().includes(query)
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

    const exportFileName = useMemo(() => {
        const parts = [
            selectedPurchaseOrder?.name,
            selectedProduct?.name,
            selectedBrand?.name,
            selectedCategory?.name,
        ].filter(Boolean);
        const scope = parts.join("-") || "products-performance";
        return `products-performance-${sanitizeFileName(scope)}-${startDate}-to-${endDate}`;
    }, [endDate, selectedBrand?.name, selectedCategory?.name, selectedProduct?.name, selectedPurchaseOrder?.name, startDate]);

    async function handleGenerate(event: FormEvent) {
        event.preventDefault();
        if (!hasAnyScanner) {
            return;
        }

        setReportLoading(true);
        setReportError(null);
        setTableSearch("");
        setExpandedProductIds(new Set());

        try {
            const data = await getProductsPerformanceReport({
                purchaseOrderId: selectedPurchaseOrder?.id,
                productId: selectedProduct?.id,
                brandId: selectedBrand?.id,
                categoryId: selectedCategory?.id,
                startDate,
                endDate,
            });

            setReport(data);
        } catch (generateError) {
            setReportError(
                generateError instanceof Error ? generateError.message : "Failed to generate products performance report."
            );
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
        if (sortColumn !== column) {
            return "";
        }

        return sortDirection === "asc" ? " ▲" : " ▼";
    }

    async function handleExport(format: "csv" | "xlsx") {
        if (!report || filteredSortedRows.length === 0) {
            return;
        }

        setExportLoading(format);
        setReportError(null);

        try {
            const XLSX = await import("xlsx");
            const exportData = filteredSortedRows.map((row) => ({
                "Product Name": row.productName,
                Brand: row.brandName,
                Category: row.categoryName,
                Lot: row.lots.join(", "),
                "Sold Qty": row.soldQty,
                [`Avg Selling Price (${report.currencyCode})`]: row.averageSellingPrice,
                [`Sales Value (${report.currencyCode})`]: row.salesValue,
                "Purchased Qty": row.purchasedQty,
                [`Avg Purchase Price (${report.currencyCode})`]: row.averagePurchasePrice,
                "Total Stock": row.totalStock,
                Warehouses: row.stockByWarehouse
                    .map((warehouse) => `${warehouse.warehouseName}: ${warehouse.quantity}`)
                    .join("; "),
            }));

            const worksheet = XLSX.utils.json_to_sheet(exportData);
            worksheet["!cols"] = [
                { wch: 42 },
                { wch: 18 },
                { wch: 20 },
                { wch: 16 },
                { wch: 12 },
                { wch: 18 },
                { wch: 18 },
                { wch: 14 },
                { wch: 20 },
                { wch: 12 },
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
            XLSX.utils.book_append_sheet(workbook, worksheet, "Products Performance");
            XLSX.writeFile(workbook, `${exportFileName}.xlsx`);
        } catch (exportError) {
            setReportError(
                exportError instanceof Error ? exportError.message : "Failed to export products performance report."
            );
        } finally {
            setExportLoading(null);
        }
    }

    return (
        <section>
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="font-display text-3xl">Products Performance</h1>
                    <p className="mt-1 text-sm text-(--ink-soft)">
                        Scan a purchase order, product, brand, or category — or mix them — to see how much sold and
                        how much is left in stock, between two dates. Selecting a purchase order starts the date
                        range from its order date, and the figures cover this product across every purchase order
                        (Odoo can&apos;t reliably trace individual units back to one specific order).
                    </p>
                </div>
                <TrendingUp className="h-8 w-8 text-(--brand)" aria-hidden="true" />
            </div>

            <form onSubmit={handleGenerate} className="mt-6 rounded-2xl border border-(--line) bg-(--card) p-5">
                <div className="grid gap-4 lg:grid-cols-2">
                    <label className="relative block">
                        <span className="mb-2 block text-sm font-medium">Purchase Order</span>
                        <div className="relative">
                            <Search
                                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--ink-soft)"
                                aria-hidden="true"
                            />
                            <input
                                value={poQuery}
                                onChange={(event) => {
                                    setPoQuery(event.target.value);
                                    setPoMenuOpen(true);
                                    setPoActivated(true);
                                    setSelectedPurchaseOrder(null);
                                }}
                                onFocus={() => {
                                    setPoMenuOpen(true);
                                    setPoActivated(true);
                                }}
                                onBlur={() => window.setTimeout(() => setPoMenuOpen(false), 120)}
                                placeholder="Search purchase order number"
                                className="w-full rounded-xl border border-(--line) bg-white py-2 pl-10 pr-3"
                            />
                        </div>

                        {poMenuOpen ? (
                            <ul
                                onScroll={handlePoResultsScroll}
                                className="absolute z-20 mt-2 max-h-64 w-full overflow-auto rounded-xl border border-(--line) bg-white p-1 shadow-lg"
                            >
                                {poQuery.trim().length < MIN_SEARCH_QUERY_LENGTH ? (
                                    <li className="px-3 py-2 text-sm text-(--ink-soft)">
                                        Type at least {MIN_SEARCH_QUERY_LENGTH} characters to search.
                                    </li>
                                ) : poLoading ? (
                                    <li className="px-3 py-2 text-sm text-(--ink-soft)">Searching...</li>
                                ) : poResults.length === 0 ? (
                                    <li className="px-3 py-2 text-sm text-(--ink-soft)">No purchase orders found.</li>
                                ) : (
                                    <>
                                        {poResults.map((po) => (
                                            <li key={po.id}>
                                                <button
                                                    type="button"
                                                    onMouseDown={() => {
                                                        setSelectedPurchaseOrder(po);
                                                        setPoQuery(po.name);
                                                        setPoMenuOpen(false);
                                                        if (po.dateOrder.length >= 10) {
                                                            const poDate = po.dateOrder.slice(0, 10);
                                                            setStartDate(poDate);
                                                            setEndDate((current) => (current < poDate ? todayISO() : current));
                                                        }
                                                    }}
                                                    className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-(--chip)"
                                                >
                                                    <span className="font-medium">{po.name}</span>
                                                    <span className="ml-2 text-(--ink-soft)">
                                                        {po.vendorName} · {po.dateOrder.slice(0, 10)}
                                                    </span>
                                                </button>
                                            </li>
                                        ))}
                                        {poLoadingMore ? (
                                            <li className="px-3 py-2 text-center text-xs text-(--ink-soft)">Loading more...</li>
                                        ) : null}
                                    </>
                                )}
                            </ul>
                        ) : null}
                    </label>

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
                                placeholder="Search product by name"
                                className="w-full rounded-xl border border-(--line) bg-white py-2 pl-10 pr-3"
                            />
                        </div>

                        {productMenuOpen ? (
                            <ul
                                onScroll={handleProductResultsScroll}
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

                    <label className="relative block">
                        <span className="mb-2 block text-sm font-medium">Brand</span>
                        <div className="relative">
                            <Search
                                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--ink-soft)"
                                aria-hidden="true"
                            />
                            <input
                                value={brandQuery}
                                onChange={(event) => {
                                    setBrandQuery(event.target.value);
                                    setBrandMenuOpen(true);
                                    setSelectedBrand(null);
                                }}
                                onFocus={() => setBrandMenuOpen(true)}
                                onBlur={() => window.setTimeout(() => setBrandMenuOpen(false), 120)}
                                placeholder={brandsLoading ? "Loading brands..." : "Search brands"}
                                className="w-full rounded-xl border border-(--line) bg-white py-2 pl-10 pr-3"
                                disabled={brandsLoading || Boolean(brandsError)}
                            />
                        </div>

                        {brandMenuOpen && filteredBrands.length > 0 ? (
                            <ul className="absolute z-20 mt-2 max-h-64 w-full overflow-auto rounded-xl border border-(--line) bg-white p-1 shadow-lg">
                                {filteredBrands.map((brand) => (
                                    <li key={brand.id}>
                                        <button
                                            type="button"
                                            onMouseDown={() => {
                                                setSelectedBrand(brand);
                                                setBrandQuery(brand.name);
                                                setBrandMenuOpen(false);
                                            }}
                                            className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-(--chip)"
                                        >
                                            {brand.name}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        ) : null}
                    </label>

                    <label className="relative block">
                        <span className="mb-2 block text-sm font-medium">Category</span>
                        <div className="relative">
                            <Search
                                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--ink-soft)"
                                aria-hidden="true"
                            />
                            <input
                                value={categoryQuery}
                                onChange={(event) => {
                                    setCategoryQuery(event.target.value);
                                    setCategoryMenuOpen(true);
                                    setSelectedCategory(null);
                                }}
                                onFocus={() => setCategoryMenuOpen(true)}
                                onBlur={() => window.setTimeout(() => setCategoryMenuOpen(false), 120)}
                                placeholder={categoriesLoading ? "Loading categories..." : "Search categories"}
                                className="w-full rounded-xl border border-(--line) bg-white py-2 pl-10 pr-3"
                                disabled={categoriesLoading || Boolean(categoriesError)}
                            />
                        </div>

                        {categoryMenuOpen && filteredCategories.length > 0 ? (
                            <ul className="absolute z-20 mt-2 max-h-64 w-full overflow-auto rounded-xl border border-(--line) bg-white p-1 shadow-lg">
                                {filteredCategories.map((category) => (
                                    <li key={category.id}>
                                        <button
                                            type="button"
                                            onMouseDown={() => {
                                                setSelectedCategory(category);
                                                setCategoryQuery(category.name);
                                                setCategoryMenuOpen(false);
                                            }}
                                            className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-(--chip)"
                                        >
                                            {category.name}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        ) : null}
                    </label>

                    <div className="grid gap-4 sm:grid-cols-2 lg:col-span-2">
                        <label className="block">
                            <span className="mb-2 block text-sm font-medium">Start Date</span>
                            <input
                                type="date"
                                value={startDate}
                                onChange={(event) => setStartDate(event.target.value)}
                                disabled={Boolean(selectedPurchaseOrder)}
                                className="w-full rounded-xl border border-(--line) bg-white px-3 py-2 disabled:cursor-not-allowed disabled:bg-(--chip) disabled:text-(--ink-soft)"
                                required
                            />
                            {selectedPurchaseOrder ? (
                                <p className="mt-1 text-xs text-(--ink-soft)">
                                    Locked to {selectedPurchaseOrder.name}&apos;s order date. Clear the purchase order to edit it.
                                </p>
                            ) : null}
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
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-3">
                    <button
                        type="submit"
                        disabled={reportLoading || !hasAnyScanner}
                        className="rounded-xl bg-(--brand) px-5 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-70"
                    >
                        {reportLoading ? "Generating..." : "Generate Report"}
                    </button>
                    {report ? (
                        <p className="text-sm text-(--ink-soft)">{report.matchedProductCount} product(s) matched.</p>
                    ) : null}
                </div>

                {!hasAnyScanner ? (
                    <p className="mt-4 text-xs text-(--ink-soft)">
                        Select a purchase order, product, brand, or category (or mix them) to generate a report.
                    </p>
                ) : null}

                {categoriesError ? <p className="mt-4 text-sm text-red-600">{categoriesError}</p> : null}
                {brandsError ? <p className="mt-4 text-sm text-red-600">{brandsError}</p> : null}
                {reportError ? <p className="mt-4 text-sm text-red-600">{reportError}</p> : null}
            </form>

            {report ? (
                <div className="mt-6 space-y-6">
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                        <article className="rounded-2xl border border-(--line) bg-(--card) p-5 shadow-[0_8px_20px_rgba(8,23,41,0.05)]">
                            <p className="text-sm text-(--ink-soft)">Sold Qty ({report.startDate} → {report.endDate})</p>
                            <p className="mt-2 font-display text-3xl">{formatNumber(report.totals.soldQty)}</p>
                        </article>
                        <article className="rounded-2xl border border-(--line) bg-(--card) p-5 shadow-[0_8px_20px_rgba(8,23,41,0.05)]">
                            <p className="text-sm text-(--ink-soft)">Sales Value ({report.currencyCode})</p>
                            <p className="mt-2 font-display text-3xl">{formatCurrency(report.totals.salesValue, report.currencyCode)}</p>
                        </article>
                        <article className="rounded-2xl border border-(--line) bg-(--card) p-5 shadow-[0_8px_20px_rgba(8,23,41,0.05)]">
                            <p className="text-sm text-(--ink-soft)">Purchased Qty ({report.startDate} → {report.endDate})</p>
                            <p className="mt-2 font-display text-3xl">{formatNumber(report.totals.purchasedQty)}</p>
                        </article>
                        <article className="rounded-2xl border border-(--line) bg-(--card) p-5 shadow-[0_8px_20px_rgba(8,23,41,0.05)]">
                            <p className="text-sm text-(--ink-soft)">Current Stock (all warehouses)</p>
                            <p className="mt-2 font-display text-3xl">{formatNumber(report.totals.totalStock)}</p>
                        </article>
                    </div>

                    {report.unconvertedCurrencyCodes.length > 0 ? (
                        <p className="text-sm text-red-600">
                            No exchange rate is configured for {report.unconvertedCurrencyCodes.join(", ")} at your
                            home company — sales in those currencies are excluded from the sales value above.
                        </p>
                    ) : null}

                    {report.purchaseOrderDetails ? (
                        <div className="rounded-2xl border border-(--line) bg-(--card) p-5">
                            <h2 className="font-display text-2xl">Purchase Order Details</h2>
                            <p className="mt-1 text-sm text-(--ink-soft)">
                                {report.purchaseOrderDetails.name} — this applies to the whole report, not per warehouse.
                            </p>
                            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                                <div>
                                    <p className="text-xs text-(--ink-soft)">Vendor</p>
                                    <p className="mt-1 text-sm font-medium">{report.purchaseOrderDetails.vendorName || "-"}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-(--ink-soft)">Vendor Reference</p>
                                    <p className="mt-1 text-sm font-medium">{report.purchaseOrderDetails.vendorReference || "-"}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-(--ink-soft)">Deliver To</p>
                                    <p className="mt-1 text-sm font-medium">{report.purchaseOrderDetails.deliverTo || "-"}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-(--ink-soft)">Confirmation Date</p>
                                    <p className="mt-1 text-sm font-medium">{formatDateTime(report.purchaseOrderDetails.confirmationDate)}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-(--ink-soft)">Expected Arrival</p>
                                    <p className="mt-1 text-sm font-medium">{formatDateTime(report.purchaseOrderDetails.expectedArrival)}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-(--ink-soft)">Arrival</p>
                                    <p className="mt-1 text-sm font-medium">{formatDateTime(report.purchaseOrderDetails.arrival)}</p>
                                </div>
                            </div>
                        </div>
                    ) : null}

                    <div className="rounded-2xl border border-(--line) bg-(--card) p-5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                                <h2 className="font-display text-2xl">Product Performance</h2>
                                <p className="mt-1 text-sm text-(--ink-soft)">
                                    Average selling price is total sales value divided by quantity sold in the selected period.
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
                            <p className="mt-3 text-sm text-(--ink-soft)">
                                No products matched these filters for the selected period.
                            </p>
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
                                    placeholder="Search products, brands, or categories…"
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
                                            <th className="border border-(--line) px-4 py-3 font-medium">Category</th>
                                            <th className="border border-(--line) px-4 py-3 font-medium">Lot</th>
                                            <th className="border border-(--line) px-4 py-3 font-medium">
                                                <button type="button" onClick={() => handleSort("soldQty")} className="cursor-pointer">
                                                    Sold Qty{getSortIndicator("soldQty")}
                                                </button>
                                            </th>
                                            <th className="border border-(--line) px-4 py-3 font-medium">
                                                <button type="button" onClick={() => handleSort("averageSellingPrice")} className="cursor-pointer">
                                                    Avg Selling Price{getSortIndicator("averageSellingPrice")}
                                                </button>
                                            </th>
                                            <th className="border border-(--line) px-4 py-3 font-medium">
                                                <button type="button" onClick={() => handleSort("salesValue")} className="cursor-pointer">
                                                    Sales Value{getSortIndicator("salesValue")}
                                                </button>
                                            </th>
                                            <th className="border border-(--line) px-4 py-3 font-medium">
                                                <button type="button" onClick={() => handleSort("purchasedQty")} className="cursor-pointer">
                                                    Purchased Qty{getSortIndicator("purchasedQty")}
                                                </button>
                                            </th>
                                            <th className="border border-(--line) px-4 py-3 font-medium">
                                                <button type="button" onClick={() => handleSort("averagePurchasePrice")} className="cursor-pointer">
                                                    Avg Purchase Price{getSortIndicator("averagePurchasePrice")}
                                                </button>
                                            </th>
                                            <th className="border border-(--line) px-4 py-3 font-medium">
                                                <button type="button" onClick={() => handleSort("totalStock")} className="cursor-pointer">
                                                    Total Stock{getSortIndicator("totalStock")}
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
                                                            {row.stockByWarehouse.length > 0 ? (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => toggleExpanded(row.productId)}
                                                                    className="inline-flex items-center justify-center rounded-lg p-1 hover:bg-(--chip)"
                                                                    aria-label={expanded ? "Hide warehouse breakdown" : "Show warehouse breakdown"}
                                                                >
                                                                    {expanded ? (
                                                                        <ChevronDown className="h-4 w-4" aria-hidden="true" />
                                                                    ) : (
                                                                        <ChevronRight className="h-4 w-4" aria-hidden="true" />
                                                                    )}
                                                                </button>
                                                            ) : null}
                                                        </td>
                                                        <td className="border border-(--line) px-4 py-3">{row.productName}</td>
                                                        <td className="border border-(--line) px-4 py-3 text-(--ink-soft)">{row.brandName}</td>
                                                        <td className="border border-(--line) px-4 py-3 text-(--ink-soft)">{row.categoryName}</td>
                                                        <td className="border border-(--line) px-4 py-3 text-(--ink-soft)">
                                                            {row.lots.length > 0 ? row.lots.join(", ") : "-"}
                                                        </td>
                                                        <td className="border border-(--line) px-4 py-3">{formatNumber(row.soldQty)}</td>
                                                        <td className="border border-(--line) px-4 py-3">
                                                            {formatCurrency(row.averageSellingPrice, report.currencyCode)}
                                                        </td>
                                                        <td className="border border-(--line) px-4 py-3">
                                                            {formatCurrency(row.salesValue, report.currencyCode)}
                                                        </td>
                                                        <td className="border border-(--line) px-4 py-3">
                                                            {formatNumber(row.purchasedQty)}
                                                        </td>
                                                        <td className="border border-(--line) px-4 py-3">
                                                            {formatCurrency(row.averagePurchasePrice, report.currencyCode)}
                                                        </td>
                                                        <td className="border border-(--line) px-4 py-3 font-medium">
                                                            {formatNumber(row.totalStock)}
                                                        </td>
                                                    </tr>
                                                    {expanded ? (
                                                        <tr>
                                                            <td className="border border-(--line) bg-(--chip) px-4 py-3" />
                                                            <td colSpan={10} className="border border-(--line) bg-(--chip) px-4 py-3">
                                                                <p className="text-xs font-medium text-(--ink)">
                                                                    Stock by warehouse
                                                                </p>
                                                                <div className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
                                                                    {row.stockByWarehouse.map((warehouse) => (
                                                                        <div
                                                                            key={warehouse.warehouseId}
                                                                            className="flex items-center justify-between gap-3 text-sm"
                                                                        >
                                                                            <span className="text-(--ink-soft)">{warehouse.warehouseName}</span>
                                                                            <span className="font-medium">{formatNumber(warehouse.quantity)}</span>
                                                                        </div>
                                                                    ))}
                                                                </div>
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
