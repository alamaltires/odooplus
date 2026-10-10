"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronDown, Search, Target } from "lucide-react";
import { getSalespersonMonthlyInvoices } from "@/lib/client-odoo";
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
    brandId: number | null;
    brandName: string;
    targetAmount: number;
    isGeneral: boolean;
};

function formatCurrency(value: number) {
    return `AED ${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function achievementTone(achievedAmount: number, targetAmount: number) {
    const ratio = targetAmount > 0 ? achievedAmount / targetAmount : 0;
    if (ratio >= 1) {
        return { className: "text-emerald-600", Icon: ArrowUp, label: "Target met" };
    }
    if (ratio >= 0.5) {
        return { className: "text-amber-600", Icon: ArrowRight, label: "On the way" };
    }
    return { className: "text-red-600", Icon: ArrowDown, label: "Behind target" };
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
                id: `${record.id}-${String(target.brandId ?? "general")}`,
                salespersonId: record.salespersonId,
                salespersonName: record.salespersonName,
                year: record.year,
                month: record.month,
                brandId: target.brandId ?? null,
                brandName: target.brandName || "General",
                targetAmount: Number(target.targetAmount ?? 0),
                isGeneral: Boolean(target.isGeneral),
            });
        }
    }

    return rows;
}

export default function SalesTargetsSummaryPage() {
    const { user, role, loading: authLoading } = useAuth();
    const canView = role === "admin" || role === "sales_manager";
    const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
    // Achieved amounts per "<year>-<month>|<salespersonId>" group, fetched the
    // first time that salesperson row is expanded (one Odoo call per group).
    const [achieved, setAchieved] = useState<
        Record<string, { status: "loading" | "error"; error?: string } | { status: "ready"; byRowId: Record<string, number> }>
    >({});
    const requestedRef = useRef<Set<string>>(new Set());
    const [records, setRecords] = useState<SalesTargetRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState("");

    useEffect(() => {
        async function loadTargets() {
            if (!user || !canView) {
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
    }, [user, canView]);

    const rows = useMemo(() => buildRows(records), [records]);

    const filteredRows = useMemo(() => {
        const query = search.trim().toLowerCase();
        if (!query) {
            return rows;
        }

        return rows.filter((row) => {
            const haystack = [
                row.salespersonName,
                row.brandName,
                String(row.salespersonId),
                String(row.brandId ?? ""),
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

            return a.brandName.localeCompare(b.brandName);
        });
    }, [filteredRows]);

    const totalTargetAmount = useMemo(
        () => filteredRows.reduce((sum, row) => sum + Number(row.targetAmount || 0), 0),
        [filteredRows]
    );

    const totalSalespeople = useMemo(() => {
        return new Set(filteredRows.map((row) => row.salespersonId)).size;
    }, [filteredRows]);

    const totalBrands = useMemo(() => {
        return new Set(filteredRows.map((row) => `${String(row.brandId ?? "general")}:${row.brandName}`)).size;
    }, [filteredRows]);

    const monthGroups = useMemo(() => {
        type PersonGroup = { salespersonId: number; salespersonName: string; rows: SummaryRow[]; total: number };
        type MonthGroup = {
            key: string;
            year: number;
            month: number;
            rows: SummaryRow[];
            total: number;
            salespeople: PersonGroup[];
        };
        const groups = new Map<string, MonthGroup>();
        for (const row of sortedRows) {
            const key = `${row.year}-${row.month}`;
            let group = groups.get(key);
            if (!group) {
                group = { key, year: row.year, month: row.month, rows: [], total: 0, salespeople: [] };
                groups.set(key, group);
            }
            group.rows.push(row);
            group.total += Number(row.targetAmount || 0);

            // sortedRows is ordered by salesperson name within a month, so rows
            // for one salesperson are contiguous.
            let person = group.salespeople.find((item) => item.salespersonId === row.salespersonId);
            if (!person) {
                person = { salespersonId: row.salespersonId, salespersonName: row.salespersonName, rows: [], total: 0 };
                group.salespeople.push(person);
            }
            person.rows.push(row);
            person.total += Number(row.targetAmount || 0);
        }
        return Array.from(groups.values());
    }, [sortedRows]);

    const isSearching = search.trim().length > 0;

    useEffect(() => {
        for (const group of monthGroups) {
            for (const person of group.salespeople) {
                const personKey = `${group.key}|${person.salespersonId}`;
                if (!expandedKeys.has(personKey) || requestedRef.current.has(personKey)) {
                    continue;
                }
                requestedRef.current.add(personKey);
                setAchieved((previous) => ({ ...previous, [personKey]: { status: "loading" } }));

                getSalespersonMonthlyInvoices({
                    salespersonId: person.salespersonId,
                    year: group.year,
                    month: group.month,
                    includeCreditNotes: false,
                })
                    .then((report) => {
                        const brandInvoiced = new Map<number, number>();
                        for (const brandTotal of report.brandTotals) {
                            brandInvoiced.set(
                                brandTotal.brandId,
                                (brandInvoiced.get(brandTotal.brandId) ?? 0) + Number(brandTotal.totalInvoiced || 0)
                            );
                        }
                        const targetedBrandIds = new Set(
                            person.rows.filter((row) => !row.isGeneral && row.brandId !== null).map((row) => row.brandId as number)
                        );
                        let targetedAchieved = 0;
                        for (const brandId of targetedBrandIds) {
                            targetedAchieved += brandInvoiced.get(brandId) ?? 0;
                        }

                        const byRowId: Record<string, number> = {};
                        for (const row of person.rows) {
                            byRowId[row.id] = row.isGeneral
                                ? Math.max(0, Number(report.totalInvoiced || 0) - targetedAchieved)
                                : brandInvoiced.get(row.brandId as number) ?? 0;
                        }
                        setAchieved((previous) => ({ ...previous, [personKey]: { status: "ready", byRowId } }));
                    })
                    .catch((fetchError) => {
                        requestedRef.current.delete(personKey);
                        setAchieved((previous) => ({
                            ...previous,
                            [personKey]: {
                                status: "error",
                                error: fetchError instanceof Error ? fetchError.message : "Failed to load achieved amounts.",
                            },
                        }));
                    });
            }
        }
    }, [expandedKeys, monthGroups]);

    function toggleGroup(key: string) {
        setExpandedKeys((previous) => {
            const next = new Set(previous);
            if (next.has(key)) {
                next.delete(key);
            } else {
                next.add(key);
            }
            return next;
        });
    }

    if (authLoading) {
        return <p className="text-sm">Loading...</p>;
    }

    if (!canView) {
        return (
            <section>
                <h1 className="font-display text-3xl">Sales Targets Summary</h1>
                <p className="mt-2 text-sm text-(--ink-soft)">
                    This page is only available to sales managers and admins.
                </p>
                <Link href="/sales-targets" className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-(--ink-soft)">
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                    Back to Sales Targets
                </Link>
            </section>
        );
    }

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
                        Overview of all brand targets assigned to salespeople, with summed targets.
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
                    <p className="text-sm text-(--ink-soft)">Target Brands</p>
                    <p className="mt-2 font-display text-3xl">{totalBrands}</p>
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
                        placeholder="Search salesperson, brand, month, year, or ID"
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
                <p className="mt-4 text-sm text-(--ink-soft)">No saved brand targets found.</p>
            ) : null}

            {!loading && monthGroups.length > 0 ? (
                <div className="mt-4 space-y-3">
                    {monthGroups.map((group) => {
                        const isOpen = isSearching || expandedKeys.has(group.key);
                        return (
                            <div key={group.key} className="overflow-hidden rounded-2xl border border-(--line)">
                                <button
                                    type="button"
                                    onClick={() => toggleGroup(group.key)}
                                    className="flex w-full items-center justify-between gap-3 bg-(--chip) px-4 py-3 text-left"
                                    aria-expanded={isOpen}
                                >
                                    <span className="flex items-center gap-2 font-medium">
                                        <ChevronDown
                                            className={`h-4 w-4 transition ${isOpen ? "" : "-rotate-90"}`}
                                            aria-hidden="true"
                                        />
                                        {monthLabel(group.month)} {group.year}
                                    </span>
                                    <span className="text-sm text-(--ink-soft)">
                                        {group.rows.length} target{group.rows.length === 1 ? "" : "s"} ·{" "}
                                        <span className="font-medium text-(--ink)">{formatCurrency(group.total)}</span>
                                    </span>
                                </button>
                                {isOpen ? (
                                    <div className="divide-y divide-(--line) border-t border-(--line)">
                                        {group.salespeople.map((person) => {
                                            const personKey = `${group.key}|${person.salespersonId}`;
                                            const personOpen = isSearching || expandedKeys.has(personKey);
                                            const achievedState = achieved[personKey];
                                            return (
                                                <div key={personKey}>
                                                    <button
                                                        type="button"
                                                        onClick={() => toggleGroup(personKey)}
                                                        className="flex w-full items-center justify-between gap-3 px-4 py-2.5 pl-8 text-left hover:bg-(--chip)/60"
                                                        aria-expanded={personOpen}
                                                    >
                                                        <span className="flex items-center gap-2 text-sm font-medium">
                                                            <ChevronDown
                                                                className={`h-4 w-4 transition ${personOpen ? "" : "-rotate-90"}`}
                                                                aria-hidden="true"
                                                            />
                                                            {person.salespersonName}
                                                        </span>
                                                        <span className="text-sm text-(--ink-soft)">
                                                            {person.rows.length} target{person.rows.length === 1 ? "" : "s"} ·{" "}
                                                            <span className="font-medium text-(--ink)">{formatCurrency(person.total)}</span>
                                                            {achievedState?.status === "ready" ? (
                                                                <>
                                                                    {" · achieved "}
                                                                    <span className="font-medium text-(--ink)">
                                                                        {formatCurrency(Object.values(achievedState.byRowId).reduce((sum, value) => sum + value, 0))}
                                                                    </span>
                                                                </>
                                                            ) : null}
                                                        </span>
                                                    </button>
                                                    {personOpen ? (
                                                        <div className="overflow-x-auto">
                                                            <table className="min-w-full border-collapse text-left text-sm">
                                                                <thead className="text-(--ink-soft)">
                                                                    <tr>
                                                                        <th className="py-2 pl-14 pr-4 font-medium">Brand</th>
                                                                        <th className="px-4 py-2 font-medium">Target Type</th>
                                                                        <th className="px-4 py-2 font-medium">Target Amount</th>
                                                                        <th className="px-4 py-2 font-medium">Achieved</th>
                                                                        <th className="px-4 py-2 font-medium">Progress</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {person.rows.map((row) => (
                                                                        <tr key={row.id} className="border-t border-(--line)">
                                                                            <td className="py-2 pl-14 pr-4">{row.brandName}</td>
                                                                            <td className="px-4 py-2">{row.isGeneral ? "General" : "Brand"}</td>
                                                                            <td className="px-4 py-2 font-medium text-(--ink)">{formatCurrency(row.targetAmount)}</td>
                                                                            {(() => {
                                                                                if (achievedState?.status !== "ready") {
                                                                                    return (
                                                                                        <>
                                                                                            <td className="px-4 py-2">
                                                                                                {achievedState?.status === "loading" ? (
                                                                                                    "Loading..."
                                                                                                ) : achievedState?.status === "error" ? (
                                                                                                    <span className="text-red-600" title={achievedState.error}>Failed</span>
                                                                                                ) : (
                                                                                                    "-"
                                                                                                )}
                                                                                            </td>
                                                                                            <td className="px-4 py-2 text-(--ink-soft)">-</td>
                                                                                        </>
                                                                                    );
                                                                                }
                                                                                const value = achievedState.byRowId[row.id] ?? 0;
                                                                                const tone = achievementTone(value, row.targetAmount);
                                                                                return (
                                                                                    <>
                                                                                        <td className={`px-4 py-2 font-medium ${tone.className}`} title={tone.label}>
                                                                                            <span className="inline-flex items-center gap-1.5">
                                                                                                <tone.Icon className="h-4 w-4" aria-hidden="true" />
                                                                                                {formatCurrency(value)}
                                                                                                <span className="sr-only">{tone.label}</span>
                                                                                            </span>
                                                                                        </td>
                                                                                        <td className={`px-4 py-2 ${tone.className}`}>
                                                                                            {row.targetAmount > 0 ? `${((value / row.targetAmount) * 100).toFixed(1)}%` : "-"}
                                                                                        </td>
                                                                                    </>
                                                                                );
                                                                            })()}
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    ) : null}
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : null}
                            </div>
                        );
                    })}
                </div>
            ) : null}
        </section>
    );
}
