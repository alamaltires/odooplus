"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, BadgeDollarSign, Building2, ClipboardList, Clock3 } from "lucide-react";
import { getCustomerReport } from "@/lib/client-odoo";
import { useAuth } from "@/lib/auth-context";
import { OdooCustomerReport } from "@/types/odoo";

function formatNumber(value: number) {
    return value.toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    });
}

function formatCurrency(value: number) {
    return `AED ${formatNumber(value)}`;
}

function formatDateTime(value: string) {
    if (!value) {
        return "-";
    }

    return value.replace("T", " ");
}

function MetricCard({
    title,
    value,
    description,
    icon: Icon,
}: {
    title: string;
    value: string;
    description: string;
    icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}) {
    return (
        <article className="rounded-2xl border border-(--line) bg-(--card) p-5 shadow-[0_8px_20px_rgba(8,23,41,0.05)]">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <p className="text-sm text-(--ink-soft)">{title}</p>
                    <p className="mt-3 font-display text-4xl">{value}</p>
                    <p className="mt-2 text-sm text-(--ink-soft)">{description}</p>
                </div>
                <Icon className="h-6 w-6 text-(--brand)" aria-hidden={true} />
            </div>
        </article>
    );
}

export default function CustomerReportPage() {
    const params = useParams<{ id: string }>();
    const customerId = Number(params.id);
    const { user } = useAuth();

    const [report, setReport] = useState<OdooCustomerReport | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        async function loadReport() {
            if (!user) {
                return;
            }

            try {
                const data = await getCustomerReport(customerId);
                setReport(data);
            } catch (loadError) {
                setError(
                    loadError instanceof Error ? loadError.message : "Failed to load customer report."
                );
            } finally {
                setLoading(false);
            }
        }

        void loadReport();
    }, [customerId, user]);

    return (
        <section>
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                    <Link
                        href="/salesperson-activity"
                        className="inline-flex items-center gap-2 text-sm text-(--ink-soft) hover:text-(--ink)"
                    >
                        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                        Back to Salesperson Activity
                    </Link>
                    <h1 className="mt-3 font-display text-3xl">
                        {report?.customer.customerName ?? `Customer #${params.id}`}
                    </h1>
                    <p className="mt-1 text-sm text-(--ink-soft)">
                        Customer report with top brands, total sales, last CRM visit, and open quotations.
                    </p>
                </div>
            </div>

            {error ? (
                <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
                    {error}
                </div>
            ) : null}

            {loading ? <p className="mt-6 text-sm text-(--ink-soft)">Loading customer report...</p> : null}

            {report ? (
                <div className="mt-6 space-y-6">
                    <div className="rounded-2xl border border-(--line) bg-(--card) p-5">
                        <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                            <p>
                                <span className="text-(--ink-soft)">Salesperson:</span> {report.customer.salespersonName || "-"}
                            </p>
                            <p>
                                <span className="text-(--ink-soft)">Email:</span> {report.customer.email || "-"}
                            </p>
                            <p>
                                <span className="text-(--ink-soft)">Phone:</span> {report.customer.phone || "-"}
                            </p>
                            <p>
                                <span className="text-(--ink-soft)">City:</span> {report.customer.city || "-"}
                            </p>
                        </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                        <MetricCard
                            title="Total Sales"
                            value={formatCurrency(report.totalSales)}
                            description="Confirmed sales across all completed sales orders for this customer."
                            icon={BadgeDollarSign}
                        />
                        <MetricCard
                            title="Last Visit"
                            value={formatDateTime(report.lastVisitDate)}
                            description={report.lastVisitDate
                                ? `${report.lastVisitReference || "CRM visit"}${report.lastVisitSalespersonName ? ` by ${report.lastVisitSalespersonName}` : ""}`
                                : "No CRM visit found."}
                            icon={Clock3}
                        />
                        <MetricCard
                            title="Open Quotations"
                            value={formatNumber(report.openQuotationCount)}
                            description="Current quotations still in draft or sent state."
                            icon={ClipboardList}
                        />
                        <MetricCard
                            title="Tracked Brands"
                            value={formatNumber(report.topBrands.length)}
                            description="Top selling brands or categories identified for this customer."
                            icon={Building2}
                        />
                    </div>

                    <div className="rounded-2xl border border-(--line) bg-(--card) p-5">
                        <div>
                            <h2 className="font-display text-2xl">Most Sold Brands</h2>
                            <p className="text-sm text-(--ink-soft)">
                                Ranked by total confirmed sales for this customer.
                            </p>
                        </div>

                        {report.topBrands.length === 0 ? (
                            <p className="mt-4 text-sm text-(--ink-soft)">
                                No sold brands were found for this customer.
                            </p>
                        ) : (
                            <div className="mt-4 overflow-hidden rounded-xl border border-(--line)">
                                <table className="w-full border-collapse text-left text-sm">
                                    <thead className="bg-(--chip) text-(--ink-soft)">
                                        <tr>
                                            <th className="px-4 py-3 font-medium">Brand</th>
                                            <th className="px-4 py-3 font-medium text-right">Quantity Sold</th>
                                            <th className="px-4 py-3 font-medium text-right">Total Sales</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {report.topBrands.map((brand) => (
                                            <tr key={brand.brandName} className="border-t border-(--line)">
                                                <td className="px-4 py-3">{brand.brandName}</td>
                                                <td className="px-4 py-3 text-right">{formatNumber(brand.quantitySold)}</td>
                                                <td className="px-4 py-3 text-right">{formatCurrency(brand.totalSales)}</td>
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