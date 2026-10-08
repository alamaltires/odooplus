"use client";

import { useEffect, useState } from "react";
import { BookOpen, ChevronDown, Download } from "lucide-react";
import { getPartnerLedger } from "@/lib/client-odoo";
import type { OdooPartnerLedger } from "@/types/odoo";

function formatNumber(value: number) {
    return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * The customer's partner ledger, like Odoo's Partner Ledger report: every posted
 * journal item on a receivable or payable account (invoices, credit notes,
 * payments, MISC/… entries) with debit, credit and a running balance. Loaded
 * only when opened, since it reads straight from the journal items.
 */
export function PartnerLedgerSection({ customerId, asOfDate }: { customerId: number; asOfDate: string }) {
    const [open, setOpen] = useState(false);
    const [unreconciledOnly, setUnreconciledOnly] = useState(true);
    const [ledger, setLedger] = useState<OdooPartnerLedger | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        setLoading(true);
        setError(null);
        getPartnerLedger({ customerId, asOfDate, unreconciledOnly })
            .then((data) => {
                if (!cancelled) setLedger(data);
            })
            .catch((loadError) => {
                if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Failed to load the partner ledger.");
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [open, customerId, asOfDate, unreconciledOnly]);

    async function exportExcel() {
        if (!ledger) return;
        const XLSX = await import("xlsx");
        const sheet = XLSX.utils.json_to_sheet(
            ledger.rows.map((row) => ({
                Date: row.date,
                Entry: row.entry,
                Journal: row.journal,
                Account: row.account,
                Type: row.kind === "payable" ? "Payable" : "Receivable",
                Label: row.label,
                Reference: row.reference,
                "Due date": row.dueDate,
                Matching: row.matching,
                Debit: row.debit,
                Credit: row.credit,
                Balance: row.balance,
                "Amount in currency": row.amountCurrency || "",
                Currency: row.currencyCode,
                "Still open": row.residual,
            }))
        );
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, sheet, "Partner Ledger");
        XLSX.writeFile(workbook, `partner-ledger-${ledger.customerName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${ledger.asOfDate}.xlsx`);
    }

    return (
        <div className="overflow-hidden rounded-xl border border-(--line) bg-white">
            <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left">
                <span className="flex items-center gap-2 text-sm font-semibold text-(--ink)">
                    <BookOpen className="h-4 w-4 text-(--ink-soft)" aria-hidden="true" />
                    Partner Ledger (journal items)
                    {ledger ? (
                        <span className="rounded-full bg-(--chip) px-2 py-0.5 text-xs font-medium text-(--ink-soft)">{ledger.rows.length}</span>
                    ) : null}
                </span>
                <span className="flex items-center gap-2 text-xs text-(--ink-soft)">
                    {ledger ? <span className="hidden sm:inline">Balance {ledger.currencyCode} {formatNumber(ledger.totals.balance)}</span> : null}
                    <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} aria-hidden="true" />
                </span>
            </button>

            {open ? (
                <div className="border-t border-(--line) p-3">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <label className="flex cursor-pointer items-center gap-2 text-sm">
                            <input type="checkbox" checked={unreconciledOnly} onChange={(event) => setUnreconciledOnly(event.target.checked)} className="h-4 w-4" />
                            Unmatched items only
                        </label>
                        <button
                            type="button"
                            onClick={() => void exportExcel()}
                            disabled={!ledger || ledger.rows.length === 0}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-(--line) bg-white px-3 py-1.5 text-xs font-medium disabled:opacity-60"
                        >
                            <Download className="h-3.5 w-3.5" aria-hidden="true" /> Export Excel
                        </button>
                    </div>

                    {loading ? <p className="text-sm text-(--ink-soft)">Loading journal items...</p> : null}
                    {error ? <p className="text-sm text-red-600">{error}</p> : null}

                    {ledger && !loading ? (
                        ledger.rows.length === 0 ? (
                            <p className="text-sm text-(--ink-soft)">No journal items{unreconciledOnly ? " left unmatched" : ""} as of {ledger.asOfDate}.</p>
                        ) : (
                            <div className="max-h-96 overflow-auto rounded-lg border border-(--line)">
                                <table className="min-w-full text-left text-xs">
                                    <thead className="sticky top-0 bg-(--chip) text-(--ink-soft)">
                                        <tr>
                                            <th className="px-2.5 py-2 font-medium">Date</th>
                                            <th className="px-2.5 py-2 font-medium">Entry</th>
                                            <th className="px-2.5 py-2 font-medium">Account</th>
                                            <th className="px-2.5 py-2 font-medium">Label</th>
                                            <th className="px-2.5 py-2 font-medium">Due</th>
                                            <th className="px-2.5 py-2 font-medium">Matching</th>
                                            <th className="px-2.5 py-2 text-right font-medium">Debit</th>
                                            <th className="px-2.5 py-2 text-right font-medium">Credit</th>
                                            <th className="px-2.5 py-2 text-right font-medium">Balance</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {ledger.rows.map((row) => (
                                            <tr key={row.id} className="border-t border-(--line) align-top">
                                                <td className="whitespace-nowrap px-2.5 py-1.5">{row.date}</td>
                                                <td className="px-2.5 py-1.5">
                                                    <p className="whitespace-nowrap font-medium">{row.entry}</p>
                                                    <p className="text-(--ink-soft)">{row.journal}</p>
                                                </td>
                                                <td className="px-2.5 py-1.5">
                                                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${row.kind === "payable" ? "bg-violet-100 text-violet-800" : "bg-sky-100 text-sky-800"}`}>
                                                        {row.kind === "payable" ? "Payable" : "Receivable"}
                                                    </span>
                                                </td>
                                                <td className="max-w-56 px-2.5 py-1.5">
                                                    <p className="truncate" title={row.label}>{row.label || "-"}</p>
                                                    {row.reference ? <p className="truncate text-(--ink-soft)" title={row.reference}>{row.reference}</p> : null}
                                                </td>
                                                <td className="whitespace-nowrap px-2.5 py-1.5 text-(--ink-soft)">{row.dueDate || "-"}</td>
                                                <td className="whitespace-nowrap px-2.5 py-1.5">
                                                    {row.matching ? <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">{row.matching}</span> : <span className="text-(--ink-soft)">—</span>}
                                                </td>
                                                <td className="whitespace-nowrap px-2.5 py-1.5 text-right">{row.debit ? formatNumber(row.debit) : ""}</td>
                                                <td className="whitespace-nowrap px-2.5 py-1.5 text-right">
                                                    {row.credit ? formatNumber(row.credit) : ""}
                                                    {row.currencyCode ? <p className="text-(--ink-soft)">{formatNumber(row.amountCurrency)} {row.currencyCode}</p> : null}
                                                </td>
                                                <td className={`whitespace-nowrap px-2.5 py-1.5 text-right font-medium ${row.balance < 0 ? "text-emerald-700" : ""}`}>{formatNumber(row.balance)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot className="sticky bottom-0 bg-(--chip) font-semibold">
                                        <tr>
                                            <td colSpan={6} className="px-2.5 py-2">Total ({ledger.currencyCode})</td>
                                            <td className="px-2.5 py-2 text-right">{formatNumber(ledger.totals.debit)}</td>
                                            <td className="px-2.5 py-2 text-right">{formatNumber(ledger.totals.credit)}</td>
                                            <td className="px-2.5 py-2 text-right">{formatNumber(ledger.totals.balance)}</td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        )
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
