"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { getMyDocuments, type MyDocumentRow } from "@/lib/client-odoo";

const PAGE_SIZE = 30;

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
            getMyDocuments({ kind, search: search.trim(), limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE })
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
    }, [kind, search, page]);

    const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

    return (
        <div className="mt-6 rounded-2xl border border-(--line) bg-(--card) p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 className="font-display text-xl">{kind === "quotations" ? "My Quotations" : isOrders ? "My Sales Orders" : "My Invoices"}</h2>
                    <p className="mt-1 text-sm text-(--ink-soft)">
                        {kind === "quotations" ? "Quotations where you are the salesperson, including cancelled ones, newest first." : isOrders ? "Confirmed sales orders where you are the salesperson, newest first." : "Posted invoices and credit notes where you are the salesperson, newest first."}
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
                            <tr key={row.id} className="border-t border-(--line)/70">
                                <td className="whitespace-nowrap px-3 py-2.5 font-semibold">
                                    {row.name}
                                    {row.isCredit ? <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">Credit note</span> : null}
                                </td>
                                <td className="px-3 py-2.5">{row.customer || "-"}</td>
                                <td className="whitespace-nowrap px-3 py-2.5">{formatDate(row.date)}</td>
                                {isOrders ? null : <td className="whitespace-nowrap px-3 py-2.5">{formatDate(row.dueDate)}</td>}
                                <td className="whitespace-nowrap px-3 py-2.5">
                                    <span className="rounded-full bg-(--chip) px-2.5 py-0.5 text-xs font-medium">{isOrders ? row.state : row.paymentState || row.state}</span>
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
        </div>
    );
}
