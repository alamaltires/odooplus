"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
    AlertTriangle,
    ArrowDown,
    ArrowUp,
    Banknote,
    Building2,
    Calendar,
    ChevronDown,
    ChevronsUpDown,
    ChevronUp,
    Download,
    HandCoins,
    Landmark,
    MessageCircle,
    Receipt,
    Search,
    Users,
} from "lucide-react";
import { getCustomers, getPaymentFollowupByCustomer, getPaymentFollowupBySalesperson, getSalespeople } from "@/lib/client-odoo";
import { useAuth } from "@/lib/auth-context";
import { Select2 } from "@/components/select2";
import {
    OdooCustomerOption,
    OdooSalesperson,
    PaymentFollowupAgingBucket,
    PaymentFollowupCustomerRow,
    PaymentFollowupReport,
} from "@/types/odoo";

type Mode = "salesperson" | "customer";
type SortDirection = "asc" | "desc";

function todayISO() {
    return new Date().toISOString().slice(0, 10);
}

function formatNumber(value: number) {
    return value.toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    });
}

function formatCurrency(value: number, currencyCode: string) {
    return `${currencyCode} ${formatNumber(value)}`;
}

function formatDate(value: string) {
    return value || "-";
}

function sanitizeFileName(value: string) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "payment-followup";
}

type AgingSystem = "day" | "month";

// Mirrors Odoo's own Aged Receivable report columns. A second, "month"
// variant is used instead whenever the report's Aging System toggle is set
// to Month — same 6 bucket keys, just labeled (and, server-side, computed)
// by calendar months crossed rather than fixed 30-day windows.
const DAY_AGING_COLUMNS: Array<{ key: PaymentFollowupAgingBucket; label: string; tint: string }> = [
    { key: "notDue", label: "Not Due", tint: "text-emerald-700" },
    { key: "d1_30", label: "1-30", tint: "text-amber-700" },
    { key: "d31_60", label: "31-60", tint: "text-orange-700" },
    { key: "d61_90", label: "61-90", tint: "text-red-700" },
    { key: "d91_120", label: "91-120", tint: "text-rose-800" },
    { key: "older", label: "Older", tint: "text-rose-900" },
];

const MONTH_AGING_COLUMNS: Array<{ key: PaymentFollowupAgingBucket; label: string; tint: string }> = [
    { key: "notDue", label: "Not Due", tint: "text-emerald-700" },
    { key: "d1_30", label: "1 Month", tint: "text-amber-700" },
    { key: "d31_60", label: "2 Months", tint: "text-orange-700" },
    { key: "d61_90", label: "3 Months", tint: "text-red-700" },
    { key: "d91_120", label: "4 Months", tint: "text-rose-800" },
    { key: "older", label: "Older", tint: "text-rose-900" },
];

function agingColumnsFor(system: AgingSystem) {
    return system === "month" ? MONTH_AGING_COLUMNS : DAY_AGING_COLUMNS;
}

const DAY_AGING_META: Record<
    PaymentFollowupAgingBucket,
    { label: string; badge: string; accent: string }
> = {
    notDue: {
        label: "Not due",
        badge: "border-emerald-200 bg-emerald-50 text-emerald-800",
        accent: "bg-emerald-500",
    },
    d1_30: {
        label: "1-30d",
        badge: "border-amber-200 bg-amber-50 text-amber-800",
        accent: "bg-amber-500",
    },
    d31_60: {
        label: "31-60d",
        badge: "border-orange-200 bg-orange-50 text-orange-800",
        accent: "bg-orange-500",
    },
    d61_90: {
        label: "61-90d",
        badge: "border-red-200 bg-red-50 text-red-700",
        accent: "bg-red-600",
    },
    d91_120: {
        label: "91-120d",
        badge: "border-rose-300 bg-rose-100 text-rose-900",
        accent: "bg-rose-700",
    },
    older: {
        label: "120d+",
        badge: "border-rose-400 bg-rose-200 text-rose-950",
        accent: "bg-rose-900",
    },
};

const MONTH_AGING_META: Record<
    PaymentFollowupAgingBucket,
    { label: string; badge: string; accent: string }
> = {
    notDue: DAY_AGING_META.notDue,
    d1_30: { ...DAY_AGING_META.d1_30, label: "1mo" },
    d31_60: { ...DAY_AGING_META.d31_60, label: "2mo" },
    d61_90: { ...DAY_AGING_META.d61_90, label: "3mo" },
    d91_120: { ...DAY_AGING_META.d91_120, label: "4mo" },
    older: DAY_AGING_META.older,
};

function agingMetaFor(bucket: PaymentFollowupAgingBucket, system: AgingSystem) {
    return (system === "month" ? MONTH_AGING_META : DAY_AGING_META)[bucket];
}

function daysOverdueLabel(days: number) {
    if (days <= 0) {
        return days === 0 ? "Due today" : `Due in ${Math.abs(days)}d`;
    }
    return `${days}d overdue`;
}

// `system` only changes which bucket-label vocabulary is shown (e.g. "1mo"
// vs "1-30d") — the days-overdue count next to it is always the exact day
// count regardless of which Aging System is selected, since that's a plain
// fact about the underlying invoice(s), not a bucket.
function AgingBadge({
    bucket,
    days,
    system = "day",
}: {
    bucket: PaymentFollowupAgingBucket;
    days: number;
    system?: AgingSystem;
}) {
    const meta = agingMetaFor(bucket, system);
    return (
        <span
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold ${meta.badge}`}
        >
            <span className={`h-1.5 w-1.5 rounded-full ${meta.accent}`} aria-hidden="true" />
            {meta.label} · {daysOverdueLabel(days)}
        </span>
    );
}

// Keyword-matched rather than exact-string, since a PDC addon's own state
// vocabulary varies — this just needs to look right for whatever it turns
// out to say (Draft, Registered, Done, Bounced, ...).
function chequeStateBadgeClasses(state: string, isDeposited: boolean): string {
    if (isDeposited) return "bg-violet-100 text-violet-800";
    const lower = state.toLowerCase();
    if (lower.includes("regist")) return "bg-amber-100 text-amber-800";
    if (lower.includes("done") || lower.includes("clear") || lower.includes("cash") || lower.includes("paid")) {
        return "bg-emerald-100 text-emerald-800";
    }
    if (lower.includes("bounce") || lower.includes("reject")) return "bg-red-100 text-red-800";
    if (lower.includes("cancel") || lower.includes("void")) return "bg-(--chip) text-(--ink-soft)";
    if (lower.includes("return")) return "bg-orange-100 text-orange-800";
    if (lower.includes("draft")) return "bg-slate-100 text-slate-700";
    return "bg-(--chip) text-(--ink-soft)";
}

function toWhatsAppNumber(phone: string): string | null {
    const digits = phone.replace(/[^\d]/g, "");
    return digits.length >= 7 ? digits : null;
}

function buildWhatsAppMessage(row: PaymentFollowupCustomerRow) {
    const lines = [
        `Hello ${row.customerName},`,
        "",
        "This is a friendly payment reminder from Al Amal Tyres.",
        `Outstanding balance: ${formatCurrency(row.netDue, row.currencyCode)}`,
    ];

    if (row.oldestDueDate) {
        lines.push(
            `Oldest due date: ${row.oldestDueDate}${row.maxDaysOverdue > 0 ? ` (${row.maxDaysOverdue} days overdue)` : ""}`
        );
    }

    if (row.totalUnapplied > 0) {
        lines.push(
            `Note: we have ${formatCurrency(row.totalUnapplied, row.currencyCode)} received from you that isn't yet applied to an invoice — let us know if you'd like it allocated.`
        );
    }

    if (row.totalPdcPending > 0) {
        lines.push(`We also have ${formatCurrency(row.totalPdcPending, row.currencyCode)} in post-dated cheques pending collection.`);
    }

    lines.push("", "Kindly arrange settlement at your earliest convenience. Thank you!");
    return lines.join("\n");
}

// WhatsApp's public click-to-chat link (wa.me) needs no API key, so the
// button is already functional today. Swap this for a real send call once
// the WhatsApp Business API is configured — everything else on this page
// (the composed message, the phone lookup) stays the same.
function WhatsAppButton({ row }: { row: PaymentFollowupCustomerRow }) {
    const phone = toWhatsAppNumber(row.phone);
    const href = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(buildWhatsAppMessage(row))}` : undefined;

    return (
        <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => {
                if (!phone) {
                    event.preventDefault();
                }
            }}
            title={phone ? "Send a WhatsApp payment reminder" : "No phone number on file for this customer"}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition ${phone
                ? "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                : "cursor-not-allowed border-(--line) bg-(--chip) text-(--ink-soft) opacity-60"
                }`}
        >
            <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
            WhatsApp
        </a>
    );
}

function StatCard({
    label,
    value,
    tone,
    icon: Icon,
    hint,
}: {
    label: string;
    value: string;
    tone: "blue" | "amber" | "purple" | "green" | "red";
    icon: typeof Banknote;
    hint?: string;
}) {
    const toneClasses: Record<typeof tone, string> = {
        blue: "from-sky-500/10 to-sky-500/0 border-sky-200 text-sky-700",
        amber: "from-amber-500/10 to-amber-500/0 border-amber-200 text-amber-700",
        purple: "from-violet-500/10 to-violet-500/0 border-violet-200 text-violet-700",
        green: "from-emerald-500/10 to-emerald-500/0 border-emerald-200 text-emerald-700",
        red: "from-rose-500/10 to-rose-500/0 border-rose-200 text-rose-700",
    };

    return (
        <div className={`rounded-2xl border bg-gradient-to-br p-4 ${toneClasses[tone]}`}>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
            </div>
            <p className="mt-2 font-display text-2xl text-(--ink)">{value}</p>
            {hint ? <p className="mt-1 text-xs text-(--ink-soft)">{hint}</p> : null}
        </div>
    );
}

function EmptyState({ message }: { message: string }) {
    return <p className="px-1 py-2 text-sm text-(--ink-soft)">{message}</p>;
}

function SortIcon({ active, direction }: { active: boolean; direction: SortDirection }) {
    if (!active) {
        return <ChevronsUpDown className="h-3 w-3 text-(--ink-soft)/50" aria-hidden="true" />;
    }
    return direction === "asc" ? (
        <ArrowUp className="h-3 w-3 text-(--brand)" aria-hidden="true" />
    ) : (
        <ArrowDown className="h-3 w-3 text-(--brand)" aria-hidden="true" />
    );
}

function SortableTh<K extends string>({
    label,
    sortKey,
    activeKey,
    direction,
    onSort,
    align = "left",
}: {
    label: string;
    sortKey: K;
    activeKey: K;
    direction: SortDirection;
    onSort: (key: K) => void;
    align?: "left" | "right";
}) {
    return (
        <th className={`px-3 py-2 font-medium ${align === "right" ? "text-right" : "text-left"}`}>
            <button
                type="button"
                onClick={() => onSort(sortKey)}
                className={`inline-flex items-center gap-1 hover:text-(--ink) ${align === "right" ? "flex-row-reverse" : ""}`}
            >
                {label}
                <SortIcon active={activeKey === sortKey} direction={direction} />
            </button>
        </th>
    );
}

// Shared header for each of the three per-customer sections below: a search
// box that filters that section's own rows, plus a live count/total that
// reacts to it — kept generic here since only the matching logic and the
// stat differ per section.
function SectionToolbar({
    query,
    onQueryChange,
    placeholder,
    filteredCount,
    totalCount,
    statLabel,
    statValue,
}: {
    query: string;
    onQueryChange: (value: string) => void;
    placeholder: string;
    filteredCount: number;
    totalCount: number;
    statLabel: string;
    statValue: string;
}) {
    return (
        <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-56">
                <Search
                    className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-(--ink-soft)"
                    aria-hidden="true"
                />
                <input
                    type="search"
                    value={query}
                    onChange={(event) => onQueryChange(event.target.value)}
                    placeholder={placeholder}
                    className="w-full rounded-lg border border-(--line) bg-white py-1.5 pl-8 pr-3 text-xs"
                />
            </div>
            <div className="flex items-center gap-2 text-xs text-(--ink-soft)">
                <span>
                    {filteredCount} of {totalCount}
                </span>
                <span className="inline-flex items-center whitespace-nowrap rounded-full bg-(--chip) px-2.5 py-1 font-medium text-(--ink)">
                    {statLabel}: {statValue}
                </span>
            </div>
        </div>
    );
}

// A collapsible section shell shared by the three per-customer detail
// tables — header (icon, title, row count, running total, collapse chevron)
// stays visible whether open or not, so the total is scannable without
// expanding anything.
function CollapsibleSection({
    icon: Icon,
    title,
    count,
    totalLabel,
    collapsed,
    onToggle,
    children,
}: {
    icon: typeof Banknote;
    title: string;
    count: number;
    totalLabel: string | null;
    collapsed: boolean;
    onToggle: () => void;
    children: React.ReactNode;
}) {
    return (
        <div className="overflow-hidden rounded-xl border border-(--line) bg-white">
            <button
                type="button"
                onClick={onToggle}
                className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
            >
                <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-(--ink)">
                    <Icon className="h-4 w-4 shrink-0 text-(--ink-soft)" aria-hidden="true" />
                    <span className="truncate">{title}</span>
                    <span className="shrink-0 rounded-full bg-(--chip) px-2 py-0.5 text-xs font-medium text-(--ink-soft)">
                        {count}
                    </span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-(--ink-soft)">
                    {totalLabel ? <span className="hidden sm:inline">{totalLabel}</span> : null}
                    {collapsed ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronUp className="h-4 w-4" aria-hidden="true" />}
                </span>
            </button>
            {!collapsed ? <div className="border-t border-(--line) p-3">{children}</div> : null}
        </div>
    );
}

type InvoiceSortKey = "invoiceNumber" | "invoiceDate" | "dueDate" | "paymentTermsName" | "amountResidual" | "daysOverdue";

function InvoicesTable({ rows, currencyCode }: { rows: PaymentFollowupCustomerRow["invoices"]; currencyCode: string }) {
    const [collapsed, setCollapsed] = useState(false);
    const [query, setQuery] = useState("");
    const [sortKey, setSortKey] = useState<InvoiceSortKey>("daysOverdue");
    const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

    function handleSort(key: InvoiceSortKey) {
        if (key === sortKey) {
            setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
        } else {
            setSortKey(key);
            setSortDirection("asc");
        }
    }

    const netResidualAll = useMemo(
        () => rows.reduce((sum, row) => sum + (row.moveType === "out_refund" ? -row.amountResidual : row.amountResidual), 0),
        [rows]
    );

    const filteredRows = useMemo(() => {
        const normalizedQuery = query.trim().toLowerCase();
        if (!normalizedQuery) return rows;
        return rows.filter((row) =>
            [row.invoiceNumber, row.paymentTermsName].some((value) => value.toLowerCase().includes(normalizedQuery))
        );
    }, [rows, query]);

    const sortedRows = useMemo(() => {
        const copy = [...filteredRows];
        copy.sort((a, b) => {
            let result: number;
            switch (sortKey) {
                case "invoiceNumber":
                    result = a.invoiceNumber.localeCompare(b.invoiceNumber);
                    break;
                case "invoiceDate":
                    result = a.invoiceDate.localeCompare(b.invoiceDate);
                    break;
                case "dueDate":
                    result = a.dueDate.localeCompare(b.dueDate);
                    break;
                case "paymentTermsName":
                    result = a.paymentTermsName.localeCompare(b.paymentTermsName);
                    break;
                case "amountResidual":
                    result = a.amountResidual - b.amountResidual;
                    break;
                case "daysOverdue":
                default:
                    result = a.daysOverdue - b.daysOverdue;
                    break;
            }
            return sortDirection === "asc" ? result : -result;
        });
        return copy;
    }, [filteredRows, sortKey, sortDirection]);

    const netResidualFiltered = useMemo(
        () => filteredRows.reduce((sum, row) => sum + (row.moveType === "out_refund" ? -row.amountResidual : row.amountResidual), 0),
        [filteredRows]
    );

    return (
        <CollapsibleSection
            icon={Receipt}
            title="Due Invoices & Credit Notes"
            count={rows.length}
            totalLabel={rows.length > 0 ? `Net ${formatCurrency(netResidualAll, currencyCode)}` : null}
            collapsed={collapsed}
            onToggle={() => setCollapsed((value) => !value)}
        >
            {rows.length === 0 ? (
                <EmptyState message="No open invoices or credit notes." />
            ) : (
                <>
                    <SectionToolbar
                        query={query}
                        onQueryChange={setQuery}
                        placeholder="Search invoice # or terms"
                        filteredCount={filteredRows.length}
                        totalCount={rows.length}
                        statLabel="Net"
                        statValue={formatCurrency(netResidualFiltered, currencyCode)}
                    />
                    {sortedRows.length === 0 ? (
                        <EmptyState message="No invoices match your search." />
                    ) : (
                        <div className="max-h-72 overflow-y-auto rounded-xl border border-(--line)">
                            <table className="min-w-full divide-y divide-(--line) text-sm">
                                <thead className="sticky top-0 z-10 bg-(--chip)">
                                    <tr>
                                        <SortableTh label="Document" sortKey="invoiceNumber" activeKey={sortKey} direction={sortDirection} onSort={handleSort} />
                                        <SortableTh label="Invoice Date" sortKey="invoiceDate" activeKey={sortKey} direction={sortDirection} onSort={handleSort} />
                                        <SortableTh label="Due Date" sortKey="dueDate" activeKey={sortKey} direction={sortDirection} onSort={handleSort} />
                                        <SortableTh label="Terms" sortKey="paymentTermsName" activeKey={sortKey} direction={sortDirection} onSort={handleSort} />
                                        <SortableTh label="Residual" sortKey="amountResidual" activeKey={sortKey} direction={sortDirection} onSort={handleSort} align="right" />
                                        <SortableTh label="Status" sortKey="daysOverdue" activeKey={sortKey} direction={sortDirection} onSort={handleSort} align="right" />
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-(--line) bg-white">
                                    {sortedRows.map((row) => (
                                        <tr key={row.invoiceId}>
                                            <td className="px-3 py-2 align-top">
                                                <p className="font-medium text-(--ink)">{row.invoiceNumber}</p>
                                                <span
                                                    className={`mt-0.5 inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${row.moveType === "out_refund"
                                                        ? "bg-emerald-100 text-emerald-800"
                                                        : row.moveType === "miscEntry"
                                                            ? "bg-sky-100 text-sky-800"
                                                            : "bg-(--chip) text-(--ink-soft)"
                                                        }`}
                                                >
                                                    {row.moveType === "out_refund"
                                                        ? "Credit Note"
                                                        : row.moveType === "miscEntry"
                                                            ? "Journal Entry"
                                                            : "Invoice"}
                                                </span>
                                            </td>
                                            <td className="px-3 py-2 align-top text-(--ink-soft)">{formatDate(row.invoiceDate)}</td>
                                            <td className="px-3 py-2 align-top text-(--ink-soft)">{formatDate(row.dueDate)}</td>
                                            <td className="px-3 py-2 align-top text-(--ink-soft)">{row.paymentTermsName}</td>
                                            <td className="px-3 py-2 text-right align-top font-medium">
                                                {row.moveType === "out_refund" ? "-" : ""}
                                                {formatCurrency(row.amountResidual, row.currencyCode || currencyCode)}
                                            </td>
                                            <td className="px-3 py-2 text-right align-top">
                                                <AgingBadge bucket={row.agingBucket} days={row.daysOverdue} />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </>
            )}
        </CollapsibleSection>
    );
}

type UnappliedSortKey = "date" | "journalName" | "reference" | "amount";

function UnappliedTable({ rows, currencyCode }: { rows: PaymentFollowupCustomerRow["unappliedPayments"]; currencyCode: string }) {
    const [collapsed, setCollapsed] = useState(true);
    const [query, setQuery] = useState("");
    const [sortKey, setSortKey] = useState<UnappliedSortKey>("date");
    const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

    function handleSort(key: UnappliedSortKey) {
        if (key === sortKey) {
            setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
        } else {
            setSortKey(key);
            setSortDirection("asc");
        }
    }

    const totalAmountAll = useMemo(() => rows.reduce((sum, row) => sum + row.amount, 0), [rows]);

    const filteredRows = useMemo(() => {
        const normalizedQuery = query.trim().toLowerCase();
        if (!normalizedQuery) return rows;
        return rows.filter((row) =>
            [row.journalName, row.reference].some((value) => value.toLowerCase().includes(normalizedQuery))
        );
    }, [rows, query]);

    const sortedRows = useMemo(() => {
        const copy = [...filteredRows];
        copy.sort((a, b) => {
            let result: number;
            switch (sortKey) {
                case "date":
                    result = a.date.localeCompare(b.date);
                    break;
                case "journalName":
                    result = a.journalName.localeCompare(b.journalName);
                    break;
                case "reference":
                    result = a.reference.localeCompare(b.reference);
                    break;
                case "amount":
                default:
                    result = a.amount - b.amount;
                    break;
            }
            return sortDirection === "asc" ? result : -result;
        });
        return copy;
    }, [filteredRows, sortKey, sortDirection]);

    const totalAmountFiltered = useMemo(() => filteredRows.reduce((sum, row) => sum + row.amount, 0), [filteredRows]);

    return (
        <CollapsibleSection
            icon={Banknote}
            title="Unapplied Accounting Entries"
            count={rows.length}
            totalLabel={rows.length > 0 ? formatCurrency(totalAmountAll, currencyCode) : null}
            collapsed={collapsed}
            onToggle={() => setCollapsed((value) => !value)}
        >
            {rows.length === 0 ? (
                <EmptyState message="No unapplied payments — every receipt on file is linked to an invoice." />
            ) : (
                <>
                    <SectionToolbar
                        query={query}
                        onQueryChange={setQuery}
                        placeholder="Search journal or reference"
                        filteredCount={filteredRows.length}
                        totalCount={rows.length}
                        statLabel="Total"
                        statValue={formatCurrency(totalAmountFiltered, currencyCode)}
                    />
                    {sortedRows.length === 0 ? (
                        <EmptyState message="No entries match your search." />
                    ) : (
                        <div className="max-h-72 overflow-y-auto rounded-xl border border-(--line)">
                            <table className="min-w-full divide-y divide-(--line) text-sm">
                                <thead className="sticky top-0 z-10 bg-(--chip)">
                                    <tr>
                                        <SortableTh label="Date" sortKey="date" activeKey={sortKey} direction={sortDirection} onSort={handleSort} />
                                        <SortableTh label="Journal" sortKey="journalName" activeKey={sortKey} direction={sortDirection} onSort={handleSort} />
                                        <SortableTh label="Reference" sortKey="reference" activeKey={sortKey} direction={sortDirection} onSort={handleSort} />
                                        <SortableTh label="Amount" sortKey="amount" activeKey={sortKey} direction={sortDirection} onSort={handleSort} align="right" />
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-(--line) bg-white">
                                    {sortedRows.map((row) => (
                                        <tr key={row.id}>
                                            <td className="px-3 py-2 text-(--ink-soft)">{formatDate(row.date)}</td>
                                            <td className="px-3 py-2">{row.journalName}</td>
                                            <td className="px-3 py-2 text-(--ink-soft)">{row.reference}</td>
                                            <td className="px-3 py-2 text-right font-medium text-emerald-700">
                                                {formatCurrency(row.amount, row.currencyCode)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </>
            )}
        </CollapsibleSection>
    );
}

type ChequeSortKey = "number" | "date" | "bankName" | "state" | "amount";

function ChequesTable({ rows, currencyCode }: { rows: PaymentFollowupCustomerRow["cheques"]; currencyCode: string }) {
    const [collapsed, setCollapsed] = useState(true);
    const [query, setQuery] = useState("");
    const [sortKey, setSortKey] = useState<ChequeSortKey>("date");
    const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

    function handleSort(key: ChequeSortKey) {
        if (key === sortKey) {
            setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
        } else {
            setSortKey(key);
            setSortDirection("asc");
        }
    }

    const pendingAmountAll = useMemo(
        () => rows.filter((row) => row.isPending).reduce((sum, row) => sum + row.amount, 0),
        [rows]
    );

    const depositedAmountAll = useMemo(
        () => rows.filter((row) => row.isDeposited).reduce((sum, row) => sum + row.amount, 0),
        [rows]
    );

    const filteredRows = useMemo(() => {
        const normalizedQuery = query.trim().toLowerCase();
        if (!normalizedQuery) return rows;
        return rows.filter((row) =>
            [row.number, row.bankName, row.state].some((value) => value.toLowerCase().includes(normalizedQuery))
        );
    }, [rows, query]);

    const sortedRows = useMemo(() => {
        const copy = [...filteredRows];
        copy.sort((a, b) => {
            let result: number;
            switch (sortKey) {
                case "number":
                    result = a.number.localeCompare(b.number);
                    break;
                case "date":
                    result = a.date.localeCompare(b.date);
                    break;
                case "bankName":
                    result = a.bankName.localeCompare(b.bankName);
                    break;
                case "state":
                    result = a.state.localeCompare(b.state);
                    break;
                case "amount":
                default:
                    result = a.amount - b.amount;
                    break;
            }
            return sortDirection === "asc" ? result : -result;
        });
        return copy;
    }, [filteredRows, sortKey, sortDirection]);

    const pendingAmountFiltered = useMemo(
        () => filteredRows.filter((row) => row.isPending).reduce((sum, row) => sum + row.amount, 0),
        [filteredRows]
    );

    return (
        <CollapsibleSection
            icon={Landmark}
            title="Post-Dated Cheques (PDC)"
            count={rows.length}
            totalLabel={
                rows.length > 0
                    ? `Pending ${formatCurrency(pendingAmountAll, currencyCode)} · Deposit ${formatCurrency(depositedAmountAll, currencyCode)}`
                    : null
            }
            collapsed={collapsed}
            onToggle={() => setCollapsed((value) => !value)}
        >
            {rows.length === 0 ? (
                <EmptyState message="No post-dated cheques on file for this customer." />
            ) : (
                <>
                    <SectionToolbar
                        query={query}
                        onQueryChange={setQuery}
                        placeholder="Search cheque #, bank, or state"
                        filteredCount={filteredRows.length}
                        totalCount={rows.length}
                        statLabel="Pending"
                        statValue={formatCurrency(pendingAmountFiltered, currencyCode)}
                    />
                    {sortedRows.length === 0 ? (
                        <EmptyState message="No cheques match your search." />
                    ) : (
                        <div className="max-h-72 overflow-y-auto rounded-xl border border-(--line)">
                            <table className="min-w-full divide-y divide-(--line) text-sm">
                                <thead className="sticky top-0 z-10 bg-(--chip)">
                                    <tr>
                                        <SortableTh label="Cheque #" sortKey="number" activeKey={sortKey} direction={sortDirection} onSort={handleSort} />
                                        <SortableTh label="Date" sortKey="date" activeKey={sortKey} direction={sortDirection} onSort={handleSort} />
                                        <SortableTh label="Bank" sortKey="bankName" activeKey={sortKey} direction={sortDirection} onSort={handleSort} />
                                        <SortableTh label="State" sortKey="state" activeKey={sortKey} direction={sortDirection} onSort={handleSort} />
                                        <SortableTh label="Amount" sortKey="amount" activeKey={sortKey} direction={sortDirection} onSort={handleSort} align="right" />
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-(--line) bg-white">
                                    {sortedRows.map((row) => (
                                        <tr key={row.id}>
                                            <td className="px-3 py-2 font-medium">{row.number}</td>
                                            <td className="px-3 py-2 text-(--ink-soft)">{formatDate(row.date)}</td>
                                            <td className="px-3 py-2 text-(--ink-soft)">{row.bankName || "-"}</td>
                                            <td className="px-3 py-2">
                                                <span
                                                    className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${chequeStateBadgeClasses(row.state, row.isDeposited)}`}
                                                >
                                                    {row.state}
                                                </span>
                                            </td>
                                            <td className="px-3 py-2 text-right font-medium">{formatCurrency(row.amount, row.currencyCode)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </>
            )}
        </CollapsibleSection>
    );
}

type AgingSortKey = PaymentFollowupAgingBucket | "customerName" | "total";

// The Odoo-style Aged Receivable matrix: one row per customer, one column
// per aging bucket, a Total column, and a totals footer — the report's main
// at-a-glance view, decluttering the customer cards below (which are for
// drilling into the underlying invoices/entries/cheques, not for scanning).
function AgingMatrix({
    customers,
    totals,
    currencyCode,
    showCustomerColumn,
    agingSystem,
}: {
    customers: PaymentFollowupCustomerRow[];
    totals: PaymentFollowupReport["totals"];
    currencyCode: string;
    showCustomerColumn: boolean;
    agingSystem: AgingSystem;
}) {
    const columns = agingColumnsFor(agingSystem);
    const [sortKey, setSortKey] = useState<AgingSortKey>("total");
    const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

    function handleSort(key: AgingSortKey) {
        if (key === sortKey) {
            setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
        } else {
            setSortKey(key);
            setSortDirection(key === "customerName" ? "asc" : "desc");
        }
    }

    const sortedCustomers = useMemo(() => {
        const copy = [...customers];
        copy.sort((a, b) => {
            const result =
                sortKey === "customerName"
                    ? a.customerName.localeCompare(b.customerName)
                    : sortKey === "total"
                        ? a.totalInvoiceDue - b.totalInvoiceDue
                        : a.agingBuckets[sortKey] - b.agingBuckets[sortKey];
            return sortDirection === "asc" ? result : -result;
        });
        return copy;
    }, [customers, sortKey, sortDirection]);

    return (
        <div className="overflow-hidden rounded-2xl border border-(--line) bg-(--card)">
            <div className="max-h-[28rem] overflow-auto">
                <table className="min-w-full divide-y divide-(--line) text-sm">
                    <thead className="sticky top-0 z-10 bg-(--chip)">
                        <tr>
                            {showCustomerColumn ? (
                                <SortableTh label="Customer" sortKey="customerName" activeKey={sortKey} direction={sortDirection} onSort={handleSort} />
                            ) : null}
                            {columns.map((column) => (
                                <SortableTh
                                    key={column.key}
                                    label={column.label}
                                    sortKey={column.key}
                                    activeKey={sortKey}
                                    direction={sortDirection}
                                    onSort={handleSort}
                                    align="right"
                                />
                            ))}
                            <SortableTh label="Total" sortKey="total" activeKey={sortKey} direction={sortDirection} onSort={handleSort} align="right" />
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-(--line) bg-white">
                        {sortedCustomers.map((row) => (
                            <tr key={row.customerId}>
                                {showCustomerColumn ? (
                                    <td className="max-w-48 truncate px-3 py-2 font-medium text-(--ink)">{row.customerName}</td>
                                ) : null}
                                {columns.map((column) => {
                                    const amount = row.agingBuckets[column.key];
                                    return (
                                        <td
                                            key={column.key}
                                            className={`px-3 py-2 text-right ${amount !== 0 ? column.tint : "text-(--ink-soft)/40"}`}
                                        >
                                            {amount !== 0 ? formatCurrency(amount, row.currencyCode || currencyCode) : "-"}
                                        </td>
                                    );
                                })}
                                <td className="px-3 py-2 text-right font-semibold text-(--ink)">
                                    {formatCurrency(row.totalInvoiceDue, row.currencyCode || currencyCode)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot className="border-t-2 border-(--line) bg-(--chip)/70 font-semibold text-(--ink)">
                        <tr>
                            {showCustomerColumn ? <td className="px-3 py-2.5">Total</td> : null}
                            {columns.map((column) => (
                                <td key={column.key} className="px-3 py-2.5 text-right">
                                    {formatCurrency(totals.agingBuckets[column.key], currencyCode)}
                                </td>
                            ))}
                            <td className="px-3 py-2.5 text-right">{formatCurrency(totals.totalInvoiceDue, currencyCode)}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </div>
    );
}

function CustomerCard({
    row,
    expanded,
    onToggle,
    currencyCode,
    agingSystem,
}: {
    row: PaymentFollowupCustomerRow;
    expanded: boolean;
    onToggle: () => void;
    currencyCode: string;
    agingSystem: AgingSystem;
}) {
    const meta = agingMetaFor(row.agingBucket, agingSystem);

    return (
        <div className="overflow-hidden rounded-2xl border border-(--line) bg-(--card)">
            <div className={`h-1 w-full ${meta.accent}`} aria-hidden="true" />
            <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-start gap-3 text-left">
                    <span className="mt-0.5 shrink-0 text-(--ink-soft)">
                        {expanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                    </span>
                    <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                            <span className="truncate font-display text-lg text-(--ink)">{row.customerName}</span>
                            <AgingBadge bucket={row.agingBucket} days={row.maxDaysOverdue} system={agingSystem} />
                        </span>
                        <span className="mt-1 block text-xs text-(--ink-soft)">
                            {row.salespersonName} · {row.phone || "no phone"} · {row.email || "no email"}
                        </span>
                    </span>
                </button>

                <div className="flex shrink-0 flex-wrap items-center gap-4 sm:justify-end">
                    <div className="text-right">
                        <p className="text-[11px] uppercase tracking-wide text-(--ink-soft)">Net Due</p>
                        <p className={`font-display text-xl ${row.netDue > 0 ? "text-rose-700" : "text-emerald-700"}`}>
                            {formatCurrency(row.netDue, row.currencyCode || currencyCode)}
                        </p>
                        {row.totalPayableDue !== 0 ? (
                            <p className="text-[11px] text-(--ink-soft)">
                                incl. -{formatCurrency(row.totalPayableDue, row.currencyCode || currencyCode)} payable
                            </p>
                        ) : null}
                    </div>
                    <Link
                        href={`/customers/${row.customerId}`}
                        className="inline-flex whitespace-nowrap items-center justify-center rounded-full border border-(--line) px-3 py-1.5 text-xs font-medium text-(--ink) hover:bg-(--chip)"
                    >
                        Customer Report
                    </Link>
                    <WhatsAppButton row={row} />
                </div>
            </div>

            {expanded ? (
                <div className="space-y-2 border-t border-(--line) bg-(--bg)/40 p-3">
                    <InvoicesTable rows={row.invoices} currencyCode={row.currencyCode || currencyCode} />
                    <UnappliedTable rows={row.unappliedPayments} currencyCode={row.currencyCode || currencyCode} />
                    <ChequesTable rows={row.cheques} currencyCode={row.currencyCode || currencyCode} />
                </div>
            ) : null}
        </div>
    );
}

export default function PaymentFollowupPage() {
    const { user } = useAuth();
    const hasLoadedOptionsRef = useRef(false);

    const [mode, setMode] = useState<Mode>("salesperson");

    const [salespeople, setSalespeople] = useState<OdooSalesperson[]>([]);
    const [customers, setCustomers] = useState<OdooCustomerOption[]>([]);
    const [optionsLoading, setOptionsLoading] = useState(true);
    const [optionsError, setOptionsError] = useState<string | null>(null);

    const [asOfDate, setAsOfDate] = useState(todayISO);
    const [dateBasis, setDateBasis] = useState<"due" | "invoice">("due");
    const [agingSystem, setAgingSystem] = useState<AgingSystem>("day");

    const [selectedSalespersonId, setSelectedSalespersonId] = useState("");
    const [selectedCustomerId, setSelectedCustomerId] = useState("");

    const [report, setReport] = useState<PaymentFollowupReport | null>(null);
    const [reportLoading, setReportLoading] = useState(false);
    const [reportError, setReportError] = useState<string | null>(null);
    const [exporting, setExporting] = useState(false);

    const [search, setSearch] = useState("");
    const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

    useEffect(() => {
        async function loadOptions() {
            if (!user) {
                setOptionsLoading(false);
                return;
            }

            if (hasLoadedOptionsRef.current) {
                setOptionsLoading(false);
                return;
            }

            hasLoadedOptionsRef.current = true;

            try {
                const [salespeopleData, customersData] = await Promise.all([getSalespeople(), getCustomers()]);
                setSalespeople(salespeopleData.salespeople);
                setCustomers(customersData.customers);
                if (salespeopleData.salespeople.length > 0) {
                    setSelectedSalespersonId(String(salespeopleData.salespeople[0].id));
                }
                if (customersData.customers.length > 0) {
                    setSelectedCustomerId(String(customersData.customers[0].id));
                }
            } catch (error) {
                setOptionsError(error instanceof Error ? error.message : "Failed to load salespeople/customers.");
            } finally {
                setOptionsLoading(false);
            }
        }

        void loadOptions();
    }, [user]);

    function switchMode(nextMode: Mode) {
        if (nextMode === mode) return;
        setMode(nextMode);
        setReport(null);
        setReportError(null);
        setSearch("");
        setExpandedIds(new Set());
    }

    async function handleSubmit(event: FormEvent) {
        event.preventDefault();
        setReportLoading(true);
        setReportError(null);
        setReport(null);
        setSearch("");
        setExpandedIds(new Set());

        try {
            const data =
                mode === "salesperson"
                    ? await getPaymentFollowupBySalesperson({
                        salespersonId: Number(selectedSalespersonId),
                        asOfDate,
                        dateBasis,
                        agingSystem,
                    })
                    : await getPaymentFollowupByCustomer({
                        customerId: Number(selectedCustomerId),
                        asOfDate,
                        dateBasis,
                        agingSystem,
                    });

            setReport(data);
            if (mode === "customer" && data.customers.length > 0) {
                setExpandedIds(new Set([data.customers[0].customerId]));
            }
        } catch (error) {
            setReportError(error instanceof Error ? error.message : "Failed to generate payment followup report.");
        } finally {
            setReportLoading(false);
        }
    }

    function toggleExpanded(customerId: number) {
        setExpandedIds((previous) => {
            const next = new Set(previous);
            if (next.has(customerId)) {
                next.delete(customerId);
            } else {
                next.add(customerId);
            }
            return next;
        });
    }

    const filteredCustomers = useMemo(() => {
        if (!report) return [];
        const query = search.trim().toLowerCase();
        if (!query) return report.customers;
        return report.customers.filter((row) =>
            [row.customerName, row.salespersonName, row.email, row.phone, row.city].some((value) =>
                value.toLowerCase().includes(query)
            )
        );
    }, [report, search]);

    async function exportReport() {
        if (!report || filteredCustomers.length === 0) return;

        setExporting(true);
        setReportError(null);

        try {
            const XLSX = await import("xlsx");
            const exportRows: Array<Record<string, string | number>> = [];

            for (const customer of filteredCustomers) {
                for (const invoice of customer.invoices) {
                    exportRows.push({
                        Customer: customer.customerName,
                        Salesperson: customer.salespersonName,
                        Phone: customer.phone,
                        Email: customer.email,
                        Document: invoice.invoiceNumber,
                        Type: invoice.moveType === "out_refund" ? "Credit Note" : invoice.moveType === "miscEntry" ? "Journal Entry" : "Invoice",
                        "Invoice Date": invoice.invoiceDate,
                        "Due Date": invoice.dueDate,
                        "Payment Terms": invoice.paymentTermsName,
                        "Days Overdue": invoice.daysOverdue,
                        Residual: invoice.amountResidual,
                        Currency: invoice.currencyCode,
                    });
                }
                if (customer.invoices.length === 0) {
                    exportRows.push({
                        Customer: customer.customerName,
                        Salesperson: customer.salespersonName,
                        Phone: customer.phone,
                        Email: customer.email,
                        Document: "-",
                        Type: "-",
                        "Invoice Date": "-",
                        "Due Date": "-",
                        "Payment Terms": "-",
                        "Days Overdue": 0,
                        Residual: 0,
                        Currency: customer.currencyCode,
                    });
                }
            }

            const worksheet = XLSX.utils.json_to_sheet(exportRows);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, "Payment Followup");
            XLSX.writeFile(workbook, `payment-followup-${sanitizeFileName(mode === "salesperson" ? report.salesperson?.name ?? "salesperson" : filteredCustomers[0]?.customerName ?? "customer")}-${report.asOfDate}.xlsx`);
        } catch (error) {
            setReportError(error instanceof Error ? error.message : "Failed to export Excel file.");
        } finally {
            setExporting(false);
        }
    }

    return (
        <section>
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="font-display text-3xl">Payment Followup</h1>
                    <p className="mt-1 text-sm text-(--ink-soft)">
                        Aged receivables, unapplied receipts, and pending PDC cheques — per salesperson or per customer.
                    </p>
                </div>
                <HandCoins className="h-8 w-8 text-(--brand)" aria-hidden="true" />
            </div>

            <div className="mt-6 rounded-2xl border border-(--line) bg-(--card) p-5">
                <div className="mb-4 inline-flex rounded-full border border-(--line) bg-(--chip) p-1 text-sm">
                    <button
                        type="button"
                        onClick={() => switchMode("salesperson")}
                        className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 font-medium transition ${mode === "salesperson" ? "bg-(--brand) text-white shadow" : "text-(--ink-soft)"
                            }`}
                    >
                        <Users className="h-3.5 w-3.5" aria-hidden="true" /> By Salesperson
                    </button>
                    <button
                        type="button"
                        onClick={() => switchMode("customer")}
                        className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 font-medium transition ${mode === "customer" ? "bg-(--brand) text-white shadow" : "text-(--ink-soft)"
                            }`}
                    >
                        <Receipt className="h-3.5 w-3.5" aria-hidden="true" /> By Customer
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {mode === "salesperson" ? (
                        <label className="block">
                            <span className="mb-2 block text-sm font-medium">Salesperson</span>
                            <Select2
                                value={selectedSalespersonId}
                                onChange={setSelectedSalespersonId}
                                loading={optionsLoading}
                                loadingText="Loading salespeople..."
                                emptyText="No salespeople found"
                                disabled={Boolean(optionsError)}
                                options={salespeople.map((salesperson) => ({
                                    value: String(salesperson.id),
                                    label: salesperson.name,
                                    description: salesperson.email || undefined,
                                }))}
                            />
                        </label>
                    ) : (
                        <label className="block">
                            <span className="mb-2 block text-sm font-medium">Customer</span>
                            <Select2
                                value={selectedCustomerId}
                                onChange={setSelectedCustomerId}
                                loading={optionsLoading}
                                loadingText="Loading customers..."
                                emptyText="No customers found"
                                disabled={Boolean(optionsError)}
                                options={customers.map((customer) => ({
                                    value: String(customer.id),
                                    label: customer.name,
                                    description: customer.salespersonName || undefined,
                                }))}
                            />
                        </label>
                    )}

                    <label className="block">
                        <span className="mb-2 block text-sm font-medium">As of Date</span>
                        <input
                            type="date"
                            value={asOfDate}
                            onChange={(event) => setAsOfDate(event.target.value)}
                            className="w-full rounded-xl border border-(--line) bg-white px-4 py-2.5"
                            required
                        />
                    </label>

                    <div className="block">
                        <span className="mb-2 block text-sm font-medium">Age By</span>
                        <div className="inline-flex w-full rounded-xl border border-(--line) bg-white p-1">
                            <button
                                type="button"
                                onClick={() => setDateBasis("due")}
                                className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition ${dateBasis === "due" ? "bg-(--brand) text-white shadow" : "text-(--ink-soft)"
                                    }`}
                            >
                                Due Date
                            </button>
                            <button
                                type="button"
                                onClick={() => setDateBasis("invoice")}
                                className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition ${dateBasis === "invoice" ? "bg-(--brand) text-white shadow" : "text-(--ink-soft)"
                                    }`}
                            >
                                Invoice Date
                            </button>
                        </div>
                    </div>

                    <div className="block">
                        <span className="mb-2 block text-sm font-medium">Aging System</span>
                        <div className="inline-flex w-full rounded-xl border border-(--line) bg-white p-1">
                            <button
                                type="button"
                                onClick={() => setAgingSystem("day")}
                                className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition ${agingSystem === "day" ? "bg-(--brand) text-white shadow" : "text-(--ink-soft)"
                                    }`}
                            >
                                Day
                            </button>
                            <button
                                type="button"
                                onClick={() => setAgingSystem("month")}
                                className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition ${agingSystem === "month" ? "bg-(--brand) text-white shadow" : "text-(--ink-soft)"
                                    }`}
                            >
                                Month
                            </button>
                        </div>
                    </div>
                    </div>

                    <div className="flex justify-end">
                        <button
                            type="submit"
                            disabled={
                                reportLoading ||
                                optionsLoading ||
                                !asOfDate ||
                                (mode === "salesperson" ? !selectedSalespersonId : !selectedCustomerId)
                            }
                            className="w-full rounded-xl bg-(--brand) px-5 py-2.5 font-medium text-white disabled:cursor-not-allowed disabled:opacity-70 sm:w-auto"
                        >
                            {reportLoading ? "Checking..." : "Check Payments"}
                        </button>
                    </div>
                </form>

                {optionsError ? <p className="mt-3 text-sm text-red-600">{optionsError}</p> : null}
                {reportError ? <p className="mt-3 text-sm text-red-600">{reportError}</p> : null}
            </div>

            {report ? (
                <div className="mt-6 space-y-6">
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                        <StatCard
                            label="Open Invoices Due"
                            value={formatCurrency(report.totals.totalInvoiceDue, report.currencyCode)}
                            tone="blue"
                            icon={Receipt}
                        />
                        <StatCard
                            label="Unapplied Credits"
                            value={formatCurrency(report.totals.totalUnapplied, report.currencyCode)}
                            tone="green"
                            icon={Banknote}
                        />
                        <StatCard
                            label="Pending PDC Cheques"
                            value={formatCurrency(report.totals.totalPdcPending, report.currencyCode)}
                            tone="purple"
                            icon={Landmark}
                            hint={`Total Deposit: ${formatCurrency(report.totals.totalPdcDeposited, report.currencyCode)}`}
                        />
                        <StatCard
                            label="Payables"
                            value={formatCurrency(report.totals.totalPayableDue, report.currencyCode)}
                            tone="amber"
                            icon={Building2}
                        />
                        <StatCard
                            label="Net Due"
                            value={formatCurrency(report.totals.netDue, report.currencyCode)}
                            tone={report.totals.netDue > 0 ? "red" : "green"}
                            icon={AlertTriangle}
                        />
                    </div>

                    {!report.pdcModuleDetected ? (
                        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
                            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                            <div className="text-sm">
                                <p>
                                    Couldn&apos;t detect a PDC (post-dated cheque) module in this Odoo database, so cheque data is not shown.
                                </p>
                                {report.pdcDebug ? (
                                    <div className="mt-2 space-y-1.5 text-xs">
                                        {report.pdcDebug.error ? (
                                            <p>
                                                <span className="font-semibold">Error while checking:</span> {report.pdcDebug.error}
                                            </p>
                                        ) : null}
                                        <p>
                                            <span className="font-semibold">Payment methods found ({report.pdcDebug.paymentMethods.length}):</span>{" "}
                                            {report.pdcDebug.paymentMethods.length > 0
                                                ? report.pdcDebug.paymentMethods
                                                    .map((method) => `${method.name} (code: ${method.code || "-"}, ${method.paymentType})`)
                                                    .join(", ")
                                                : "none"}
                                        </p>
                                        {report.pdcDebug.relationProbe ? (
                                            <p>
                                                <span className="font-semibold">Following res.partner.{report.pdcDebug.relationProbe.sourceField}:</span>{" "}
                                                points to {report.pdcDebug.relationProbe.targetModel || "(no target model)"}
                                                {report.pdcDebug.relationProbe.targetModelBlocked
                                                    ? " — blocked (a shared ledger model, not a dedicated cheque model)"
                                                    : report.pdcDebug.relationProbe.targetModelTransient
                                                        ? " — wizard, skipped"
                                                        : report.pdcDebug.relationProbe.resolved
                                                            ? " — resolved"
                                                            : report.pdcDebug.relationProbe.targetPartnerField
                                                                ? ` — found partner field "${report.pdcDebug.relationProbe.targetPartnerField}" but no usable amount/date field`
                                                                : " — no field on it points back to a partner"}
                                                {report.pdcDebug.relationProbe.targetModelFields.length > 0 ? (
                                                    <>
                                                        . Its fields: {report.pdcDebug.relationProbe.targetModelFields.join(", ")}
                                                    </>
                                                ) : null}
                                            </p>
                                        ) : null}
                                        <p>
                                            <span className="font-semibold">Cheque/PDC-named models found ({report.pdcDebug.candidateModels.length}):</span>{" "}
                                            {report.pdcDebug.candidateModels.length > 0
                                                ? report.pdcDebug.candidateModels
                                                    .map((model) => `${model.name} (${model.model})${model.transient ? " — wizard, skipped" : ""}`)
                                                    .join(", ")
                                                : "none"}
                                        </p>
                                        <p>
                                            <span className="font-semibold">
                                                Fields named like a cheque/PDC field, anywhere in the database ({report.pdcDebug.fieldMatches.length}):
                                            </span>{" "}
                                            {report.pdcDebug.fieldMatches.length > 0
                                                ? report.pdcDebug.fieldMatches
                                                    .map(
                                                        (field) =>
                                                            `${field.modelLabel || field.model} (${field.model}).${field.field}${field.transient ? " — wizard, skipped" : ""}`
                                                    )
                                                    .join(", ")
                                                : "none"}
                                        </p>
                                        <p>
                                            Share this list with us — one of these is almost certainly where the PDC feature stores its cheques,
                                            we just need to know which model/field your addon actually uses.
                                        </p>
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    ) : null}

                    {report.customers.length > 0 ? (
                        <div>
                            <div className="mb-2 flex items-center justify-between">
                                <h2 className="font-display text-lg">Aged Receivables</h2>
                                <p className="flex items-center gap-1.5 text-xs text-(--ink-soft)">
                                    <Calendar className="h-3.5 w-3.5" aria-hidden="true" /> Aged by {report.dateBasis === "invoice" ? "Invoice Date" : "Due Date"}, by {report.agingSystem === "month" ? "Month" : "Day"} · As of {report.asOfDate}
                                </p>
                            </div>
                            <AgingMatrix
                                customers={report.customers}
                                totals={report.totals}
                                currencyCode={report.currencyCode}
                                showCustomerColumn={mode === "salesperson"}
                                agingSystem={report.agingSystem}
                            />
                        </div>
                    ) : null}

                    <div className="flex flex-col gap-3 rounded-2xl border border-(--line) bg-(--card) p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <p className="text-sm text-(--ink-soft)">
                                {mode === "salesperson"
                                    ? `Customers assigned to ${report.salesperson?.name ?? "-"}`
                                    : "Customer"}
                            </p>
                            <p className="mt-0.5 text-xs text-(--ink-soft)">
                                {filteredCustomers.length} of {report.customers.length} customer{report.customers.length === 1 ? "" : "s"} with an open balance
                            </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                            {mode === "salesperson" ? (
                                <input
                                    type="search"
                                    value={search}
                                    onChange={(event) => setSearch(event.target.value)}
                                    placeholder="Search customers"
                                    className="w-full rounded-xl border border-(--line) bg-white px-4 py-2 text-sm sm:w-64"
                                />
                            ) : null}
                            <button
                                type="button"
                                onClick={() => void exportReport()}
                                disabled={exporting || filteredCustomers.length === 0}
                                className="inline-flex items-center justify-center gap-2 rounded-xl border border-(--line) bg-white px-4 py-2 text-sm font-medium text-(--ink) disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                <Download className="h-4 w-4" aria-hidden="true" />
                                {exporting ? "Exporting..." : "Export Excel"}
                            </button>
                        </div>
                    </div>

                    {filteredCustomers.length === 0 ? (
                        <EmptyState
                            message={
                                report.customers.length === 0
                                    ? "No outstanding balances — everything is settled."
                                    : "No customers match your search."
                            }
                        />
                    ) : (
                        <div className="space-y-3">
                            {filteredCustomers.map((row) => (
                                <CustomerCard
                                    key={row.customerId}
                                    row={row}
                                    expanded={expandedIds.has(row.customerId)}
                                    onToggle={() => toggleExpanded(row.customerId)}
                                    currencyCode={report.currencyCode}
                                    agingSystem={report.agingSystem}
                                />
                            ))}
                        </div>
                    )}
                </div>
            ) : null}
        </section>
    );
}
