"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { AlertCircle, ChevronDown, ChevronUp, Download, Eye, Loader2, Search, Users, X } from "lucide-react";
import { getCustomerFollowupReport, getCustomers } from "@/lib/client-odoo";
import { LimitedMultiSelect } from "@/components/limited-multi-select";
import { getDisplayCurrency } from "@/lib/display-currency";
import { writeWorkbook } from "@/lib/client-activity";
import { maxFollowupEnd, validateFollowupRange } from "@/lib/followup-range";
import type { OdooCustomerFollowupReport, OdooCustomerFollowupRow, OdooCustomerOption } from "@/types/odoo";

type SortKey = "customerName" | "paymentTerm" | "orderCount" | "salesTotal" | "grossProfit" | "totalDue";

function isoDate(date: Date) {
    return date.toISOString().slice(0, 10);
}

function todayISO() {
    return isoDate(new Date());
}

function formatNumber(value: number) {
    return value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatCurrency(value: number) {
    return `${getDisplayCurrency()} ${formatNumber(value)}`;
}

function formatDate(value: string) {
    if (!value) return "-";
    const date = new Date(value.includes("T") || value.length <= 10 ? value : `${value.replace(" ", "T")}Z`);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function daysBetween(startDate: string, endDate: string) {
    return Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86_400_000) + 1;
}

/** Quick period choices; every one is within the one-month limit. */
const PRESETS: Array<{ label: string; range: () => [string, string] }> = [
    {
        label: "This month",
        range: () => {
            const now = new Date();
            return [isoDate(new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1))), todayISO()];
        },
    },
    {
        label: "Last month",
        range: () => {
            const now = new Date();
            return [
                isoDate(new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, 1))),
                isoDate(new Date(Date.UTC(now.getFullYear(), now.getMonth(), 0))),
            ];
        },
    },
    {
        label: "Last 7 days",
        range: () => [isoDate(new Date(Date.now() - 6 * 86_400_000)), todayISO()],
    },
    {
        label: "Last 30 days",
        range: () => [isoDate(new Date(Date.now() - 29 * 86_400_000)), todayISO()],
    },
];

function sanitizeFileName(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "report";
}

export function CustomerFollowupReport() {
    const [customers, setCustomers] = useState<OdooCustomerOption[]>([]);
    const [customersLoading, setCustomersLoading] = useState(true);
    const [customersError, setCustomersError] = useState<string | null>(null);

    const [scope, setScope] = useState<"all" | "selected">("all");
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [startDate, setStartDate] = useState(() => PRESETS[0].range()[0]);
    const [endDate, setEndDate] = useState(() => PRESETS[0].range()[1]);

    const [report, setReport] = useState<OdooCustomerFollowupReport | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [filter, setFilter] = useState("");
    const [sortKey, setSortKey] = useState<SortKey>("salesTotal");
    const [sortDesc, setSortDesc] = useState(true);
    const [detail, setDetail] = useState<OdooCustomerFollowupRow | null>(null);

    useEffect(() => {
        getCustomers()
            .then((data) => setCustomers(data.customers))
            .catch((loadError) => setCustomersError(loadError instanceof Error ? loadError.message : "Failed to load customers."))
            .finally(() => setCustomersLoading(false));
    }, []);

    useEffect(() => {
        if (!detail) return undefined;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") setDetail(null);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [detail]);

    const rangeError = validateFollowupRange(startDate, endDate);
    const customerCount = scope === "all" ? customers.length : selectedIds.length;
    const canGenerate = !loading && !rangeError && customerCount > 0;

    function changeStart(value: string) {
        setStartDate(value);
        if (!value) return;
        // Keep the end date inside the one-month limit by moving it, instead of leaving the form invalid.
        const limit = maxFollowupEnd(value);
        if (endDate < value) setEndDate(value);
        else if (endDate > limit) setEndDate(limit);
    }

    async function handleGenerate(event: FormEvent) {
        event.preventDefault();
        if (!canGenerate) return;
        setLoading(true);
        setError(null);
        try {
            const ids = scope === "all" ? customers.map((customer) => customer.id) : selectedIds.map(Number);
            const data = await getCustomerFollowupReport({ customerIds: ids, onlyWithOrders: scope === "all", startDate, endDate });
            setReport(data);
            setFilter("");
        } catch (generateError) {
            setReport(null);
            setError(generateError instanceof Error ? generateError.message : "Failed to build the report.");
        } finally {
            setLoading(false);
        }
    }

    const rows = useMemo(() => {
        if (!report) return [];
        const query = filter.trim().toLowerCase();
        const list = query
            ? report.rows.filter((row) => [row.customerName, row.paymentTerm, row.salespersonName].some((text) => text.toLowerCase().includes(query)))
            : report.rows;
        const direction = sortDesc ? -1 : 1;
        return [...list].sort((a, b) => {
            const left = a[sortKey] ?? 0;
            const right = b[sortKey] ?? 0;
            if (typeof left === "string" || typeof right === "string") return String(left).localeCompare(String(right)) * direction;
            return (left - right) * direction;
        });
    }, [report, filter, sortKey, sortDesc]);

    function sortBy(key: SortKey) {
        if (key === sortKey) setSortDesc((current) => !current);
        else {
            setSortKey(key);
            setSortDesc(key !== "customerName" && key !== "paymentTerm");
        }
    }

    async function handleExport() {
        if (!report) return;
        const XLSX = await import("xlsx");
        const workbook = XLSX.utils.book_new();
        const withGp = report.costAvailable;
        XLSX.utils.book_append_sheet(
            workbook,
            XLSX.utils.json_to_sheet(
                rows.map((row) => ({
                    Customer: row.customerName,
                    "Payment terms": row.paymentTerm,
                    Salesperson: row.salespersonName,
                    "Sales orders": row.orderCount,
                    "Sales total": row.salesTotal,
                    ...(withGp ? { Margin: row.grossProfit, "Margin %": row.gpPercent ?? "" } : {}),
                    "Total due": row.totalDue ?? "",
                }))
            ),
            "Customers"
        );
        XLSX.utils.book_append_sheet(
            workbook,
            XLSX.utils.json_to_sheet(
                rows.flatMap((row) =>
                    row.orders.map((order) => ({
                        Customer: row.customerName,
                        Order: order.name,
                        Date: formatDate(order.date),
                        Salesperson: order.salespersonName,
                        Amount: order.amount,
                        ...(withGp ? { Margin: order.grossProfit } : {}),
                    }))
                )
            ),
            "Sales orders"
        );
        writeWorkbook(XLSX, workbook, `customer-followup-${sanitizeFileName(`${report.startDate}-${report.endDate}`)}.xlsx`);
    }

    const periodDays = !startDate || !endDate || startDate > endDate ? 0 : daysBetween(startDate, endDate);
    const SortIcon = sortDesc ? ChevronDown : ChevronUp;

    function headerCell(label: string, key: SortKey, align: "left" | "right" = "left") {
        return (
            <th className={`px-3 py-2.5 font-medium ${align === "right" ? "text-right" : ""}`} aria-sort={sortKey === key ? (sortDesc ? "descending" : "ascending") : "none"}>
                <button type="button" onClick={() => sortBy(key)} className={`inline-flex items-center gap-1 ${align === "right" ? "flex-row-reverse" : ""} hover:text-(--ink)`}>
                    {label}
                    {sortKey === key ? <SortIcon className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                </button>
            </th>
        );
    }

    return (
        <section>
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="font-display text-3xl">Customer Followup Report</h1>
                    <p className="mt-1 text-sm text-(--ink-soft)">
                        What your customers ordered in a period, the margin on it, and what they still owe.
                    </p>
                </div>
                <Users className="h-8 w-8 shrink-0 text-(--brand)" aria-hidden="true" />
            </div>

            <form onSubmit={handleGenerate} className="mt-6 space-y-5 rounded-2xl border border-(--line) bg-(--card) p-5">
                {/* Step 1 */}
                <div>
                    <p className="mb-2 text-sm font-medium">
                        <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-(--brand) text-xs text-white">1</span>
                        Which customers?
                    </p>
                    <div className="inline-flex overflow-hidden rounded-xl border border-(--line) bg-white" role="group" aria-label="Customers">
                        <button
                            type="button"
                            onClick={() => setScope("all")}
                            aria-pressed={scope === "all"}
                            className={`px-4 py-2 text-sm ${scope === "all" ? "bg-(--chip) font-medium text-(--brand)" : "text-(--ink-soft)"}`}
                        >
                            All customers{customersLoading ? "" : ` (${customers.length})`}
                        </button>
                        <button
                            type="button"
                            onClick={() => setScope("selected")}
                            aria-pressed={scope === "selected"}
                            className={`border-l border-(--line) px-4 py-2 text-sm ${scope === "selected" ? "bg-(--chip) font-medium text-(--brand)" : "text-(--ink-soft)"}`}
                        >
                            Choose customers
                        </button>
                    </div>
                    {scope === "selected" ? (
                        <div className="mt-3 max-w-2xl">
                            <LimitedMultiSelect
                                values={selectedIds}
                                onChange={setSelectedIds}
                                options={customers.map((customer) => ({
                                    value: String(customer.id),
                                    label: customer.name,
                                    description: customer.salespersonName && customer.salespersonName !== "-" ? customer.salespersonName : undefined,
                                }))}
                                max={Math.max(1, customers.length)}
                                loading={customersLoading}
                                loadingText="Loading customers..."
                                placeholder="Search and pick one or more customers"
                                searchPlaceholder="Type a customer or salesperson name"
                            />
                        </div>
                    ) : (
                        <p className="mt-2 text-xs text-(--ink-soft)">Only customers that have sales orders in the period are listed.</p>
                    )}
                    {customersError ? <p className="mt-2 text-sm text-red-600">{customersError}</p> : null}
                </div>

                {/* Step 2 */}
                <div>
                    <p className="mb-2 text-sm font-medium">
                        <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-(--brand) text-xs text-white">2</span>
                        Which period? <span className="font-normal text-(--ink-soft)">(up to 1 month)</span>
                    </p>
                    <div className="flex flex-wrap items-end gap-3">
                        <label className="block">
                            <span className="mb-1 block text-xs text-(--ink-soft)">From</span>
                            <input
                                type="date"
                                value={startDate}
                                onChange={(event) => changeStart(event.target.value)}
                                className="rounded-xl border border-(--line) bg-white px-3 py-2 text-sm"
                            />
                        </label>
                        <label className="block">
                            <span className="mb-1 block text-xs text-(--ink-soft)">To</span>
                            <input
                                type="date"
                                value={endDate}
                                min={startDate || undefined}
                                max={startDate ? maxFollowupEnd(startDate) : undefined}
                                onChange={(event) => setEndDate(event.target.value)}
                                className="rounded-xl border border-(--line) bg-white px-3 py-2 text-sm"
                            />
                        </label>
                        <div className="flex flex-wrap gap-2">
                            {PRESETS.map((preset) => (
                                <button
                                    key={preset.label}
                                    type="button"
                                    onClick={() => {
                                        const [from, to] = preset.range();
                                        setStartDate(from);
                                        setEndDate(to);
                                    }}
                                    className="rounded-full border border-(--line) bg-white px-3 py-1.5 text-xs hover:bg-(--chip)"
                                >
                                    {preset.label}
                                </button>
                            ))}
                        </div>
                    </div>
                    {rangeError ? (
                        <p className="mt-2 flex items-center gap-1.5 text-sm text-red-600">
                            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" /> {rangeError}
                        </p>
                    ) : (
                        <p className="mt-2 text-xs text-(--ink-soft)">
                            {formatDate(startDate)} to {formatDate(endDate)} · {periodDays} day{periodDays === 1 ? "" : "s"}
                        </p>
                    )}
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    <button
                        type="submit"
                        disabled={!canGenerate}
                        className="inline-flex items-center gap-2 rounded-xl bg-(--brand) px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                        {loading ? "Building report..." : "Generate report"}
                    </button>
                    {scope === "selected" && selectedIds.length === 0 ? (
                        <span className="text-xs text-(--ink-soft)">Pick at least one customer to continue.</span>
                    ) : null}
                </div>
            </form>

            {error ? <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}

            {report ? (
                <div className="mt-6 space-y-4">
                    {/* Summary */}
                    <div className={`grid grid-cols-2 gap-3 ${report.costAvailable ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
                        <SummaryCard label="Customers" value={String(report.totals.customerCount)} />
                        <SummaryCard label="Sales orders" value={String(report.totals.orderCount)} />
                        <SummaryCard label="Sales total" value={formatCurrency(report.totals.salesTotal)} />
                        {report.costAvailable ? (
                            <SummaryCard
                                label="Margin"
                                value={formatCurrency(report.totals.grossProfit)}
                                note={report.totals.gpPercent !== null ? `${formatNumber(report.totals.gpPercent)}% of delivered` : undefined}
                            />
                        ) : null}
                        <SummaryCard label="Total due" value={formatCurrency(report.totals.totalDue)} tone="due" />
                    </div>

                    {/* Table */}
                    <div className="rounded-2xl border border-(--line) bg-(--card)">
                        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-(--line) p-3">
                            <div className="relative min-w-[14rem] flex-1 sm:max-w-sm">
                                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--ink-soft)" aria-hidden="true" />
                                <input
                                    value={filter}
                                    onChange={(event) => setFilter(event.target.value)}
                                    placeholder="Find a customer, payment term or salesperson"
                                    className="w-full rounded-xl border border-(--line) bg-white py-2 pl-9 pr-3 text-sm"
                                />
                            </div>
                            <div className="flex items-center gap-3">
                                <span className="text-xs text-(--ink-soft)">
                                    {rows.length === report.rows.length ? `${rows.length} customers` : `${rows.length} of ${report.rows.length} customers`}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => void handleExport()}
                                    disabled={rows.length === 0}
                                    className="inline-flex items-center gap-2 rounded-xl border border-(--line) bg-white px-3 py-2 text-sm font-medium disabled:opacity-50"
                                >
                                    <Download className="h-4 w-4" aria-hidden="true" /> Export
                                </button>
                            </div>
                        </div>

                        {report.rows.length === 0 ? (
                            <p className="p-6 text-center text-sm text-(--ink-soft)">No customer had confirmed sales orders between these dates.</p>
                        ) : rows.length === 0 ? (
                            <p className="p-6 text-center text-sm text-(--ink-soft)">No customer matches &ldquo;{filter}&rdquo;.</p>
                        ) : (
                            <div className="max-h-[70vh] overflow-auto">
                                <table className="min-w-full text-left text-sm">
                                    <thead className="sticky top-0 z-10 bg-(--chip) text-(--ink-soft)">
                                        <tr>
                                            {headerCell("Customer", "customerName")}
                                            {headerCell("Payment terms", "paymentTerm")}
                                            {headerCell("Sales orders", "orderCount", "right")}
                                            {headerCell("Sales total", "salesTotal", "right")}
                                            {report.costAvailable ? headerCell("Margin", "grossProfit", "right") : null}
                                            {headerCell("Total due", "totalDue", "right")}
                                            <th className="px-3 py-2.5 text-right font-medium">Details</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rows.map((row) => (
                                            <tr key={row.customerId} className="border-t border-(--line) hover:bg-(--chip)/40">
                                                <td className="max-w-64 px-3 py-2.5">
                                                    <span className="block truncate font-medium">{row.customerName}</span>
                                                    <span className="block truncate text-xs text-(--ink-soft)">{row.salespersonName}</span>
                                                </td>
                                                <td className="px-3 py-2.5 text-(--ink-soft)">{row.paymentTerm || "Not set"}</td>
                                                <td className="px-3 py-2.5 text-right tabular-nums">{row.orderCount}</td>
                                                <td className="px-3 py-2.5 text-right font-medium tabular-nums">{formatCurrency(row.salesTotal)}</td>
                                                {report.costAvailable ? (
                                                    <td className={`px-3 py-2.5 text-right tabular-nums ${row.grossProfit < 0 ? "text-red-600" : ""}`}>
                                                        {row.deliveredRevenue > 0 ? (
                                                            <>
                                                                {formatCurrency(row.grossProfit)}
                                                                {row.gpPercent !== null ? <span className="block text-xs text-(--ink-soft)">{formatNumber(row.gpPercent)}%</span> : null}
                                                            </>
                                                        ) : (
                                                            <span className="text-xs text-(--ink-soft)">{row.orderCount > 0 ? "not delivered yet" : "-"}</span>
                                                        )}
                                                    </td>
                                                ) : null}
                                                <td className={`px-3 py-2.5 text-right tabular-nums ${row.totalDue && row.totalDue > 0 ? "font-medium text-amber-700" : "text-(--ink-soft)"}`}>
                                                    {row.totalDue === null ? "-" : formatCurrency(row.totalDue)}
                                                </td>
                                                <td className="px-3 py-2.5 text-right">
                                                    <button
                                                        type="button"
                                                        onClick={() => setDetail(row)}
                                                        disabled={row.orderCount === 0}
                                                        className="inline-flex items-center gap-1.5 rounded-lg border border-(--line) bg-white px-2.5 py-1 text-xs font-medium hover:bg-(--chip) disabled:cursor-not-allowed disabled:opacity-40"
                                                        title={row.orderCount === 0 ? "No sales orders in this period" : "See this customer's sales orders"}
                                                    >
                                                        <Eye className="h-3.5 w-3.5" aria-hidden="true" /> Details
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot className="sticky bottom-0 bg-(--chip) font-semibold">
                                        <tr className="border-t-2 border-(--line)">
                                            <td className="px-3 py-2.5" colSpan={2}>
                                                Total ({rows.length} customer{rows.length === 1 ? "" : "s"})
                                            </td>
                                            <td className="px-3 py-2.5 text-right tabular-nums">{rows.reduce((sum, row) => sum + row.orderCount, 0)}</td>
                                            <td className="px-3 py-2.5 text-right tabular-nums">{formatCurrency(rows.reduce((sum, row) => sum + row.salesTotal, 0))}</td>
                                            {report.costAvailable ? (
                                                <td className="px-3 py-2.5 text-right tabular-nums">{formatCurrency(rows.reduce((sum, row) => sum + row.grossProfit, 0))}</td>
                                            ) : null}
                                            <td className="px-3 py-2.5 text-right tabular-nums">{formatCurrency(rows.reduce((sum, row) => sum + (row.totalDue ?? 0), 0))}</td>
                                            <td />
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        )}
                    </div>
                    <p className="text-xs text-(--ink-soft)">
                        Sales total = confirmed sales orders dated {formatDate(report.startDate)} to {formatDate(report.endDate)} (VAT included).
                        {report.costAvailable ? " Margin is measured on what has been delivered so far. " : " "}
                        Total due = the customer&apos;s open receivable balance today.
                    </p>
                </div>
            ) : null}

            {detail && report ? (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
                    onMouseDown={(event) => {
                        if (event.target === event.currentTarget) setDetail(null);
                    }}
                >
                    <div role="dialog" aria-modal="true" aria-label={`Sales orders of ${detail.customerName}`} className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl border border-(--line) bg-(--card) shadow-xl">
                        <div className="flex items-start justify-between gap-4 border-b border-(--line) p-5">
                            <div className="min-w-0">
                                <h2 className="truncate font-display text-xl">{detail.customerName}</h2>
                                <p className="mt-0.5 text-sm text-(--ink-soft)">
                                    Sales orders from {formatDate(report.startDate)} to {formatDate(report.endDate)}
                                    {detail.paymentTerm ? ` · ${detail.paymentTerm}` : ""}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setDetail(null)}
                                className="rounded-lg border border-(--line) p-1.5 text-(--ink-soft) hover:bg-(--chip)"
                                aria-label="Close"
                                autoFocus
                            >
                                <X className="h-4 w-4" aria-hidden="true" />
                            </button>
                        </div>
                        <div className="overflow-auto p-5">
                            <table className="min-w-full text-left text-sm">
                                <thead className="text-(--ink-soft)">
                                    <tr>
                                        <th className="px-3 py-2 font-medium">Order</th>
                                        <th className="px-3 py-2 font-medium">Date</th>
                                        <th className="px-3 py-2 font-medium">Salesperson</th>
                                        <th className="px-3 py-2 text-right font-medium">Amount</th>
                                        {report.costAvailable ? <th className="px-3 py-2 text-right font-medium">Margin</th> : null}
                                    </tr>
                                </thead>
                                <tbody>
                                    {detail.orders.map((order) => (
                                        <tr key={order.id} className="border-t border-(--line)">
                                            <td className="px-3 py-2 font-medium">{order.name}</td>
                                            <td className="px-3 py-2 text-(--ink-soft)">{formatDate(order.date)}</td>
                                            <td className="px-3 py-2 text-(--ink-soft)">{order.salespersonName}</td>
                                            <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(order.amount)}</td>
                                            {report.costAvailable ? (
                                                <td className={`px-3 py-2 text-right tabular-nums ${order.grossProfit < 0 ? "text-red-600" : ""}`}>
                                                    {order.deliveredRevenue > 0 ? (
                                                        <>
                                                            {formatCurrency(order.grossProfit)}
                                                            <span className="block text-xs text-(--ink-soft)">{formatNumber((order.grossProfit / order.deliveredRevenue) * 100)}%</span>
                                                        </>
                                                    ) : (
                                                        <span className="text-xs text-(--ink-soft)">not delivered yet</span>
                                                    )}
                                                </td>
                                            ) : null}
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot>
                                    <tr className="border-t-2 border-(--line) font-semibold">
                                        <td className="px-3 py-2" colSpan={3}>
                                            Total ({detail.orderCount} order{detail.orderCount === 1 ? "" : "s"})
                                        </td>
                                        <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(detail.salesTotal)}</td>
                                        {report.costAvailable ? <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(detail.grossProfit)}</td> : null}
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>
                </div>
            ) : null}
        </section>
    );
}

function SummaryCard({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: "due" }) {
    return (
        <div className="rounded-2xl border border-(--line) bg-(--card) p-4">
            <p className="text-sm text-(--ink-soft)">{label}</p>
            <p className={`mt-1 font-display text-2xl ${tone === "due" ? "text-amber-700" : ""}`}>{value}</p>
            {note ? <p className="text-xs text-(--ink-soft)">{note}</p> : null}
        </div>
    );
}
