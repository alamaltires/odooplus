"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Package, Users } from "lucide-react";
import { getSalesTargetDetails } from "@/lib/client-odoo";
import { OdooSalesTargetDetailsReport } from "@/types/odoo";

const months = [
    { value: 1, label: "January" },
    { value: 2, label: "February" },
    { value: 3, label: "March" },
    { value: 4, label: "April" },
    { value: 5, label: "May" },
    { value: 6, label: "June" },
    { value: 7, label: "July" },
    { value: 8, label: "August" },
    { value: 9, label: "September" },
    { value: 10, label: "October" },
    { value: 11, label: "November" },
    { value: 12, label: "December" },
] as const;

function formatNumber(value: number) {
    return value.toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    });
}

function formatCurrency(value: number, currencyCode = "AED") {
    return `${currencyCode} ${formatNumber(value)}`;
}

function formatDateTime(value: string) {
    if (!value) {
        return "-";
    }

    return value.replace("T", " ");
}

type SortDirection = "asc" | "desc";

type ProductSortField = "productName" | "quantitySold" | "orderCount" | "totalSales";

type CustomerSortField = "customerName" | "orderCount" | "totalSales" | "lastSaleDate";

function sortDirectionLabel(direction: SortDirection) {
    return direction === "asc" ? "(asc)" : "(desc)";
}

export default function SalesTargetDetailsPage() {
    const searchParams = useSearchParams();
    const [details, setDetails] = useState<OdooSalesTargetDetailsReport | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [productsSearch, setProductsSearch] = useState("");
    const [customersSearch, setCustomersSearch] = useState("");
    const [productsSort, setProductsSort] = useState<{ field: ProductSortField; direction: SortDirection }>({
        field: "totalSales",
        direction: "desc",
    });
    const [customersSort, setCustomersSort] = useState<{ field: CustomerSortField; direction: SortDirection }>({
        field: "totalSales",
        direction: "desc",
    });

    const currencyCode = details?.primaryCurrencyCode || "AED";

    const salespersonId = Number(searchParams.get("salespersonId") ?? 0);
    const year = Number(searchParams.get("year") ?? 0);
    const month = Number(searchParams.get("month") ?? 0);
    const brandId = Number(searchParams.get("brandId") ?? 0);

    const monthLabel = useMemo(
        () => months.find((item) => item.value === month)?.label ?? String(month),
        [month]
    );

    const filteredSortedProducts = useMemo(() => {
        if (!details) {
            return [];
        }

        const normalizedSearch = productsSearch.trim().toLowerCase();

        const filtered = details.products.filter((product) =>
            product.productName.toLowerCase().includes(normalizedSearch)
        );

        const sorted = [...filtered].sort((a, b) => {
            const directionFactor = productsSort.direction === "asc" ? 1 : -1;

            if (productsSort.field === "productName") {
                return a.productName.localeCompare(b.productName) * directionFactor;
            }

            return (Number(a[productsSort.field]) - Number(b[productsSort.field])) * directionFactor;
        });

        return sorted;
    }, [details, productsSearch, productsSort]);

    const filteredSortedCustomers = useMemo(() => {
        if (!details) {
            return [];
        }

        const normalizedSearch = customersSearch.trim().toLowerCase();

        const filtered = details.servedCustomers.filter((customer) => {
            const haystack = `${customer.customerName} ${customer.email} ${customer.phone} ${customer.city}`.toLowerCase();
            return haystack.includes(normalizedSearch);
        });

        const sorted = [...filtered].sort((a, b) => {
            const directionFactor = customersSort.direction === "asc" ? 1 : -1;

            if (customersSort.field === "customerName") {
                return a.customerName.localeCompare(b.customerName) * directionFactor;
            }

            if (customersSort.field === "lastSaleDate") {
                return a.lastSaleDate.localeCompare(b.lastSaleDate) * directionFactor;
            }

            return (Number(a[customersSort.field]) - Number(b[customersSort.field])) * directionFactor;
        });

        return sorted;
    }, [customersSearch, customersSort, details]);

    const productsTotalSales = useMemo(
        () => filteredSortedProducts.reduce((sum, item) => sum + Number(item.totalSales || 0), 0),
        [filteredSortedProducts]
    );

    const customersTotalSales = useMemo(
        () => filteredSortedCustomers.reduce((sum, item) => sum + Number(item.totalSales || 0), 0),
        [filteredSortedCustomers]
    );

    function toggleProductSort(field: ProductSortField) {
        setProductsSort((previous) => ({
            field,
            direction: previous.field === field && previous.direction === "asc" ? "desc" : "asc",
        }));
    }

    function toggleCustomerSort(field: CustomerSortField) {
        setCustomersSort((previous) => ({
            field,
            direction: previous.field === field && previous.direction === "asc" ? "desc" : "asc",
        }));
    }

    useEffect(() => {
        async function load() {
            if (!salespersonId || !year || !month || !brandId) {
                setError("Missing required details parameters.");
                setLoading(false);
                return;
            }

            setLoading(true);
            setError(null);

            try {
                const data = await getSalesTargetDetails({
                    salespersonId,
                    year,
                    month,
                    brandId,
                });
                setDetails(data);
            } catch (loadError) {
                setError(loadError instanceof Error ? loadError.message : "Failed to load sales target details.");
            } finally {
                setLoading(false);
            }
        }

        void load();
    }, [brandId, month, salespersonId, year]);

    return (
        <section>
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="font-display text-3xl">Sales Target Details</h1>
                    <p className="mt-1 text-sm text-(--ink-soft)">
                        Detailed product and customer view for the selected brand target.
                    </p>
                </div>
                <Link
                    href="/sales-targets"
                    className="inline-flex items-center gap-2 rounded-xl border border-(--line) bg-white px-3 py-2 text-sm font-medium text-(--ink) hover:bg-(--chip)"
                >
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                    Back To Sales Targets
                </Link>
            </div>

            {error ? (
                <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
                    {error}
                </div>
            ) : null}

            {loading ? (
                <div className="mt-6 rounded-2xl border border-(--line) bg-white p-5 text-sm text-(--ink-soft)">
                    Loading details...
                </div>
            ) : null}

            {details && !loading ? (
                <div className="mt-6 space-y-6">
                    <div className="grid gap-4 md:grid-cols-3">
                        <article className="rounded-2xl border border-(--line) bg-(--card) p-5 shadow-[0_8px_20px_rgba(8,23,41,0.05)]">
                            <p className="text-sm text-(--ink-soft)">Salesperson</p>
                            <p className="mt-2 text-xl font-semibold text-(--ink)">{details.salesperson.name}</p>
                            <p className="mt-1 text-sm text-(--ink-soft)">{monthLabel} {year}</p>
                        </article>
                        <article className="rounded-2xl border border-(--line) bg-(--card) p-5 shadow-[0_8px_20px_rgba(8,23,41,0.05)]">
                            <p className="text-sm text-(--ink-soft)">Brand</p>
                            <p className="mt-2 text-xl font-semibold text-(--ink)">{details.brandName}</p>
                            <p className="mt-1 text-sm text-(--ink-soft)">ID: {details.brandId}</p>
                        </article>
                        <article className="rounded-2xl border border-(--line) bg-(--card) p-5 shadow-[0_8px_20px_rgba(8,23,41,0.05)]">
                            <p className="text-sm text-(--ink-soft)">Brand Sales ({currencyCode})</p>
                            <p className="mt-2 text-xl font-semibold text-(--ink)">{formatCurrency(details.totalBrandSales, currencyCode)}</p>
                            <p className="mt-1 text-sm text-(--ink-soft)">{details.products.length} products, {details.servedCustomers.length} customers</p>
                        </article>
                    </div>

                    {details.otherCurrencyTotals.length > 0 ? (
                        <div className="rounded-2xl border border-(--line) bg-(--card) p-5">
                            <h2 className="font-display text-2xl">Sales By Currency</h2>
                            <p className="mt-1 text-sm text-(--ink-soft)">
                                Every currency found in this salesperson&apos;s confirmed sales orders for this brand and period.
                                Only {currencyCode} counts toward the numbers above.
                            </p>
                            <div className="mt-4 overflow-x-auto rounded-xl border border-(--line)">
                                <table className="min-w-full divide-y divide-(--line) text-sm">
                                    <thead className="bg-(--chip) text-(--ink-soft)">
                                        <tr>
                                            <th className="px-4 py-2.5 text-left font-medium">Currency</th>
                                            <th className="px-4 py-2.5 text-right font-medium">Total Sales</th>
                                            <th className="px-4 py-2.5 text-right font-medium">Orders</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-(--line) bg-white">
                                        <tr>
                                            <td className="px-4 py-2.5 font-medium">
                                                {currencyCode}
                                                <span className="ml-2 rounded-full bg-(--chip) px-2 py-0.5 text-xs font-normal text-(--ink-soft)">
                                                    Target Currency
                                                </span>
                                            </td>
                                            <td className="px-4 py-2.5 text-right">{formatCurrency(details.totalBrandSales, currencyCode)}</td>
                                            <td className="px-4 py-2.5 text-right text-(--ink-soft)">{details.primaryOrderCount}</td>
                                        </tr>
                                        {details.otherCurrencyTotals.map((total) => (
                                            <tr key={total.currencyCode}>
                                                <td className="px-4 py-2.5 font-medium">{total.currencyCode}</td>
                                                <td className="px-4 py-2.5 text-right">{formatCurrency(total.total, total.currencyCode)}</td>
                                                <td className="px-4 py-2.5 text-right text-(--ink-soft)">{total.orderCount}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    ) : null}

                    <div className="rounded-2xl border border-(--line) bg-(--card) p-5">
                        <div className="mb-4 flex items-center gap-2">
                            <Package className="h-5 w-5 text-(--brand)" aria-hidden="true" />
                            <h2 className="font-display text-2xl">Products Sold In Brand</h2>
                        </div>
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                            <div>
                                <p className="text-sm text-(--ink-soft)">Total Sales</p>
                                <p className="text-lg font-semibold text-(--ink)">{formatCurrency(productsTotalSales, currencyCode)}</p>
                            </div>
                            <label className="w-full sm:w-auto">
                                <span className="sr-only">Search products</span>
                                <input
                                    type="search"
                                    value={productsSearch}
                                    onChange={(event) => setProductsSearch(event.target.value)}
                                    placeholder="Search products..."
                                    className="w-full rounded-xl border border-(--line) bg-white px-3 py-2 text-sm sm:w-72"
                                />
                            </label>
                        </div>
                        {details.products.length === 0 ? (
                            <p className="text-sm text-(--ink-soft)">No sold products found in this brand for the selected period.</p>
                        ) : filteredSortedProducts.length === 0 ? (
                            <p className="text-sm text-(--ink-soft)">No products match your search.</p>
                        ) : (
                            <div className="max-h-[460px] overflow-auto rounded-xl border border-(--line)">
                                <table className="min-w-full divide-y divide-(--line) text-sm">
                                    <thead className="sticky top-0 bg-(--chip)">
                                        <tr>
                                            <th className="px-4 py-3 text-left font-medium">
                                                <button type="button" onClick={() => toggleProductSort("productName")}>
                                                    Product {productsSort.field === "productName" ? sortDirectionLabel(productsSort.direction) : ""}
                                                </button>
                                            </th>
                                            <th className="px-4 py-3 text-right font-medium">
                                                <button type="button" onClick={() => toggleProductSort("quantitySold")}>
                                                    Qty Sold {productsSort.field === "quantitySold" ? sortDirectionLabel(productsSort.direction) : ""}
                                                </button>
                                            </th>
                                            <th className="px-4 py-3 text-right font-medium">
                                                <button type="button" onClick={() => toggleProductSort("orderCount")}>
                                                    Orders {productsSort.field === "orderCount" ? sortDirectionLabel(productsSort.direction) : ""}
                                                </button>
                                            </th>
                                            <th className="px-4 py-3 text-right font-medium">
                                                <button type="button" onClick={() => toggleProductSort("totalSales")}>
                                                    Total Sales {productsSort.field === "totalSales" ? sortDirectionLabel(productsSort.direction) : ""}
                                                </button>
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-(--line) bg-white">
                                        {filteredSortedProducts.map((product) => (
                                            <tr key={product.productId}>
                                                <td className="px-4 py-3">{product.productName}</td>
                                                <td className="px-4 py-3 text-right">{formatNumber(product.quantitySold)}</td>
                                                <td className="px-4 py-3 text-right">{product.orderCount}</td>
                                                <td className="px-4 py-3 text-right">{formatCurrency(product.totalSales, currencyCode)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>

                    <div className="rounded-2xl border border-(--line) bg-(--card) p-5">
                        <div className="mb-4 flex items-center gap-2">
                            <Users className="h-5 w-5 text-(--brand)" aria-hidden="true" />
                            <h2 className="font-display text-2xl">Served Customers</h2>
                        </div>
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                            <div>
                                <p className="text-sm text-(--ink-soft)">Total Sales</p>
                                <p className="text-lg font-semibold text-(--ink)">{formatCurrency(customersTotalSales, currencyCode)}</p>
                            </div>
                            <label className="w-full sm:w-auto">
                                <span className="sr-only">Search customers</span>
                                <input
                                    type="search"
                                    value={customersSearch}
                                    onChange={(event) => setCustomersSearch(event.target.value)}
                                    placeholder="Search customers..."
                                    className="w-full rounded-xl border border-(--line) bg-white px-3 py-2 text-sm sm:w-72"
                                />
                            </label>
                        </div>
                        {details.servedCustomers.length === 0 ? (
                            <p className="text-sm text-(--ink-soft)">No served customers found in this brand for the selected period.</p>
                        ) : filteredSortedCustomers.length === 0 ? (
                            <p className="text-sm text-(--ink-soft)">No customers match your search.</p>
                        ) : (
                            <div className="max-h-[460px] overflow-auto rounded-xl border border-(--line)">
                                <table className="min-w-full divide-y divide-(--line) text-sm">
                                    <thead className="sticky top-0 bg-(--chip)">
                                        <tr>
                                            <th className="px-4 py-3 text-left font-medium">
                                                <button type="button" onClick={() => toggleCustomerSort("customerName")}>
                                                    Customer {customersSort.field === "customerName" ? sortDirectionLabel(customersSort.direction) : ""}
                                                </button>
                                            </th>
                                            <th className="px-4 py-3 text-left font-medium">Contact</th>
                                            <th className="px-4 py-3 text-right font-medium">
                                                <button type="button" onClick={() => toggleCustomerSort("orderCount")}>
                                                    Orders {customersSort.field === "orderCount" ? sortDirectionLabel(customersSort.direction) : ""}
                                                </button>
                                            </th>
                                            <th className="px-4 py-3 text-right font-medium">
                                                <button type="button" onClick={() => toggleCustomerSort("totalSales")}>
                                                    Total Sales {customersSort.field === "totalSales" ? sortDirectionLabel(customersSort.direction) : ""}
                                                </button>
                                            </th>
                                            <th className="px-4 py-3 text-left font-medium">
                                                <button type="button" onClick={() => toggleCustomerSort("lastSaleDate")}>
                                                    Last Sale {customersSort.field === "lastSaleDate" ? sortDirectionLabel(customersSort.direction) : ""}
                                                </button>
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-(--line) bg-white">
                                        {filteredSortedCustomers.map((customer) => (
                                            <tr key={customer.customerId}>
                                                <td className="px-4 py-3">{customer.customerName}</td>
                                                <td className="px-4 py-3 text-(--ink-soft)">
                                                    <div>{customer.email || "-"}</div>
                                                    <div>{customer.phone || "-"}</div>
                                                    <div>{customer.city || "-"}</div>
                                                </td>
                                                <td className="px-4 py-3 text-right">{customer.orderCount}</td>
                                                <td className="px-4 py-3 text-right">{formatCurrency(customer.totalSales, currencyCode)}</td>
                                                <td className="px-4 py-3">{formatDateTime(customer.lastSaleDate)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            ) : null}
        </section>
    );
}
