"use client";

import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { getMyDocuments, getMyOrderDetails, type MyDocumentRow, type MyOrderDetails } from "@/lib/client-odoo";

const PAGE_SIZE = 30;

type StatusFilter = "all" | "quotation" | "confirmed" | "cancelled";

const STATUS_FILTERS: Array<{ key: StatusFilter; label: string }> = [
    { key: "all", label: "All" },
    { key: "quotation", label: "Quotations" },
    { key: "confirmed", label: "Confirmed orders" },
    { key: "cancelled", label: "Cancelled" },
];

// Colour per Odoo state: quotations amber/blue, confirmed green, locked slate, cancelled red.
const STATE_STYLES: Record<string, { badge: string; bar: string }> = {
    draft: { badge: "bg-amber-100 text-amber-800", bar: "border-l-amber-400" },
    sent: { badge: "bg-sky-100 text-sky-800", bar: "border-l-sky-400" },
    sale: { badge: "bg-emerald-100 text-emerald-800", bar: "border-l-emerald-500" },
    done: { badge: "bg-slate-200 text-slate-700", bar: "border-l-slate-400" },
    cancel: { badge: "bg-red-100 text-red-700", bar: "border-l-red-400" },
    posted: { badge: "bg-(--chip) text-(--ink)", bar: "border-l-transparent" },
};

function formatDate(value: string) {
    if (!value) return "-";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function formatAmount(value: number, currency: string) {
    return `${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${currency ? ` ${currency}` : ""}`;
}

/** The signed-in user's own sales orders or invoices, as a searchable, paged list. */
export function MyDocuments({ kind }: { kind: "orders" | "quotations" | "invoices" }) {
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);
    const [status, setStatus] = useState<StatusFilter>("all");
    const [openOrder, setOpenOrder] = useState<{ id: number; name: string } | null>(null);
    const [rows, setRows] = useState<MyDocumentRow[]>([]);
    const [totalCount, setTotalCount] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const isOrders = kind !== "invoices";
    const noun = kind === "quotations" ? "quotation" : kind === "orders" ? "order" : "invoice";

    useEffect(() => {
        let stale = false;
        const timer = window.setTimeout(() => {
            setLoading(true);
            setError(null);
            getMyDocuments({ kind, status, search: search.trim(), limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE })
                .then((data) => {
                    if (stale) return;
                    setRows(data.rows);
                    setTotalCount(data.totalCount);
                })
                .catch((loadError) => {
                    if (!stale) setError(loadError instanceof Error ? loadError.message : "Failed to load.");
                })
                .finally(() => {
                    if (!stale) setLoading(false);
                });
        }, search ? 250 : 0);
        return () => {
            stale = true;
            window.clearTimeout(timer);
        };
    }, [kind, status, search, page]);

    const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

    return (
        <div className="mt-6 rounded-2xl border border-(--line) bg-(--card) p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 className="font-display text-xl">{isOrders ? "My Sales Orders" : "My Invoices"}</h2>
                    <p className="mt-1 text-sm text-(--ink-soft)">
                        {isOrders ? "Your quotations and sales orders, newest first. Colours show the status." : "Posted invoices and credit notes where you are the salesperson, newest first."}
                    </p>
                </div>
                <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--ink-soft)" aria-hidden="true" />
                    <input
                        value={search}
                        onChange={(event) => {
                            setSearch(event.target.value);
                            setPage(1);
                        }}
                        placeholder={`${noun[0].toUpperCase()}${noun.slice(1)} number or customer`}
                        className="w-64 rounded-xl border border-(--line) bg-white py-2 pl-9 pr-3 text-sm"
                    />
                </div>
            </div>

            {isOrders ? (
                <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Status">
                    {STATUS_FILTERS.map((item) => (
                        <button
                            key={item.key}
                            type="button"
                            onClick={() => {
                                setStatus(item.key);
                                setPage(1);
                            }}
                            aria-pressed={status === item.key}
                            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                                status === item.key ? "border-(--brand) bg-[rgba(229,26,39,0.08)] text-(--brand)" : "border-(--line) bg-white text-(--ink-soft) hover:bg-(--chip)"
                            }`}
                        >
                            {item.label}
                        </button>
                    ))}
                </div>
            ) : null}

            {error ? <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

            <div className={`mt-4 overflow-x-auto rounded-xl border border-(--line) transition-opacity ${loading ? "opacity-60" : ""}`}>
                <table className="min-w-full border-collapse text-left text-sm">
                    <thead className="bg-(--chip) text-xs text-(--ink-soft)">
                        <tr>
                            <th className="px-3 py-2.5 font-medium">{noun[0].toUpperCase() + noun.slice(1)}</th>
                            <th className="px-3 py-2.5 font-medium">Customer</th>
                            <th className="px-3 py-2.5 font-medium">Date</th>
                            {isOrders ? null : <th className="px-3 py-2.5 font-medium">Due</th>}
                            <th className="px-3 py-2.5 font-medium">Status</th>
                            <th className="px-3 py-2.5 text-right font-medium">Total</th>
                            {isOrders ? null : <th className="px-3 py-2.5 text-right font-medium">Due amount</th>}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row) => (
                            <tr key={row.id} className={`border-t border-l-4 border-(--line)/70 ${(STATE_STYLES[row.stateCode] ?? STATE_STYLES.posted).bar}`}>
                                <td className="whitespace-nowrap px-3 py-2.5 font-semibold">
                                    {isOrders ? (
                                        <button
                                            type="button"
                                            onClick={() => setOpenOrder({ id: row.id, name: row.name })}
                                            className="text-(--brand) underline-offset-2 hover:underline"
                                            title="Open the details"
                                        >
                                            {row.name}
                                        </button>
                                    ) : (
                                        row.name
                                    )}
                                    {row.isCredit ? <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">Credit note</span> : null}
                                </td>
                                <td className="px-3 py-2.5">{row.customer || "-"}</td>
                                <td className="whitespace-nowrap px-3 py-2.5">{formatDate(row.date)}</td>
                                {isOrders ? null : <td className="whitespace-nowrap px-3 py-2.5">{formatDate(row.dueDate)}</td>}
                                <td className="whitespace-nowrap px-3 py-2.5">
                                    <span
                                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                                            isOrders
                                                ? (STATE_STYLES[row.stateCode] ?? STATE_STYLES.posted).badge
                                                : row.paymentState === "Paid" || row.paymentState === "In payment"
                                                  ? "bg-emerald-100 text-emerald-800"
                                                  : row.paymentState === "Partially paid"
                                                    ? "bg-amber-100 text-amber-800"
                                                    : "bg-red-100 text-red-700"
                                        }`}
                                    >
                                        {isOrders ? row.state : row.paymentState || row.state}
                                    </span>
                                </td>
                                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{formatAmount(row.amountTotal, row.currencyCode)}</td>
                                {isOrders ? null : (
                                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{formatAmount(row.amountResidual ?? 0, row.currencyCode)}</td>
                                )}
                            </tr>
                        ))}
                        {!loading && rows.length === 0 ? (
                            <tr>
                                <td colSpan={isOrders ? 5 : 7} className="px-3 py-8 text-center text-(--ink-soft)">
                                    {search ? "Nothing matches your search." : `You have no ${noun}s yet.`}
                                </td>
                            </tr>
                        ) : null}
                    </tbody>
                </table>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-(--ink-soft)">
                <span>{totalCount.toLocaleString("en-US")} {noun}{totalCount === 1 ? "" : "s"}</span>
                {pageCount > 1 ? (
                    <div className="flex items-center gap-2">
                        <button type="button" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)} className="rounded-lg border border-(--line) bg-white px-2.5 py-1.5 font-medium text-(--ink) disabled:opacity-40">
                            Prev
                        </button>
                        <span>Page {page} of {pageCount}</span>
                        <button type="button" disabled={page >= pageCount || loading} onClick={() => setPage(page + 1)} className="rounded-lg border border-(--line) bg-white px-2.5 py-1.5 font-medium text-(--ink) disabled:opacity-40">
                            Next
                        </button>
                    </div>
                ) : null}
            </div>
            {openOrder ? <OrderModal order={openOrder} onClose={() => setOpenOrder(null)} /> : null}
        </div>
    );
}

function money(value: number, currency: string) {
    return formatAmount(value, currency);
}

function Info({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <dt className="text-[11px] uppercase tracking-wide text-(--ink-soft)">{label}</dt>
            <dd className="mt-0.5 text-sm font-medium">{value || "-"}</dd>
        </div>
    );
}

function OrderModal({ order, onClose }: { order: { id: number; name: string }; onClose: () => void }) {
    const [data, setData] = useState<MyOrderDetails | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        getMyOrderDetails(order.id)
            .then((result) => {
                if (!cancelled) setData(result.order);
            })
            .catch((loadError) => {
                if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Failed to load the order.");
            });
        return () => {
            cancelled = true;
        };
    }, [order.id]);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);

    const currency = data?.currencyCode ?? "";
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
            <div role="dialog" aria-modal="true" aria-label={`Order ${order.name}`} className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-(--line) bg-(--card) shadow-2xl">
                <div className="flex items-start justify-between gap-3 border-b border-(--line) px-5 py-4">
                    <div className="flex flex-wrap items-center gap-3">
                        <h2 className="font-display text-xl">{order.name}</h2>
                        {data ? (
                            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${(STATE_STYLES[data.stateCode] ?? STATE_STYLES.posted).badge}`}>{data.state}</span>
                        ) : null}
                    </div>
                    <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-(--ink-soft) hover:bg-(--chip)">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="overflow-y-auto px-5 py-4">
                    {error ? <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
                    {!data && !error ? <p className="py-8 text-center text-sm text-(--ink-soft)">Loading...</p> : null}
                    {data ? (
                        <>
                            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
                                <Info label="Customer" value={data.customer} />
                                <Info label="Order date" value={formatDate(data.date)} />
                                <Info label="Valid until" value={data.validUntil ? formatDate(data.validUntil) : ""} />
                                <Info label="Salesperson" value={data.salesperson} />
                                <Info label="Sales team" value={data.team} />
                                <Info label="Customer reference" value={data.customerRef} />
                                <Info label="Payment terms" value={data.paymentTerms} />
                                <Info label="Pricelist" value={data.pricelist} />
                                <Info label="Company" value={data.companyName} />
                            </dl>

                            <div className="mt-5 overflow-x-auto rounded-xl border border-(--line)">
                                <table className="min-w-full border-collapse text-left text-sm">
                                    <thead className="bg-(--chip) text-xs text-(--ink-soft)">
                                        <tr>
                                            <th className="px-3 py-2 font-medium">Product</th>
                                            <th className="px-3 py-2 text-right font-medium">Qty</th>
                                            <th className="px-3 py-2 text-right font-medium">Delivered</th>
                                            <th className="px-3 py-2 text-right font-medium">Invoiced</th>
                                            <th className="px-3 py-2 text-right font-medium">Unit price</th>
                                            <th className="px-3 py-2 text-right font-medium">Disc. %</th>
                                            <th className="px-3 py-2 text-right font-medium">Subtotal</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {data.lines.length === 0 ? (
                                            <tr>
                                                <td colSpan={7} className="px-3 py-6 text-center text-(--ink-soft)">This order has no lines.</td>
                                            </tr>
                                        ) : null}
                                        {data.lines.map((line) =>
                                            line.kind !== "product" ? (
                                                <tr key={line.id} className="border-t border-(--line)/70 bg-(--chip)/40">
                                                    <td colSpan={7} className={`px-3 py-2 ${line.kind === "section" ? "font-semibold" : "italic text-(--ink-soft)"}`}>
                                                        {line.description}
                                                    </td>
                                                </tr>
                                            ) : (
                                                <tr key={line.id} className="border-t border-(--line)/70 align-top">
                                                    <td className="px-3 py-2">
                                                        <p className="font-medium">{line.productName || line.description}</p>
                                                        {line.productName && line.description && line.description !== line.productName ? (
                                                            <p className="mt-0.5 whitespace-pre-line text-xs text-(--ink-soft)">{line.description.replace(line.productName, "").trim()}</p>
                                                        ) : null}
                                                    </td>
                                                    <td className="px-3 py-2 text-right tabular-nums">{line.quantity.toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                                                    <td className="px-3 py-2 text-right tabular-nums">{line.delivered === null ? "-" : line.delivered.toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                                                    <td className="px-3 py-2 text-right tabular-nums">{line.invoiced === null ? "-" : line.invoiced.toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                                                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{money(line.priceUnit, "")}</td>
                                                    <td className="px-3 py-2 text-right tabular-nums">{line.discount ? line.discount.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "-"}</td>
                                                    <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums">{money(line.subtotal, "")}</td>
                                                </tr>
                                            )
                                        )}
                                    </tbody>
                                </table>
                            </div>

                            <div className="mt-4 flex justify-end">
                                <dl className="w-full max-w-xs space-y-1 text-sm">
                                    <div className="flex justify-between gap-6">
                                        <dt className="text-(--ink-soft)">Untaxed amount</dt>
                                        <dd className="tabular-nums">{money(data.amountUntaxed, currency)}</dd>
                                    </div>
                                    <div className="flex justify-between gap-6">
                                        <dt className="text-(--ink-soft)">Taxes</dt>
                                        <dd className="tabular-nums">{money(data.amountTax, currency)}</dd>
                                    </div>
                                    <div className="flex justify-between gap-6 border-t border-(--line) pt-1.5 text-base font-semibold">
                                        <dt>Total</dt>
                                        <dd className="tabular-nums">{money(data.amountTotal, currency)}</dd>
                                    </div>
                                </dl>
                            </div>

                            {data.note ? (
                                <div className="mt-4 rounded-xl bg-(--chip) px-3 py-2 text-sm">
                                    <span className="text-xs uppercase tracking-wide text-(--ink-soft)">Terms and notes</span>
                                    <p className="mt-0.5 whitespace-pre-line">{data.note}</p>
                                </div>
                            ) : null}
                        </>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
