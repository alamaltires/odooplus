"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, Download, FileText, Mail, MapPin, Phone, ShoppingCart, Target, UserSearch } from "lucide-react";
import { getCustomerActivityReport, getCustomers } from "@/lib/client-odoo";
import { Select2 } from "@/components/select2";
import { BrandSalesTree } from "@/components/brand-sales-tree";
import type { OdooCustomerActivityOrder, OdooCustomerActivityReport, OdooCustomerOption } from "@/types/odoo";

function todayISO() {
    return new Date().toISOString().slice(0, 10);
}

function monthsAgoISO(months: number) {
    const date = new Date();
    date.setMonth(date.getMonth() - months);
    return date.toISOString().slice(0, 10);
}

function formatNumber(value: number) {
    return value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatCurrency(value: number) {
    return `AED ${formatNumber(value)}`;
}

function formatDate(value: string) {
    if (!value) return "-";
    const date = new Date(value.includes("T") || value.length <= 10 ? value : `${value.replace(" ", "T")}Z`);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function daysSince(value: string) {
    if (!value) return null;
    const date = new Date(`${value.replace(" ", "T")}Z`);
    if (Number.isNaN(date.getTime())) return null;
    return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000));
}

function sanitizeFileName(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "customer";
}

/** Same thresholds the Salesperson Activity app uses for its monthly-target pill. */
function targetTone(percent: number | null) {
    if (percent === null) return { bar: "bg-slate-300", pill: "bg-(--chip) text-(--ink-soft)" };
    if (percent >= 100) return { bar: "bg-emerald-500", pill: "bg-emerald-100 text-emerald-700" };
    if (percent >= 75) return { bar: "bg-amber-500", pill: "bg-amber-100 text-amber-800" };
    return { bar: "bg-red-500", pill: "bg-red-100 text-red-700" };
}

export default function CustomerActivityPage() {
    const [customers, setCustomers] = useState<OdooCustomerOption[]>([]);
    const [customersLoading, setCustomersLoading] = useState(true);
    const [customersError, setCustomersError] = useState<string | null>(null);

    const [customerId, setCustomerId] = useState("");
    const [startDate, setStartDate] = useState(() => monthsAgoISO(6));
    const [endDate, setEndDate] = useState(todayISO);

    const [report, setReport] = useState<OdooCustomerActivityReport | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        getCustomers()
            .then((data) => setCustomers(data.customers))
            .catch((loadError) => setCustomersError(loadError instanceof Error ? loadError.message : "Failed to load customers."))
            .finally(() => setCustomersLoading(false));
    }, []);

    async function handleGenerate(event: FormEvent) {
        event.preventDefault();
        if (!customerId) return;

        setLoading(true);
        setError(null);
        try {
            setReport(await getCustomerActivityReport({ customerId: Number(customerId), startDate, endDate }));
        } catch (generateError) {
            setReport(null);
            setError(generateError instanceof Error ? generateError.message : "Failed to load customer activity.");
        } finally {
            setLoading(false);
        }
    }

    const tone = targetTone(report?.totals.targetPercent ?? null);
    const maxMonthValue = useMemo(
        () => Math.max(1, ...(report?.months ?? []).flatMap((month) => [month.sales, month.target])),
        [report]
    );

    async function handleExport() {
        if (!report) return;
        const XLSX = await import("xlsx");
        const workbook = XLSX.utils.book_new();

        XLSX.utils.book_append_sheet(
            workbook,
            XLSX.utils.json_to_sheet([
                { Metric: "Customer", Value: report.customer.customerName },
                { Metric: "Salesperson", Value: report.customer.salespersonName },
                { Metric: "Period", Value: `${report.startDate} to ${report.endDate}` },
                { Metric: "Customer Monthly Target", Value: report.customerMonthlyTarget },
                { Metric: "Target for period", Value: report.totals.targetTotal },
                { Metric: "Sales in period", Value: report.totals.totalSales },
                { Metric: "Target achieved %", Value: report.totals.targetPercent ?? "" },
                { Metric: "Orders", Value: report.totals.orderCount },
                { Metric: "Net sales ex VAT (AED)", Value: report.totals.netSales },
                { Metric: "Delivered revenue ex VAT (AED)", Value: report.totals.deliveredRevenue },
                { Metric: "Cost of goods (AED)", Value: report.totals.costOfGoods },
                { Metric: "Gross profit (AED)", Value: report.totals.grossProfit },
                { Metric: "GP %", Value: report.totals.gpPercent ?? "" },
                { Metric: "Open quotations", Value: report.totals.openQuotationCount },
            ]),
            "Summary"
        );
        XLSX.utils.book_append_sheet(
            workbook,
            XLSX.utils.json_to_sheet(
                report.months.map((month) => ({
                    Month: month.label,
                    Orders: month.orderCount,
                    Sales: month.sales,
                    Target: month.target,
                    "Achieved %": month.target > 0 ? Number(((month.sales / month.target) * 100).toFixed(1)) : "",
                    "Delivered revenue": month.deliveredRevenue,
                    GP: month.grossProfit,
                    "GP %": month.deliveredRevenue > 0 ? Number(((month.grossProfit / month.deliveredRevenue) * 100).toFixed(1)) : "",
                }))
            ),
            "Monthly"
        );
        XLSX.utils.book_append_sheet(
            workbook,
            XLSX.utils.json_to_sheet(
                report.orders.map((order) => ({
                    Order: order.name,
                    Date: formatDate(order.date),
                    Salesperson: order.salespersonName,
                    Amount: order.amount,
                    "Delivered revenue (ex VAT)": order.deliveredRevenue,
                    GP: order.grossProfit,
                    "GP %": order.deliveredRevenue > 0 ? Number(((order.grossProfit / order.deliveredRevenue) * 100).toFixed(1)) : "",
                }))
            ),
            "Orders"
        );
        XLSX.writeFile(workbook, `customer-activity-${sanitizeFileName(report.customer.customerName)}-${report.endDate}.xlsx`);
    }

    const lastSaleDays = daysSince(report?.totals.lastSaleDate ?? "");

    return (
        <section>
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="font-display text-3xl">Customer Activity</h1>
                    <p className="mt-1 text-sm text-(--ink-soft)">
                        One customer&apos;s orders and quotations over a period, measured against their monthly target.
                    </p>
                </div>
                <UserSearch className="h-8 w-8 shrink-0 text-(--brand)" aria-hidden="true" />
            </div>

            <form onSubmit={handleGenerate} className="mt-6 rounded-2xl border border-(--line) bg-(--card) p-5">
                <div className="grid gap-4 lg:grid-cols-[2fr_1fr_1fr]">
                    <label className="block">
                        <span className="mb-2 block text-sm font-medium">Customer</span>
                        <Select2
                            value={customerId}
                            onChange={setCustomerId}
                            options={customers.map((customer) => ({
                                value: String(customer.id),
                                label: customer.name,
                                description: customer.salespersonName || undefined,
                            }))}
                            loading={customersLoading}
                            placeholder="Select a customer"
                            searchPlaceholder="Search customers..."
                        />
                    </label>
                    <label className="block">
                        <span className="mb-2 block text-sm font-medium">Start Date</span>
                        <input
                            type="date"
                            value={startDate}
                            onChange={(event) => setStartDate(event.target.value)}
                            max={endDate}
                            required
                            className="w-full rounded-xl border border-(--line) bg-white px-3 py-2"
                        />
                    </label>
                    <label className="block">
                        <span className="mb-2 block text-sm font-medium">End Date</span>
                        <input
                            type="date"
                            value={endDate}
                            onChange={(event) => setEndDate(event.target.value)}
                            min={startDate}
                            required
                            className="w-full rounded-xl border border-(--line) bg-white px-3 py-2"
                        />
                    </label>
                </div>
                <div className="mt-5 flex flex-wrap items-center gap-3">
                    <button
                        type="submit"
                        disabled={loading || !customerId}
                        className="rounded-xl bg-(--brand) px-5 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-70"
                    >
                        {loading ? "Loading..." : "Generate"}
                    </button>
                    {customersError ? <p className="text-sm text-red-600">{customersError}</p> : null}
                </div>
                {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
            </form>

            {report ? (
                <div className="mt-6 space-y-6">
                    {/* Who */}
                    <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-(--line) bg-(--card) p-5">
                        <div>
                            <h2 className="font-display text-2xl">{report.customer.customerName}</h2>
                            <p className="mt-1 text-sm text-(--ink-soft)">Salesperson: {report.customer.salespersonName || "-"}</p>
                            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-(--ink-soft)">
                                {report.customer.phone ? (
                                    <span className="inline-flex items-center gap-1.5"><Phone className="h-4 w-4" />{report.customer.phone}</span>
                                ) : null}
                                {report.customer.email ? (
                                    <span className="inline-flex items-center gap-1.5"><Mail className="h-4 w-4" />{report.customer.email}</span>
                                ) : null}
                                {report.customer.city ? (
                                    <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4" />{report.customer.city}</span>
                                ) : null}
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Link
                                href={`/customers/${report.customer.customerId}`}
                                className="inline-flex items-center gap-2 rounded-xl border border-(--line) bg-white px-4 py-2 text-sm font-medium"
                            >
                                <FileText className="h-4 w-4" aria-hidden="true" />
                                Customer Report
                            </Link>
                            <button
                                type="button"
                                onClick={() => void handleExport()}
                                className="inline-flex items-center gap-2 rounded-xl border border-(--line) bg-white px-4 py-2 text-sm font-medium"
                            >
                                <Download className="h-4 w-4" aria-hidden="true" />
                                Export Excel
                            </button>
                        </div>
                    </div>

                    {/* Headline numbers */}
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                        <Metric label="Sales in period" value={formatCurrency(report.totals.totalSales)} hint={`${report.totals.orderCount} order${report.totals.orderCount === 1 ? "" : "s"}${report.totals.orderCount ? ` · avg ${formatCurrency(report.totals.averageOrderValue)}` : ""}`} />
                        <div className="rounded-2xl border border-(--line) bg-(--card) p-4">
                            <p className="flex items-center gap-1.5 text-xs text-(--ink-soft)"><Target className="h-3.5 w-3.5" />Customer Monthly Target</p>
                            <p className="mt-1 font-display text-2xl">{report.customerMonthlyTarget > 0 ? formatCurrency(report.customerMonthlyTarget) : "Not set"}</p>
                            <p className="mt-1 text-xs text-(--ink-soft)">
                                {report.customerMonthlyTarget > 0
                                    ? `${formatCurrency(report.totals.targetTotal)} over ${report.totals.targetMonths} month${report.totals.targetMonths === 1 ? "" : "s"}`
                                    : "Set it on the contact in Odoo"}
                            </p>
                        </div>
                        <div className="rounded-2xl border border-(--line) bg-(--card) p-4">
                            <p className="text-xs text-(--ink-soft)">Target achieved</p>
                            <p className="mt-1">
                                <span className={`inline-block rounded-full px-3 py-1 font-display text-2xl ${tone.pill}`}>
                                    {report.totals.targetPercent === null ? "—" : `${formatNumber(report.totals.targetPercent)}%`}
                                </span>
                            </p>
                            <p className="mt-1 text-xs text-(--ink-soft)">Sales ÷ target for the period</p>
                        </div>
                        <div className="rounded-2xl border border-(--line) bg-(--card) p-4">
                            <p className="text-xs text-(--ink-soft)">Gross profit (GP)</p>
                            <p className={`mt-1 font-display text-2xl ${report.totals.grossProfit < 0 ? "text-red-600" : ""}`}>
                                {formatCurrency(report.totals.grossProfit)}
                            </p>
                            <p className="mt-1 text-xs text-(--ink-soft)">
                                {report.totals.gpPercent === null ? "Nothing delivered yet" : (
                                    <>
                                        <span className={`rounded-full px-2 py-0.5 font-medium ${report.totals.gpPercent < 0 ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>
                                            {formatNumber(report.totals.gpPercent)}%
                                        </span>{" "}
                                        of {formatCurrency(report.totals.deliveredRevenue)} delivered
                                    </>
                                )}
                            </p>
                        </div>
                        <Metric
                            label="Last order"
                            value={report.totals.lastSaleDate ? formatDate(report.totals.lastSaleDate) : "None"}
                            hint={lastSaleDays === null ? "No orders in this period" : `${lastSaleDays} day${lastSaleDays === 1 ? "" : "s"} ago`}
                        />
                        <Metric
                            label="Open quotations"
                            value={String(report.totals.openQuotationCount)}
                            hint={report.totals.openQuotationCount ? formatCurrency(report.totals.openQuotationValue) : "None pending"}
                        />
                        <Metric label="Lifetime sales" value={formatCurrency(report.totals.lifetimeSales)} hint="All confirmed orders, any date" />
                    </div>

                    <p className="-mt-2 text-xs text-(--ink-soft)">
                        GP = delivered revenue (excluding VAT, in AED) minus the cost Odoo booked on those deliveries. Of {formatCurrency(report.totals.netSales)} ordered
                        (ex VAT), {formatCurrency(report.totals.deliveredRevenue)} has been delivered so far.
                        {report.totals.linesWithoutCost > 0
                            ? ` ${report.totals.linesWithoutCost} delivered line${report.totals.linesWithoutCost === 1 ? " has" : "s have"} no cost recorded in Odoo, so GP is overstated by their cost.`
                            : ""}
                    </p>

                    {/* Month by month vs target */}
                    <Panel icon={<CalendarDays className="h-5 w-5" />} title="Month by month vs target">
                        <div className="space-y-3">
                            {report.months.map((month) => {
                                const percent = month.target > 0 ? (month.sales / month.target) * 100 : null;
                                const monthTone = targetTone(percent);
                                return (
                                    <div key={month.month}>
                                        <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                                            <span className="font-medium">{month.label}</span>
                                            <span className="text-(--ink-soft)">
                                                {formatCurrency(month.sales)}
                                                {month.target > 0 ? ` of ${formatCurrency(month.target)}` : ""} · {month.orderCount} order{month.orderCount === 1 ? "" : "s"}
                                                {month.deliveredRevenue > 0 ? (
                                                    <span className={month.grossProfit < 0 ? "text-red-600" : ""}>
                                                        {" "}· GP {formatCurrency(month.grossProfit)} ({formatNumber((month.grossProfit / month.deliveredRevenue) * 100)}%)
                                                    </span>
                                                ) : null}
                                                {percent !== null ? (
                                                    <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${monthTone.pill}`}>{formatNumber(percent)}%</span>
                                                ) : null}
                                            </span>
                                        </div>
                                        <div className="relative mt-1.5 h-2.5 rounded-full bg-(--chip)">
                                            <div className={`h-2.5 rounded-full ${monthTone.bar}`} style={{ width: `${Math.min(100, (month.sales / maxMonthValue) * 100)}%` }} />
                                            {month.target > 0 ? (
                                                <span
                                                    className="absolute top-[-3px] h-4 w-0.5 bg-(--ink)"
                                                    style={{ left: `${Math.min(100, (month.target / maxMonthValue) * 100)}%` }}
                                                    title={`Target ${formatCurrency(month.target)}`}
                                                />
                                            ) : null}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        <p className="mt-3 text-xs text-(--ink-soft)">The dark tick marks each month&apos;s target. The first and last month count in full against the target even if the range covers only part of them.</p>
                    </Panel>

                    <Panel icon={<ShoppingCart className="h-5 w-5" />} title={`Orders in period (${report.orders.length})`}>
                        <OrdersTable rows={report.orders} empty="No confirmed orders in this period." showGp />
                    </Panel>

                    <Panel icon={<FileText className="h-5 w-5" />} title={`Open quotations (${report.openQuotations.length})`}>
                        <OrdersTable rows={report.openQuotations} empty="No open quotations." />
                    </Panel>

                    <Panel icon={<ShoppingCart className="h-5 w-5" />} title="What they buy (all time)">
                        <BrandSalesTree brands={report.brandTree ?? []} />
                    </Panel>
                </div>
            ) : null}
        </section>
    );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
    return (
        <div className="rounded-2xl border border-(--line) bg-(--card) p-4">
            <p className="text-xs text-(--ink-soft)">{label}</p>
            <p className="mt-1 font-display text-2xl">{value}</p>
            {hint ? <p className="mt-1 text-xs text-(--ink-soft)">{hint}</p> : null}
        </div>
    );
}

function Panel({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
    return (
        <div className="rounded-2xl border border-(--line) bg-(--card) p-5">
            <h3 className="flex items-center gap-2 font-display text-lg">
                <span className="text-(--brand)">{icon}</span>
                {title}
            </h3>
            <div className="mt-4">{children}</div>
        </div>
    );
}

function OrdersTable({ rows, empty, showGp = false }: { rows: OdooCustomerActivityOrder[]; empty: string; showGp?: boolean }) {
    if (rows.length === 0) return <p className="text-sm text-(--ink-soft)">{empty}</p>;
    const total = rows.reduce((sum, row) => sum + row.amount, 0);
    return (
        <>
            <div className="max-h-80 overflow-auto rounded-xl border border-(--line)">
                <table className="min-w-full text-left text-sm">
                    <thead className="sticky top-0 bg-(--chip) text-(--ink-soft)">
                        <tr>
                            <th className="px-3 py-2 font-medium">Order</th>
                            <th className="px-3 py-2 font-medium">Date</th>
                            <th className="px-3 py-2 font-medium">Salesperson</th>
                            <th className="px-3 py-2 text-right font-medium">Amount</th>
                            {showGp ? <th className="px-3 py-2 text-right font-medium">GP</th> : null}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row) => (
                            <tr key={row.id} className="border-t border-(--line)">
                                <td className="px-3 py-2 font-medium">{row.name}</td>
                                <td className="px-3 py-2 text-(--ink-soft)">{formatDate(row.date)}</td>
                                <td className="px-3 py-2 text-(--ink-soft)">{row.salespersonName}</td>
                                <td className="px-3 py-2 text-right font-medium">{formatCurrency(row.amount)}</td>
                                {showGp ? (
                                    <td className={`px-3 py-2 text-right ${row.grossProfit < 0 ? "text-red-600" : ""}`}>
                                        {row.deliveredRevenue > 0 ? (
                                            <>
                                                {formatCurrency(row.grossProfit)}
                                                <span className="block text-xs text-(--ink-soft)">{formatNumber((row.grossProfit / row.deliveredRevenue) * 100)}%</span>
                                            </>
                                        ) : (
                                            <span className="text-(--ink-soft)">not delivered</span>
                                        )}
                                    </td>
                                ) : null}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <p className="mt-2 text-right text-sm font-medium">
                Total {formatCurrency(total)}
                {showGp ? ` · GP ${formatCurrency(rows.reduce((sum, row) => sum + row.grossProfit, 0))}` : ""}
            </p>
        </>
    );
}
