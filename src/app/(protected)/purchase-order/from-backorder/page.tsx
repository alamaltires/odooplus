"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download, Search } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { getPurchaseFromBackorderReport } from "@/lib/client-odoo";
import { PurchaseFromBackorderRow } from "@/types/odoo";

function sanitizeFileName(value: string) {
    return (
        value
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "") || "report"
    );
}

export default function PurchaseFromBackorderPage() {
    const { user } = useAuth();

    const [rows, setRows] = useState<PurchaseFromBackorderRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState("");
    const [exporting, setExporting] = useState(false);

    useEffect(() => {
        async function loadReport() {
            if (!user) {
                setRows([]);
                setLoading(false);
                return;
            }

            setLoading(true);
            setError(null);

            try {
                const data = await getPurchaseFromBackorderReport();
                setRows(data.rows);
            } catch (loadError) {
                setError(
                    loadError instanceof Error
                        ? loadError.message
                        : "Failed to load purchase-from-backorder report."
                );
            } finally {
                setLoading(false);
            }
        }

        void loadReport();
    }, [user]);

    const filteredRows = useMemo(() => {
        const query = search.trim().toLowerCase();
        if (!query) {
            return rows;
        }

        return rows.filter((row) => {
            const haystack = [
                row.categoryName,
                row.productName,
                String(row.productId ?? ""),
                String(row.productVariantId ?? ""),
            ]
                .join(" ")
                .toLowerCase();

            return haystack.includes(query);
        });
    }, [rows, search]);

    const sortedRows = useMemo(() => {
        return [...filteredRows].sort((a, b) => {
            const categoryCompare = a.categoryName.localeCompare(b.categoryName);
            if (categoryCompare !== 0) {
                return categoryCompare;
            }

            return a.productName.localeCompare(b.productName);
        });
    }, [filteredRows]);

    async function handleExportExcel() {
        if (sortedRows.length === 0) {
            return;
        }

        setExporting(true);
        setError(null);

        try {
            const XLSX = await import("xlsx");
            const exportData = sortedRows.map((row) => ({
                Category: row.categoryName,
                "Product Name": row.productName,
                "Odoo Template ID": row.productId ?? "",
                "Odoo Variant ID": row.productVariantId ?? "",
                "Pending Quantity": Math.ceil(row.pendingQuantity),
                "Ordered Quantity": Math.ceil(row.orderedQuantity),
                "Available Quantity": Math.ceil(row.availableQuantity),
                "Backorder Count": row.backorderCount,
            }));

            const worksheet = XLSX.utils.json_to_sheet(exportData);
            worksheet["!cols"] = [
                { wch: 24 },
                { wch: 40 },
                { wch: 18 },
                { wch: 18 },
                { wch: 18 },
                { wch: 18 },
                { wch: 18 },
                { wch: 16 },
            ];

            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, "Backorder Purchase");

            const dateStamp = new Date().toISOString().slice(0, 10);
            XLSX.writeFile(
                workbook,
                `purchase-from-backorder-${sanitizeFileName(dateStamp)}.xlsx`
            );
        } catch (exportError) {
            setError(
                exportError instanceof Error
                    ? exportError.message
                    : "Failed to export Excel report."
            );
        } finally {
            setExporting(false);
        }
    }

    return (
        <section>
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <Link
                        href="/purchase-order"
                        className="inline-flex items-center gap-2 text-sm font-medium text-(--ink-soft)"
                    >
                        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                        Back to Purchase Order
                    </Link>
                    <h1 className="mt-3 font-display text-3xl">Purchase From Backorder</h1>
                    <p className="mt-1 text-sm text-(--ink-soft)">
                        Products from saved backorders with status pendding or partial.
                    </p>
                </div>

                <button
                    type="button"
                    onClick={() => void handleExportExcel()}
                    disabled={exporting || sortedRows.length === 0}
                    className="inline-flex items-center gap-2 rounded-xl bg-(--brand) px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-70"
                >
                    <Download className="h-4 w-4" aria-hidden="true" />
                    {exporting ? "Exporting Excel..." : "Export Excel"}
                </button>
            </div>

            <div className="mt-5 rounded-2xl border border-(--line) bg-(--card) p-4">
                <label className="relative block">
                    <Search
                        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--ink-soft)"
                        aria-hidden="true"
                    />
                    <input
                        type="search"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Search by category, product name, or product ID"
                        className="w-full rounded-xl border border-(--line) bg-white py-2 pl-10 pr-4 text-sm"
                    />
                </label>
                <p className="mt-2 text-xs text-(--ink-soft)">
                    Showing {sortedRows.length} product{sortedRows.length === 1 ? "" : "s"}.
                </p>
                {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
            </div>

            {loading ? <p className="mt-4 text-sm">Loading backorder report...</p> : null}

            {!loading && sortedRows.length === 0 ? (
                <p className="mt-4 text-sm text-(--ink-soft)">
                    No products found for pendding or partial backorders.
                </p>
            ) : null}

            {!loading && sortedRows.length > 0 ? (
                <div className="mt-4 overflow-x-auto rounded-2xl border border-(--line)">
                    <table className="min-w-full border-collapse text-left text-sm">
                        <thead className="bg-(--chip) text-(--ink-soft)">
                            <tr>
                                <th className="px-4 py-3 font-medium">Category</th>
                                <th className="px-4 py-3 font-medium">Product Name</th>
                                <th className="px-4 py-3 font-medium">Template ID</th>
                                <th className="px-4 py-3 font-medium">Variant ID</th>
                                <th className="px-4 py-3 font-medium">Pending Qty</th>
                                <th className="px-4 py-3 font-medium">Ordered Qty</th>
                                <th className="px-4 py-3 font-medium">Available Qty</th>
                                <th className="px-4 py-3 font-medium">Backorders</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sortedRows.map((row, index) => (
                                <tr
                                    key={`${row.productId ?? "na"}-${row.productVariantId ?? "na"}-${index}`}
                                    className="border-t border-(--line)"
                                >
                                    <td className="px-4 py-3">{row.categoryName}</td>
                                    <td className="px-4 py-3">{row.productName}</td>
                                    <td className="px-4 py-3">{row.productId ?? "-"}</td>
                                    <td className="px-4 py-3">{row.productVariantId ?? "-"}</td>
                                    <td className="px-4 py-3 font-medium text-amber-700">
                                        {Math.ceil(row.pendingQuantity)}
                                    </td>
                                    <td className="px-4 py-3">{Math.ceil(row.orderedQuantity)}</td>
                                    <td className="px-4 py-3">{Math.ceil(row.availableQuantity)}</td>
                                    <td className="px-4 py-3">{row.backorderCount}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : null}
        </section>
    );
}
