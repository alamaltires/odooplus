"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Search, Target } from "lucide-react";
import { getAllSalesTargets } from "@/lib/firestore-settings";
import { useAuth } from "@/lib/auth-context";
import { SalesTargetRecord } from "@/types/odoo";

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

type SummaryRow = {
    id: string;
    salespersonId: number;
    salespersonName: string;
    year: number;
    month: number;
    categoryId: number | null;
    categoryName: string;
    targetAmount: number;
    isGeneral: boolean;
};

function formatCurrency(value: number) {
    return `AED ${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function monthLabel(monthValue: number) {
    return months.find((month) => month.value === monthValue)?.label ?? String(monthValue);
}

function buildRows(records: SalesTargetRecord[]) {
    const rows: SummaryRow[] = [];

    for (const record of records) {
        const targets = Array.isArray(record.targets) ? record.targets : [];

        for (const target of targets) {
            rows.push({
                id: `${record.id}-${String(target.categoryId ?? "general")}`,
                salespersonId: record.salespersonId,
                salespersonName: record.salespersonName,
                year: record.year,
                month: record.month,
                categoryId: target.categoryId ?? null,
                categoryName: target.categoryName || "General",
                targetAmount: Number(target.targetAmount ?? 0),
                isGeneral: Boolean(target.isGeneral),
            });
        }
    }

    return rows;
}

export default function SalesTargetsSummaryPage() {
    const { user } = useAuth();
    const [records, setRecords] = useState<SalesTargetRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState("");

    useEffect(() => {
        async function loadTargets() {
            if (!user) {
                setRecords([]);
                setLoading(false);
                return;
            }

            setLoading(true);
            setError(null);

            try {
                const items = await getAllSalesTargets();
                setRecords(items);
            } catch (loadError) {
                setError(loadError instanceof Error ? loadError.message : "Failed to load sales targets summary.");
            } finally {
                setLoading(false);
            }
        }

        void loadTargets();
    }, [user]);

    const rows = useMemo(() => buildRows(records), [records]);

    const filteredRows = useMemo(() => {
        const query = search.trim().toLowerCase();
        if (!query) {
            return rows;
        }

        return rows.filter((row) => {
            const haystack = [
                row.salespersonName,
                row.categoryName,
                String(row.salespersonId),
                String(row.categoryId ?? ""),
                String(row.month),
                String(row.year),
            ]
                .join(" ")
                .toLowerCase();

            return haystack.includes(query);
        });
    }, [rows, search]);

    const sortedRows = useMemo(() => {
        return [...filteredRows].sort((a, b) => {
            if (a.year !== b.year) {
                return b.year - a.year;
            }

            if (a.month !== b.month) {
                return b.month - a.month;
            }

            const salespersonCompare = a.salespersonName.localeCompare(b.salespersonName);
            if (salespersonCompare !== 0) {
                return salespersonCompare;
            }

            return a.categoryName.localeCompare(b.categoryName);
        });
    }, [filteredRows]);

    const totalTargetAmount = useMemo(
        () => filteredRows.reduce((sum, row) => sum + Number(row.targetAmount || 0), 0),
        [filteredRows]
    );

    const totalSalespeople = useMemo(() => {
        return new Set(filteredRows.map((row) => row.salespersonId)).size;
    }, [filteredRows]);

    const totalCategories = useMemo(() => {
        return new Set(filteredRows.map((row) => `${String(row.categoryId ?? "general")}:${row.categoryName}`)).size;
    }, [filteredRows]);

    return (
        <section>
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <Link
                        href="/sales-targets"
                        className="inline-flex items-center gap-2 text-sm font-medium text-(--ink-soft)"
                    >
                        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                        Back to Sales Targets
                    </Link>
                    <h1 className="mt-3 font-display text-3xl">Sales Targets Summary</h1>
                    <p className="mt-1 text-sm text-(--ink-soft)">
                        Overview of all category targets assigned to salespeople, with summed targets.
                    </p>
                </div>
                <Target className="h-8 w-8 text-(--brand)" aria-hidden="true" />
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-3">
                <article className="rounded-2xl border border-(--line) bg-(--card) p-4">
                    <p className="text-sm text-(--ink-soft)">Total Target Sum</p>
                    <p className="mt-2 font-display text-3xl">{formatCurrency(totalTargetAmount)}</p>
                </article>
                <article className="rounded-2xl border border-(--line) bg-(--card) p-4">
                    <p className="text-sm text-(--ink-soft)">Salespeople</p>
                    <p className="mt-2 font-display text-3xl">{totalSalespeople}</p>
                </article>
                <article className="rounded-2xl border border-(--line) bg-(--card) p-4">
                    <p className="text-sm text-(--ink-soft)">Target Categories</p>
                    <p className="mt-2 font-display text-3xl">{totalCategories}</p>
                </article>
            </div>

            <div className="mt-4 rounded-2xl border border-(--line) bg-(--card) p-4">
                <label className="relative block">
                    <Search
                        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--ink-soft)"
                        aria-hidden="true"
                    />
                    <input
                        type="search"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Search salesperson, category, month, year, or ID"
                        className="w-full rounded-xl border border-(--line) bg-white py-2 pl-10 pr-4 text-sm"
                    />
                </label>
                {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
                <p className="mt-2 text-xs text-(--ink-soft)">
                    Showing {sortedRows.length} target row{sortedRows.length === 1 ? "" : "s"}.
                </p>
            </div>

            {loading ? <p className="mt-4 text-sm">Loading sales targets summary...</p> : null}

            {!loading && sortedRows.length === 0 ? (
                <p className="mt-4 text-sm text-(--ink-soft)">No saved category targets found.</p>
            ) : null}

            {!loading && sortedRows.length > 0 ? (
                <div className="mt-4 overflow-x-auto rounded-2xl border border-(--line)">
                    <table className="min-w-full border-collapse text-left text-sm">
                        <thead className="bg-(--chip) text-(--ink-soft)">
                            <tr>
                                <th className="px-4 py-3 font-medium">Salesperson</th>
                                <th className="px-4 py-3 font-medium">Period</th>
                                <th className="px-4 py-3 font-medium">Category</th>
                                <th className="px-4 py-3 font-medium">Category ID</th>
                                <th className="px-4 py-3 font-medium">Target Type</th>
                                <th className="px-4 py-3 font-medium">Target Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sortedRows.map((row) => (
                                <tr key={row.id} className="border-t border-(--line)">
                                    <td className="px-4 py-3">{row.salespersonName}</td>
                                    <td className="px-4 py-3">{monthLabel(row.month)} {row.year}</td>
                                    <td className="px-4 py-3">{row.categoryName}</td>
                                    <td className="px-4 py-3">{row.categoryId ?? "-"}</td>
                                    <td className="px-4 py-3">{row.isGeneral ? "General" : "Category"}</td>
                                    <td className="px-4 py-3 font-medium text-(--ink)">{formatCurrency(row.targetAmount)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : null}
        </section>
    );
}
