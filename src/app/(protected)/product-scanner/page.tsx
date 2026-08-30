"use client";

import { FormEvent, useState } from "react";
import { Download, ScanSearch } from "lucide-react";
import { getNearExpiryProducts } from "@/lib/client-odoo";
import { OdooNearExpiryProduct } from "@/types/odoo";

function formatDate(value: string) {
    if (!value) {
        return "-";
    }

    return value.slice(0, 10);
}

function formatDateTime(value: string | null) {
    if (!value) {
        return "-";
    }

    return value.replace("T", " ").slice(0, 16);
}

export default function ProductScannerPage() {
    const [thresholdDays, setThresholdDays] = useState(30);
    const [products, setProducts] = useState<OdooNearExpiryProduct[]>([]);
    const [scannedAt, setScannedAt] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [exporting, setExporting] = useState(false);

    async function handleScan(event: FormEvent) {
        event.preventDefault();

        setLoading(true);
        setError(null);

        try {
            const response = await getNearExpiryProducts({ thresholdDays });
            setProducts(response.products);
            setScannedAt(response.scannedAt);
            setThresholdDays(response.thresholdDays);
        } catch (scanError) {
            setError(
                scanError instanceof Error
                    ? scanError.message
                    : "Failed to scan near expiry products."
            );
        } finally {
            setLoading(false);
        }
    }

    async function handleExport() {
        if (products.length === 0) {
            return;
        }

        setExporting(true);
        setError(null);

        try {
            const XLSX = await import("xlsx");
            const exportRows = products.map((product) => ({
                Product: product.productName,
                Lot: product.lotName,
                "Expiry Date": formatDate(product.expirationDate),
                "Days Left": product.daysUntilExpiry,
                Quantity: product.quantity,
            }));

            const worksheet = XLSX.utils.json_to_sheet(exportRows);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, "Near Expiry");
            XLSX.writeFile(
                workbook,
                `near-expiry-products-${thresholdDays}d-${new Date().toISOString().slice(0, 10)}.xlsx`
            );
        } catch (exportError) {
            setError(
                exportError instanceof Error
                    ? exportError.message
                    : "Failed to export Excel file."
            );
        } finally {
            setExporting(false);
        }
    }

    return (
        <section>
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="font-display text-3xl">Product Scanner</h1>
                    <p className="mt-1 text-sm text-(--ink-soft)">
                        Scan near-expiry products from Odoo on demand.
                    </p>
                </div>
                <ScanSearch className="h-8 w-8 text-(--brand)" aria-hidden="true" />
            </div>

            <form
                onSubmit={handleScan}
                className="mt-6 rounded-2xl border border-(--line) bg-(--card) p-5"
            >
                <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-end">
                    <label className="block">
                        <span className="mb-2 block text-sm font-medium">Scan Window (Days)</span>
                        <input
                            type="number"
                            min="1"
                            max="365"
                            value={thresholdDays}
                            onChange={(event) => setThresholdDays(Number(event.target.value))}
                            className="w-44 rounded-xl border border-(--line) bg-white px-3 py-2"
                            required
                        />
                    </label>
                    <button
                        type="submit"
                        disabled={loading}
                        className="rounded-xl bg-(--brand) px-5 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-70"
                    >
                        {loading ? "Scanning..." : "Scan Near Expiry"}
                    </button>
                    <p className="text-sm text-(--ink-soft)">
                        Last scan: {formatDateTime(scannedAt)}
                    </p>
                </div>

                {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
            </form>

            <div className="mt-6 rounded-2xl border border-(--line) bg-(--card) p-5">
                <div className="flex items-end justify-between gap-3">
                    <div>
                        <h2 className="font-display text-2xl">Near Expiry Lots</h2>
                        <p className="mt-1 text-sm text-(--ink-soft)">
                            Showing lots expiring within {thresholdDays} day(s).
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            type="button"
                            onClick={() => void handleExport()}
                            disabled={products.length === 0 || exporting}
                            className="inline-flex items-center gap-2 rounded-xl border border-(--line) px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <Download className="h-4 w-4" aria-hidden="true" />
                            {exporting ? "Exporting..." : "Export Excel"}
                        </button>
                        <span className="rounded-full bg-(--chip) px-3 py-1 text-xs font-medium text-(--ink-soft)">
                            {products.length} lot(s)
                        </span>
                    </div>
                </div>

                {products.length === 0 ? (
                    <p className="mt-4 text-sm text-(--ink-soft)">
                        No near-expiry products found. Run a scan to refresh data.
                    </p>
                ) : (
                    <div className="mt-4 overflow-hidden rounded-xl border border-(--line)">
                        <table className="w-full border-collapse text-left text-sm">
                            <thead className="bg-(--chip) text-(--ink-soft)">
                                <tr>
                                    <th className="px-4 py-3 font-medium">Product</th>
                                    <th className="px-4 py-3 font-medium">Lot</th>
                                    <th className="px-4 py-3 font-medium">Expiry Date</th>
                                    <th className="px-4 py-3 font-medium">Days Left</th>
                                    <th className="px-4 py-3 font-medium">Quantity</th>
                                </tr>
                            </thead>
                            <tbody>
                                {products.map((product) => (
                                    <tr key={product.lotId} className="border-t border-(--line)">
                                        <td className="px-4 py-3">{product.productName}</td>
                                        <td className="px-4 py-3">{product.lotName}</td>
                                        <td className="px-4 py-3">{formatDate(product.expirationDate)}</td>
                                        <td className="px-4 py-3">{product.daysUntilExpiry}</td>
                                        <td className="px-4 py-3">{product.quantity}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </section>
    );
}