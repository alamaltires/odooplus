"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getAuth } from "firebase/auth";
import { Download, History, Loader2, Search } from "lucide-react";
import { Select2, type Select2Option } from "@/components/select2";
import { writeWorkbook } from "@/lib/client-activity";

type ActivityRow = {
    id: string;
    createdAt: string;
    userId: string;
    email: string;
    role: string;
    action: string;
    category: string;
    target: string;
    detail: string;
    ip: string;
    userAgent: string;
};

const CATEGORY_OPTIONS: Select2Option[] = [
    { value: "", label: "All activity" },
    { value: "account", label: "Sign-in / sign-out" },
    { value: "navigation", label: "Apps opened" },
    { value: "report", label: "Reports run" },
    { value: "write", label: "Changes & sends" },
    { value: "export", label: "Excel exports" },
    { value: "settings", label: "Settings & users" },
];

const CATEGORY_STYLE: Record<string, string> = {
    account: "bg-sky-100 text-sky-800",
    navigation: "bg-slate-100 text-slate-700",
    report: "bg-violet-100 text-violet-800",
    write: "bg-amber-100 text-amber-800",
    export: "bg-emerald-100 text-emerald-800",
    settings: "bg-rose-100 text-rose-800",
};

/** The browser's local calendar day, as yyyy-mm-dd. */
function localDateISO(date: Date) {
    return date.toLocaleDateString("en-CA");
}

function todayISO() {
    return localDateISO(new Date());
}

function daysAgoISO(days: number) {
    return localDateISO(new Date(Date.now() - days * 86_400_000));
}

const RANGES = [
    { label: "Today", days: 0 },
    { label: "Yesterday", days: 1, single: true },
    { label: "7 days", days: 7 },
    { label: "30 days", days: 30 },
    { label: "60 days", days: 60 },
];

/** Admin-only audit trail of what users did in the app. Entries older than the retention are removed automatically. */
export function ActivityLogSection({ users }: { users: Array<{ id: string; email: string }> }) {
    const [rows, setRows] = useState<ActivityRow[]>([]);
    const [nextBefore, setNextBefore] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [retentionDays, setRetentionDays] = useState(60);
    const [userId, setUserId] = useState("");
    const [category, setCategory] = useState("");
    // Today only by default, so the first load stays small.
    const [from, setFrom] = useState(todayISO);
    const [to, setTo] = useState(todayISO);
    const [search, setSearch] = useState("");
    const requestSeq = useRef(0);

    const load = useCallback(
        async (before?: string) => {
            const seq = ++requestSeq.current;
            setLoading(true);
            setError(null);
            try {
                const token = await getAuth().currentUser?.getIdToken();
                const params = new URLSearchParams({ limit: "100" });
                if (before) params.set("before", before);
                // Local day boundaries, so "today" means the admin's today.
                if (from) params.set("from", new Date(`${from}T00:00:00`).toISOString());
                if (to) params.set("to", new Date(`${to}T23:59:59.999`).toISOString());
                if (userId) params.set("userId", userId);
                if (category) params.set("category", category);
                if (search.trim()) params.set("search", search.trim());
                const response = await fetch(`/api/activity?${params}`, { headers: { Authorization: `Bearer ${token}` } });
                const data = (await response.json()) as { rows?: ActivityRow[]; nextBefore?: string | null; retentionDays?: number; error?: string };
                if (!response.ok || data.error) throw new Error(data.error ?? "Failed to load the activity log.");
                if (seq !== requestSeq.current) return;
                setRows((current) => (before ? [...current, ...(data.rows ?? [])] : (data.rows ?? [])));
                setNextBefore(data.nextBefore ?? null);
                if (data.retentionDays) setRetentionDays(data.retentionDays);
            } catch (loadError) {
                if (seq === requestSeq.current) setError(loadError instanceof Error ? loadError.message : "Failed to load the activity log.");
            } finally {
                if (seq === requestSeq.current) setLoading(false);
            }
        },
        [from, to, userId, category, search]
    );

    // Reload when a filter changes (typing in search waits a moment).
    useEffect(() => {
        const timer = window.setTimeout(() => void load(), search ? 400 : 0);
        return () => window.clearTimeout(timer);
    }, [load, search]);

    async function exportRows() {
        const XLSX = await import("xlsx");
        const sheet = XLSX.utils.json_to_sheet(
            rows.map((row) => ({
                Time: new Date(row.createdAt).toLocaleString("en-GB"),
                User: row.email,
                Role: row.role,
                Type: row.category,
                Action: row.action,
                Target: row.target,
                Detail: row.detail,
                IP: row.ip,
            }))
        );
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, sheet, "Activity");
        writeWorkbook(XLSX, workbook, `activity-log-${todayISO()}.xlsx`);
    }

    const userOptions: Select2Option[] = [{ value: "", label: "All users" }, ...users.map((user) => ({ value: user.id, label: user.email }))];

    return (
        <article className="rounded-3xl border border-(--line) bg-(--card) p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h2 className="flex items-center gap-2 font-display text-2xl">
                        <History className="h-6 w-6 text-(--brand)" aria-hidden="true" />
                        Activity Log
                    </h2>
                    <p className="mt-1 text-sm text-(--ink-soft)">
                        Sign-ins, apps opened, reports run, changes, sends and exports by every user. Only admins can see this. Entries older than{" "}
                        {retentionDays} days are deleted automatically, oldest first.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => void exportRows()}
                    disabled={rows.length === 0}
                    className="inline-flex items-center gap-2 rounded-xl border border-(--line) bg-white px-4 py-2 text-sm font-medium disabled:opacity-50"
                >
                    <Download className="h-4 w-4" aria-hidden="true" />
                    Export shown
                </button>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-(--ink-soft)">Period</span>
                <div className="inline-flex rounded-full border border-(--line) bg-white p-1" role="group" aria-label="Period">
                    {RANGES.map((range) => {
                        const rangeFrom = daysAgoISO(range.days);
                        const rangeTo = range.single ? rangeFrom : todayISO();
                        const active = from === rangeFrom && to === rangeTo;
                        return (
                            <button
                                key={range.label}
                                type="button"
                                aria-pressed={active}
                                onClick={() => {
                                    setFrom(rangeFrom);
                                    setTo(rangeTo);
                                }}
                                className={`rounded-full px-3.5 py-1.5 font-medium transition ${active ? "bg-(--brand) text-white shadow-sm" : "text-(--ink-soft) hover:bg-(--chip)"}`}
                            >
                                {range.label}
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-5">
                <div>
                    <span className="mb-1 block text-xs font-medium">User</span>
                    <Select2 value={userId} onChange={setUserId} options={userOptions} placeholder="All users" />
                </div>
                <div>
                    <span className="mb-1 block text-xs font-medium">Type</span>
                    <Select2 value={category} onChange={setCategory} options={CATEGORY_OPTIONS} placeholder="All activity" />
                </div>
                <label className="block text-xs font-medium">
                    From
                    <input type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} className="mt-1 w-full rounded-xl border border-(--line) bg-white px-3 py-2 text-sm font-normal" />
                </label>
                <label className="block text-xs font-medium">
                    To
                    <input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} className="mt-1 w-full rounded-xl border border-(--line) bg-white px-3 py-2 text-sm font-normal" />
                </label>
                <label className="block text-xs font-medium">
                    Search
                    <span className="relative mt-1 block">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--ink-soft)" aria-hidden="true" />
                        <input
                            type="search"
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Action, target, detail..."
                            className="w-full rounded-xl border border-(--line) bg-white py-2 pr-3 pl-9 text-sm font-normal"
                        />
                    </span>
                </label>
            </div>

            {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}

            <div className="mt-4 max-h-[32rem] overflow-auto rounded-2xl border border-(--line)">
                <table className="min-w-full text-sm">
                    <thead className="sticky top-0 bg-(--chip) text-left text-xs text-(--ink-soft)">
                        <tr>
                            <th className="px-4 py-2.5 font-medium">Time</th>
                            <th className="px-4 py-2.5 font-medium">User</th>
                            <th className="px-4 py-2.5 font-medium">Type</th>
                            <th className="px-4 py-2.5 font-medium">Action</th>
                            <th className="px-4 py-2.5 font-medium">Target / detail</th>
                            <th className="px-4 py-2.5 font-medium">IP</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-(--line) bg-white">
                        {rows.map((row) => (
                            <tr key={row.id} title={row.userAgent}>
                                <td className="px-4 py-2 whitespace-nowrap">{new Date(row.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</td>
                                <td className="px-4 py-2">
                                    <span className="block">{row.email || row.userId}</span>
                                    <span className="text-xs text-(--ink-soft)">{row.role}</span>
                                </td>
                                <td className="px-4 py-2">
                                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${CATEGORY_STYLE[row.category] ?? "bg-(--chip)"}`}>{row.category}</span>
                                </td>
                                <td className="px-4 py-2 font-medium">{row.action}</td>
                                <td className="px-4 py-2 text-(--ink-soft)">
                                    {[row.target, row.detail].filter(Boolean).join(" · ") || "-"}
                                </td>
                                <td className="px-4 py-2 whitespace-nowrap text-xs text-(--ink-soft)">{row.ip || "-"}</td>
                            </tr>
                        ))}
                        {rows.length === 0 && !loading ? (
                            <tr>
                                <td colSpan={6} className="px-4 py-8 text-center text-(--ink-soft)">
                                    No activity matches these filters.
                                </td>
                            </tr>
                        ) : null}
                    </tbody>
                </table>
            </div>

            <div className="mt-3 flex items-center gap-3 text-sm text-(--ink-soft)">
                {loading ? (
                    <span className="inline-flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading...
                    </span>
                ) : (
                    <span>{rows.length} entr{rows.length === 1 ? "y" : "ies"} shown</span>
                )}
                {nextBefore && !loading ? (
                    <button type="button" onClick={() => void load(nextBefore)} className="rounded-xl border border-(--line) bg-white px-4 py-1.5 font-medium text-(--ink)">
                        Load older
                    </button>
                ) : null}
            </div>
        </article>
    );
}
