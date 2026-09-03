"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Download, FileSpreadsheet, Search } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { getProductBrands, getProductCategories, getPurchaseOrderReport } from "@/lib/client-odoo";

type Category = {
    id: number;
    name: string;
    model: "product.public.category" | "product.category";
};

type Brand = {
    id: number;
    name: string;
};

type ReportRow = {
    productId: number;
    productName: string;
    soldInPeriod: number;
    currentStock: number;
    averageMonthlySales: number;
    suggestedRestock: number;
    pendingFromBackorders: number;
};

type DisplayReportRow = ReportRow & {
    restockDisplayValue: string;
    roundedSuggestedRestock: number | null;
    isOverStock: boolean;
    suggestedRestockWithPending: number;
};

type SortColumn =
    | "productName"
    | "soldInPeriod"
    | "currentStock"
    | "averageMonthlySales"
    | "suggestedRestock";

type SortDirection = "asc" | "desc";

function todayISO() {
    return new Date().toISOString().slice(0, 10);
}

function formatSuggestedRestock(
    suggestedRestock: number,
    currentStock: number,
    averageMonthlySales: number
) {
    if (suggestedRestock <= 0) {
        const overStockAmount = Math.max(0, Math.ceil(currentStock - averageMonthlySales));
        return {
            restockDisplayValue: `Over stock by ${overStockAmount}`,
            roundedSuggestedRestock: null,
            isOverStock: true,
        };
    }

    return {
        restockDisplayValue: String(Math.ceil(suggestedRestock)),
        roundedSuggestedRestock: Math.ceil(suggestedRestock),
        isOverStock: false,
    };
}

function sanitizeFileName(value: string) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "report";
}

export default function PurchaseOrderPage() {
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

    const [startDate, setStartDate] = useState(() => {
        const now = new Date();
        now.setMonth(now.getMonth() - 1);
        return now.toISOString().slice(0, 10);
    });
    const [endDate, setEndDate] = useState(todayISO);
    const [stockDurationMonths, setStockDurationMonths] = useState(3);

    const [reportLoading, setReportLoading] = useState(false);
    const [reportError, setReportError] = useState<string | null>(null);
    const [monthsInRange, setMonthsInRange] = useState<number | null>(null);
    const [rows, setRows] = useState<ReportRow[]>([]);
    const [exportLoading, setExportLoading] = useState<"csv" | "xlsx" | null>(null);
    const [tableSearch, setTableSearch] = useState("");
    const [sortColumn, setSortColumn] = useState<SortColumn>("suggestedRestock");
    const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

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
                setCategories(data.categories);
            } catch (loadError) {
                setCategoriesError(
                    loadError instanceof Error
                        ? loadError.message
                        : "Failed to load product categories."
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
                setBrandsError(
                    loadError instanceof Error
                        ? loadError.message
                        : "Failed to load product brands."
                );
            } finally {
                setBrandsLoading(false);
            }
        }

        void loadBrands();
    }, [user]);

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

    const displayRows = useMemo<DisplayReportRow[]>(() => {
        return rows.map((row) => {
            const formatted = formatSuggestedRestock(row.suggestedRestock, row.currentStock, row.averageMonthlySales);
            const baseRestock = formatted.roundedSuggestedRestock ?? 0;
            return {
                ...row,
                ...formatted,
                suggestedRestockWithPending: baseRestock + row.pendingFromBackorders,
            };
        });
    }, [rows]);

    const filteredDisplayRows = useMemo(() => {
        const q = tableSearch.trim().toLowerCase();
        if (!q) return displayRows;
        return displayRows.filter((row) => row.productName.toLowerCase().includes(q));
    }, [displayRows, tableSearch]);

    const sortedFilteredDisplayRows = useMemo(() => {
        const sortedRows = [...filteredDisplayRows].sort((a, b) => {
            if (sortColumn === "productName") {
                return a.productName.localeCompare(b.productName);
            }

            if (sortColumn === "suggestedRestock") {
                return a.suggestedRestock - b.suggestedRestock;
            }

            return a[sortColumn] - b[sortColumn];
        });

        return sortDirection === "asc" ? sortedRows : sortedRows.reverse();
    }, [filteredDisplayRows, sortColumn, sortDirection]);

    const exportFileName = useMemo(() => {
        const categoryName = selectedCategory?.name ?? categoryQuery;
        const brandName = selectedBrand?.name ?? brandQuery;
        const filterName = [categoryName, brandName].filter(Boolean).join("-") || "category";
        return `purchase-report-${sanitizeFileName(filterName)}-${startDate}-to-${endDate}`;
    }, [brandQuery, categoryQuery, endDate, selectedBrand?.name, selectedCategory?.name, startDate]);

    async function handleGenerateReport(event: FormEvent) {
        event.preventDefault();
        if (!user || (!selectedCategory && !selectedBrand)) {
            return;
        }

        setReportLoading(true);
        setReportError(null);
        setRows([]);
        setTableSearch("");

        try {
            const data = await getPurchaseOrderReport({
                categoryId: selectedCategory?.id,
                categoryModel: selectedCategory?.model,
                brandId: selectedBrand?.id,
                startDate,
                endDate,
                stockDurationMonths,
            });

            setMonthsInRange(data.monthsInRange);
            setRows(data.rows);
        } catch (generateError) {
            setReportError(
                generateError instanceof Error
                    ? generateError.message
                    : "Failed to generate purchase order report."
            );
        } finally {
            setReportLoading(false);
        }
    }

    async function handleExport(format: "csv" | "xlsx") {
        if (displayRows.length === 0) {
            return;
        }

        setExportLoading(format);
        setReportError(null);

        try {
            const XLSX = await import("xlsx");
            const exportData = displayRows.map((row) => ({
                "Product Name": row.productName,
                "Sold in Period": row.soldInPeriod,
                "Current Stock": row.currentStock,
                "Average Monthly Sales": Math.ceil(row.averageMonthlySales),
                "Suggested Restock": row.restockDisplayValue,
                "Suggested Restock + Pending Orders": row.suggestedRestockWithPending,
            }));

            const worksheet = XLSX.utils.json_to_sheet(exportData);
            worksheet["!cols"] = [
                { wch: 42 },
                { wch: 16 },
                { wch: 16 },
                { wch: 22 },
                { wch: 20 },
                { wch: 36 },
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
            XLSX.utils.book_append_sheet(workbook, worksheet, "Purchase Report");
            XLSX.writeFile(workbook, `${exportFileName}.xlsx`);
        } catch (exportError) {
            setReportError(
                exportError instanceof Error
                    ? exportError.message
                    : "Failed to export purchase order report."
            );
        } finally {
            setExportLoading(null);
        }
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

    return (
        <section>
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="font-display text-3xl">Purchase Order</h1>
                    <p className="mt-1 text-sm text-(--ink-soft)">
                        Generate a category-based restock report from Odoo sales data.
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <Link
                        href="/purchase-order/from-backorder"
                        className="inline-flex items-center rounded-xl border border-(--line) bg-white px-4 py-2 text-sm font-medium text-(--ink)"
                    >
                        Purchase From Backorder
                    </Link>
                    <FileSpreadsheet className="h-8 w-8 text-(--brand)" aria-hidden="true" />
                </div>
            </div>

            <form
                onSubmit={handleGenerateReport}
                className="mt-6 rounded-2xl border border-(--line) bg-(--card) p-5"
            >
                <div className="grid gap-4 lg:grid-cols-2">
                    <label className="relative block">
                        <span className="mb-2 block text-sm font-medium">Category Selector</span>
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
                                onBlur={() => {
                                    window.setTimeout(() => setCategoryMenuOpen(false), 120);
                                }}
                                placeholder={categoriesLoading ? "Loading categories..." : "Search categories"}
                                className="w-full rounded-xl border border-(--line) bg-white py-2 pl-10 pr-3"
                                disabled={categoriesLoading || Boolean(categoriesError)}
                            />
                        </div>

                        {categoryMenuOpen && filteredCategories.length > 0 ? (
                            <ul className="absolute z-20 mt-2 max-h-64 w-full overflow-auto rounded-xl border border-(--line) bg-white p-1 shadow-lg">
                                {filteredCategories.map((category) => (
                                    <li key={`${category.model}-${category.id}`}>
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

                        {selectedCategory ? (
                            <p className="mt-2 text-xs text-(--ink-soft)">
                                Selected category source: {selectedCategory.model}
                            </p>
                        ) : null}
                    </label>

                    <label className="relative block">
                        <span className="mb-2 block text-sm font-medium">Brand Selector</span>
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
                                onBlur={() => {
                                    window.setTimeout(() => setBrandMenuOpen(false), 120);
                                }}
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

                    <div className="grid gap-4 sm:grid-cols-2">
                        <label className="block">
                            <span className="mb-2 block text-sm font-medium">Product Performance - Start Date</span>
                            <input
                                type="date"
                                value={startDate}
                                onChange={(event) => setStartDate(event.target.value)}
                                className="w-full rounded-xl border border-(--line) bg-white px-3 py-2"
                                required
                            />
                        </label>
                        <label className="block">
                            <span className="mb-2 block text-sm font-medium">Product Performance - End Date</span>
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
                        <span className="mb-2 block text-sm font-medium">Stock Duration</span>
                        <select
                            value={stockDurationMonths}
                            onChange={(event) => setStockDurationMonths(Number(event.target.value))}
                            className="w-full rounded-xl border border-(--line) bg-white px-3 py-2"
                        >
                            {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
                                <option key={month} value={month}>
                                    {month} Month{month > 1 ? "s" : ""}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-3">
                    <button
                        type="submit"
                        disabled={
                            reportLoading ||
                            categoriesLoading ||
                            brandsLoading ||
                            (!selectedCategory && !selectedBrand)
                        }
                        className="rounded-xl bg-(--brand) px-5 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-70"
                    >
                        {reportLoading ? "Generating..." : "Generate Report"}
                    </button>

                    {monthsInRange ? (
                        <p className="text-sm text-(--ink-soft)">
                            AMS period: {monthsInRange.toFixed(2)} month(s)
                        </p>
                    ) : null}
                </div>

                {!selectedCategory && !selectedBrand ? (
                    <p className="mt-4 text-xs text-(--ink-soft)">
                        Select a category, a brand, or both to generate a report.
                    </p>
                ) : null}

                {categoriesError ? <p className="mt-4 text-sm text-red-600">{categoriesError}</p> : null}
                {brandsError ? <p className="mt-4 text-sm text-red-600">{brandsError}</p> : null}
                {reportError ? <p className="mt-4 text-sm text-red-600">{reportError}</p> : null}
            </form>

            <div className="mt-6 rounded-2xl border border-(--line) bg-(--card) p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h2 className="font-display text-2xl">Suggested Restock</h2>
                        <p className="mt-1 text-sm text-(--ink-soft)">
                            Suggested restocks are rounded up. Zero or negative values are marked as over stock.
                        </p>
                    </div>

                    {displayRows.length > 0 ? (
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

                {!reportLoading && displayRows.length === 0 ? (
                    <p className="mt-3 text-sm text-(--ink-soft)">
                        No results yet. Select a category and date range, then generate the report.
                    </p>
                ) : null}

                {displayRows.length > 0 ? (
                    <div className="mt-4 relative">
                        <Search
                            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--ink-soft)"
                            aria-hidden="true"
                        />
                        <input
                            type="search"
                            value={tableSearch}
                            onChange={(e) => setTableSearch(e.target.value)}
                            placeholder="Search products…"
                            className="w-full rounded-xl border border-(--line) bg-white py-2 pl-10 pr-4 text-sm"
                        />
                    </div>
                ) : null}

                {displayRows.length > 0 ? (
                    <div className="mt-3 overflow-x-auto rounded-xl border border-(--line)">
                        <table className="min-w-full border-collapse text-left text-sm">
                            <thead className="bg-(--chip) text-(--ink-soft)">
                                <tr>
                                    <th className="border border-(--line) px-4 py-3 font-medium">
                                        <button type="button" onClick={() => handleSort("productName")} className="cursor-pointer">
                                            Product Name{getSortIndicator("productName")}
                                        </button>
                                    </th>
                                    <th className="border border-(--line) px-4 py-3 font-medium">
                                        <button type="button" onClick={() => handleSort("soldInPeriod")} className="cursor-pointer">
                                            Sold in Period{getSortIndicator("soldInPeriod")}
                                        </button>
                                    </th>
                                    <th className="border border-(--line) px-4 py-3 font-medium">
                                        <button type="button" onClick={() => handleSort("currentStock")} className="cursor-pointer">
                                            Current Stock{getSortIndicator("currentStock")}
                                        </button>
                                    </th>
                                    <th className="border border-(--line) px-4 py-3 font-medium">
                                        <button type="button" onClick={() => handleSort("averageMonthlySales")} className="cursor-pointer">
                                            Avg Monthly Sales{getSortIndicator("averageMonthlySales")}
                                        </button>
                                    </th>
                                    <th className="border border-(--line) px-4 py-3 font-medium">
                                        <button type="button" onClick={() => handleSort("suggestedRestock")} className="cursor-pointer">
                                            Suggested Restock{getSortIndicator("suggestedRestock")}
                                        </button>
                                    </th>
                                    <th className="border border-(--line) px-4 py-3 font-medium">
                                        Suggested Restock + Pending Orders
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {sortedFilteredDisplayRows.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="border border-(--line) px-4 py-6 text-center text-sm text-(--ink-soft)">
                                            No products match &ldquo;{tableSearch}&rdquo;.
                                        </td>
                                    </tr>
                                ) : null}
                                {sortedFilteredDisplayRows.map((row) => (
                                    <tr key={row.productId}>
                                        <td className="border border-(--line) px-4 py-3">{row.productName}</td>
                                        <td className="border border-(--line) px-4 py-3">{Math.ceil(row.soldInPeriod)}</td>
                                        <td className="border border-(--line) px-4 py-3">{Math.ceil(row.currentStock)}</td>
                                        <td className="border border-(--line) px-4 py-3">{Math.ceil(row.averageMonthlySales)}</td>
                                        <td
                                            className={`border border-(--line) px-4 py-3 font-medium ${row.isOverStock ? "text-red-600" : "text-green-600"}`}
                                        >
                                            {row.restockDisplayValue}
                                        </td>
                                        <td className="border border-(--line) px-4 py-3 font-medium text-blue-600">
                                            {row.suggestedRestockWithPending}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : null}
            </div>
        </section>
    );
}
