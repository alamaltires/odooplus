"use client";

import Link from "next/link";
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertCircle, ArrowDownRight, ArrowUpRight, ArrowRight, RefreshCw } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { getSavedDashboard, refreshDashboardCard } from "@/lib/client-odoo";
import { visibleDashboardCards, type DashboardCardData, type DashboardCardId } from "@/lib/dashboard-cards";

type CardState = { status: "loading" | "ready" | "empty" | "error"; data?: unknown; fetchedAt?: string; error?: string; refreshing?: boolean };

const CONCURRENCY = 2;

function compact(value: number) {
    const abs = Math.abs(value);
    if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
    if (abs >= 10_000) return `${(value / 1_000).toFixed(1)}K`;
    return Math.round(value).toLocaleString("en-US");
}

function timeAgo(iso: string | undefined, now: number) {
    if (!iso) return "";
    const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    return `${Math.round(hours / 24)} d ago`;
}

/** Counts up to `target` (and from the previous figure on a refresh). */
function useCountUp(target: number, duration = 900) {
    const [value, setValue] = useState(0);
    const from = useRef(0);
    useEffect(() => {
        const start = performance.now();
        const origin = from.current;
        let frame = 0;
        const tick = (time: number) => {
            const progress = Math.min(1, (time - start) / duration);
            const eased = 1 - Math.pow(1 - progress, 3);
            const next = origin + (target - origin) * eased;
            from.current = next;
            setValue(next);
            if (progress < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [target, duration]);
    return value;
}

function Count({ value, format = (n: number) => Math.round(n).toLocaleString("en-US") }: { value: number; format?: (n: number) => string }) {
    return <>{format(useCountUp(value))}</>;
}

function Delta({ now, prev, label }: { now: number; prev: number; label: string }) {
    if (!prev) return <span className="text-xs text-(--ink-soft)">no data{label ? ` for ${label}` : ""}</span>;
    const pct = ((now - prev) / Math.abs(prev)) * 100;
    const up = pct >= 0;
    const Icon = up ? ArrowUpRight : ArrowDownRight;
    return (
        <span
            className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold ${
                up ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"
            }`}
        >
            <Icon className="h-3.5 w-3.5" />
            {Math.abs(pct).toFixed(0)}%
            {label ? <span className="ml-1 font-normal opacity-70">{label}</span> : null}
        </span>
    );
}

function Skeleton() {
    const bar = "rounded-lg bg-[linear-gradient(90deg,var(--chip)_25%,#fff_50%,var(--chip)_75%)] bg-[length:200%_100%] animate-[dash-shimmer_1.4s_linear_infinite]";
    return (
        <div className="space-y-3" aria-label="Loading">
            <div className={`h-9 w-28 ${bar}`} />
            <div className={`h-3 w-full ${bar}`} />
            <div className={`h-3 w-2/3 ${bar}`} />
        </div>
    );
}

/** Rounds a maximum up to a tidy axis value (e.g. 83,400 -> 100,000). */
function niceMax(value: number) {
    if (value <= 0) return 1;
    const power = Math.pow(10, Math.floor(Math.log10(value)));
    const scaled = value / power;
    return (scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10) * power;
}

/** One bar per day of the month, with the axis, last month's daily average and the key figures spelled out. */
function SalesChart({ data }: { data: DashboardCardData["sales"] }) {
    const [hover, setHover] = useState<number | null>(null);
    const total = data.daysInMonth;
    const elapsed = data.thisMonth.length;
    const lastAvg = data.prevMonthTotal / Math.max(data.lastMonth.length, 1);
    const avg = data.mtd / Math.max(elapsed, 1);
    const projected = avg * total;
    const best = data.thisMonth.reduce((top, value, index) => (value > top.value ? { value, index } : top), { value: 0, index: -1 });
    const top = niceMax(Math.max(...data.thisMonth, lastAvg, 1));
    const monthLabel = new Date(`${data.month}-01T00:00:00`).toLocaleString("en-GB", { month: "short" });
    const dayName = (day: number) => new Date(`${data.month}-${String(day + 1).padStart(2, "0")}T00:00:00`).toLocaleString("en-GB", { weekday: "short" });
    const active = hover ?? elapsed - 1;

    return (
        <div>
            <div className="mb-3 grid grid-cols-3 gap-3 text-sm">
                <div>
                    <p className="text-xs text-(--ink-soft)">Daily average</p>
                    <p className="font-semibold tabular-nums">{compact(avg)}</p>
                    <p className="text-[11px] text-(--ink-soft)">last month {compact(lastAvg)}</p>
                </div>
                <div>
                    <p className="text-xs text-(--ink-soft)">Best day</p>
                    <p className="font-semibold tabular-nums">{best.index >= 0 ? compact(best.value) : "—"}</p>
                    <p className="text-[11px] text-(--ink-soft)">{best.index >= 0 ? `${monthLabel} ${best.index + 1} (${dayName(best.index)})` : ""}</p>
                </div>
                <div>
                    <p className="text-xs text-(--ink-soft)">On pace for</p>
                    <p className="font-semibold tabular-nums">{compact(projected)}</p>
                    <p className="text-[11px] text-(--ink-soft)">last month {compact(data.prevMonthTotal)}</p>
                </div>
            </div>

            <div className="flex gap-2">
                <div className="flex h-36 flex-col justify-between text-right text-[10px] text-(--ink-soft) tabular-nums">
                    <span>{compact(top)}</span>
                    <span>{compact(top / 2)}</span>
                    <span>0</span>
                </div>
                <div className="relative h-36 flex-1" onMouseLeave={() => setHover(null)}>
                    {[0, 50, 100].map((pct) => (
                        <div key={pct} className="absolute inset-x-0 border-t border-dashed border-(--line)" style={{ top: `${pct}%` }} />
                    ))}
                    <div
                        className="absolute inset-x-0 z-10 border-t-2 border-dashed border-slate-400"
                        style={{ top: `${100 - Math.min(100, (lastAvg / top) * 100)}%` }}
                        title={`Last month's daily average: ${compact(lastAvg)}`}
                    />
                    <div className="absolute inset-0 flex items-end gap-[3px]">
                        {Array.from({ length: total }, (_, day) => {
                            const value = data.thisMonth[day];
                            const isFuture = value === undefined;
                            const height = isFuture ? 0 : Math.max(value > 0 ? 2 : 0, (value / top) * 100);
                            return (
                                <div key={day} className="relative flex h-full flex-1 items-end" onMouseEnter={() => !isFuture && setHover(day)}>
                                    <div
                                        className={`w-full origin-bottom rounded-t-sm animate-[dash-grow_0.7s_ease-out_both] transition-colors ${
                                            isFuture ? "" : day === active ? "bg-(--brand)" : value >= lastAvg ? "bg-emerald-500/80" : "bg-orange-300"
                                        }`}
                                        style={{ height: `${height}%`, animationDelay: `${day * 18}ms` }}
                                    />
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            <div className="ml-9 mt-1 flex justify-between text-[10px] text-(--ink-soft)">
                {[1, Math.ceil(total / 4), Math.ceil(total / 2), Math.ceil((total * 3) / 4), total].map((label) => (
                    <span key={label}>{label}</span>
                ))}
            </div>

            <p className="mt-2 text-xs text-(--ink-soft)">
                <span className="font-medium text-(--ink)">
                    {dayName(active)} {monthLabel} {active + 1}: {compact(data.thisMonth[active] ?? 0)}
                </span>
                {data.lastMonth[active] !== undefined ? ` · last month the same day ${compact(data.lastMonth[active])}` : ""}
                <span className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-sm bg-emerald-500/80" /> at or above last month&apos;s daily average
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-sm bg-orange-300" /> below it
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                        <span className="h-0 w-4 border-t-2 border-dashed border-slate-400" /> last month&apos;s daily average
                    </span>
                </span>
            </p>
        </div>
    );
}

function Stat({ label, children, tone }: { label: string; children: ReactNode; tone?: "red" | "green" | "amber" }) {
    const color = tone === "red" ? "text-red-600" : tone === "green" ? "text-emerald-600" : tone === "amber" ? "text-amber-600" : "text-(--ink)";
    return (
        <div>
            <p className={`font-display text-3xl leading-none tabular-nums ${color}`}>{children}</p>
            <p className="mt-1.5 text-xs text-(--ink-soft)">{label}</p>
        </div>
    );
}

function StockCard({ data }: { data: DashboardCardData["stock"] }) {
    if (data.total <= 0) return <p className="text-sm text-(--ink-soft)">No stock on hand.</p>;
    const free = Math.max(0, data.total - data.reserved);
    const freeShare = (free / data.total) * 100;
    const top = Math.max(...data.warehouses.map((item) => item.units), 1);
    return (
        <div className="grid items-start gap-5 sm:grid-cols-[minmax(0,11rem)_1fr]">
            <div>
                <p className="font-display text-4xl leading-none tabular-nums">
                    <Count value={data.total} />
                </p>
                <p className="mt-1.5 text-xs text-(--ink-soft)">units on hand</p>
                <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-(--chip)">
                    <div className="h-full origin-left bg-emerald-500 animate-[dash-bar_1s_ease-out_both]" style={{ width: `${freeShare}%` }} />
                </div>
                <p className="mt-1.5 text-xs text-(--ink-soft)">
                    <span className="font-semibold text-emerald-700">{Math.round(free).toLocaleString("en-US")}</span> free to sell ({freeShare.toFixed(0)}%)
                    <br />
                    {Math.round(data.reserved).toLocaleString("en-US")} reserved for orders
                </p>
            </div>
            <ul className="space-y-3">
                {data.warehouses.map((item, index) => (
                    <li key={item.name}>
                        <div className="flex items-baseline justify-between gap-3 text-sm">
                            <span className="min-w-0 truncate font-medium">{item.name}</span>
                            <span className="shrink-0 tabular-nums">
                                {Math.round(item.units).toLocaleString("en-US")} <span className="text-xs text-(--ink-soft)">{((item.units / data.total) * 100).toFixed(0)}%</span>
                            </span>
                        </div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-(--chip)">
                            <div
                                className="h-full origin-left rounded-full bg-gradient-to-r from-(--brand) to-orange-400 animate-[dash-bar_0.9s_ease-out_both]"
                                style={{ width: `${Math.max(3, (item.units / top) * 100)}%`, animationDelay: `${index * 80}ms` }}
                            />
                        </div>
                    </li>
                ))}
            </ul>
        </div>
    );
}

/** A card whose saved figures are in an old shape shows a hint instead of taking the whole page down. */
class CardBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
    state = { failed: false };
    static getDerivedStateFromError() {
        return { failed: true };
    }
    render() {
        return this.state.failed ? (
            <p className="flex items-start gap-1.5 text-sm text-amber-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> Saved figures are out of date. Press Refresh data.
            </p>
        ) : (
            this.props.children
        );
    }
}

function CardBody({ id, data }: { id: DashboardCardId; data: unknown }) {
    switch (id) {
        case "today": {
            const d = data as DashboardCardData["today"];
            const before = d.prev;
            const items = [
                { label: "Pending orders", value: d.pending, prev: before?.pending ?? 0, bar: "bg-orange-400", dot: "bg-orange-400" },
                { label: "Confirmed orders", value: d.confirmed, prev: before?.confirmed ?? 0, bar: "bg-emerald-500", dot: "bg-emerald-500" },
                { label: "Issued invoices", value: d.invoices, prev: before?.invoices ?? 0, bar: "bg-blue-500", dot: "bg-blue-500" },
            ];
            // At least 4 so the axis reads 4 / 2 / 0 for small counts instead of repeating 1.
            const top = Math.max(4, niceMax(Math.max(...items.flatMap((item) => [item.value, item.prev]), 1)));
            const barHeight = (value: number) => `${Math.max(value > 0 ? 2 : 0, (value / top) * 100)}%`;
            return (
                <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,14rem)_1fr]">
                    <div>
                        <p className="font-display text-5xl leading-none tabular-nums">
                            <Count value={d.invoices} />
                        </p>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                            <Delta now={d.invoices} prev={items[2].prev} label="vs yesterday" />
                        </div>
                        <p className="mt-2 text-sm text-(--ink-soft)">invoices issued today</p>
                        <ul className="mt-3 space-y-2 text-sm">
                            {items.slice(0, 2).map((item) => (
                                <li key={item.label} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                    <span className={`h-2 w-2 rounded-full ${item.dot}`} />
                                    <span className="font-semibold tabular-nums">{item.value.toLocaleString("en-US")}</span>
                                    <span className="text-(--ink-soft)">{item.label.toLowerCase()}</span>
                                    <Delta now={item.value} prev={item.prev} label="" />
                                </li>
                            ))}
                        </ul>
                    </div>
                    <div>
                        <div className="mb-2 flex items-center gap-4 text-xs text-(--ink-soft)">
                            <span className="inline-flex items-center gap-1.5">
                                <span className="h-2 w-2 rounded-sm bg-slate-300" /> Yesterday
                            </span>
                            <span className="inline-flex items-center gap-1.5">
                                <span className="h-2 w-2 rounded-sm bg-(--brand)" /> Today
                            </span>
                        </div>
                        <div className="flex gap-2">
                            <div className="flex h-36 flex-col justify-between text-right text-[10px] text-(--ink-soft) tabular-nums">
                                <span>{compact(top)}</span>
                                <span>{compact(top / 2)}</span>
                                <span>0</span>
                            </div>
                            <div className="relative h-36 flex-1">
                                {[0, 50, 100].map((pct) => (
                                    <div key={pct} className="absolute inset-x-0 border-t border-dashed border-(--line)" style={{ top: `${pct}%` }} />
                                ))}
                                <div className="absolute inset-0 flex items-end justify-around gap-4 px-2">
                                    {items.map((item, index) => (
                                        <div key={item.label} className="flex h-full w-full max-w-28 items-end justify-center gap-1.5">
                                            {[
                                                { value: item.prev, color: "bg-slate-300", delay: index * 120 },
                                                { value: item.value, color: item.bar, delay: index * 120 + 80 },
                                            ].map((bar, barIndex) => (
                                                <div key={barIndex} className="flex h-full w-1/2 flex-col items-center justify-end">
                                                    <span className="mb-1 text-[11px] font-semibold tabular-nums">{bar.value.toLocaleString("en-US")}</span>
                                                    <div
                                                        className={`w-full origin-bottom rounded-t-md ${bar.color} animate-[dash-grow_0.8s_ease-out_both]`}
                                                        style={{ height: barHeight(bar.value), animationDelay: `${bar.delay}ms` }}
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <div className="ml-9 mt-1 flex justify-around gap-4 px-2 text-center text-[11px] text-(--ink-soft)">
                            {items.map((item) => (
                                <span key={item.label} className="w-full max-w-28">
                                    {item.label}
                                </span>
                            ))}
                        </div>
                    </div>
                </div>
            );
        }
        case "sales": {
            const d = data as DashboardCardData["sales"];
            return (
                <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,14rem)_1fr]">
                    <div>
                        <p className="font-display text-5xl leading-none tabular-nums">
                            <Count value={d.mtd} format={compact} />
                        </p>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                            <Delta now={d.mtd} prev={d.prevSamePeriod} label="vs same days last month" />
                        </div>
                        <p className="mt-2 text-xs text-(--ink-soft)">
                            {(d.invoices ?? 0).toLocaleString("en-US")} invoices · last month total {compact(d.prevMonthTotal)}
                        </p>
                    </div>
                    <SalesChart data={d} />
                </div>
            );
        }
        case "receivables": {
            const d = data as DashboardCardData["receivables"];
            const share = d.open > 0 ? Math.min(100, Math.max(0, (d.overdue / d.open) * 100)) : 0;
            return (
                <>
                    <p className={`font-display text-4xl leading-none tabular-nums ${d.overdue > 0 ? "text-red-600" : "text-emerald-600"}`}>
                        <Count value={d.overdue} format={compact} />
                    </p>
                    <p className="mt-1.5 text-xs text-(--ink-soft)">
                        overdue across {d.overdueInvoices.toLocaleString("en-US")} invoice{d.overdueInvoices === 1 ? "" : "s"}
                    </p>
                    <div className="mt-4 h-2 overflow-hidden rounded-full bg-(--chip)">
                        <div className="h-full origin-left rounded-full bg-red-500 animate-[dash-bar_1s_ease-out_both]" style={{ width: `${share}%` }} />
                    </div>
                    <p className="mt-1.5 text-xs text-(--ink-soft)">
                        {share.toFixed(0)}% of the {compact(d.open)} still open is overdue
                    </p>
                </>
            );
        }
        case "pending": {
            const d = data as DashboardCardData["pending"];
            return (
                <Stat label={`${compact(d.total)} waiting to be confirmed`}>
                    <Count value={d.count} />
                </Stat>
            );
        }
        case "stock":
            return <StockCard data={data as DashboardCardData["stock"]} />;
        case "topProducts":
        case "topBrands": {
            const rows = (data as DashboardCardData["topProducts"]).rows;
            if (rows.length === 0) return <p className="text-sm text-(--ink-soft)">No sales yet this month.</p>;
            const top = Math.max(...rows.map((row) => row.quantity), 1);
            return (
                <ul className="space-y-3.5">
                    {rows.map((row, index) => (
                        <li key={row.name}>
                            <div className="flex items-baseline justify-between gap-3 text-sm">
                                <span className="min-w-0 truncate font-medium">{row.name}</span>
                                <span className="shrink-0 tabular-nums">
                                    {Math.round(row.quantity).toLocaleString("en-US")} <span className="text-xs text-(--ink-soft)">units</span>
                                </span>
                            </div>
                            <div className="mt-1.5 flex items-center gap-3">
                                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-(--chip)">
                                    <div
                                        className="h-full origin-left rounded-full bg-gradient-to-r from-(--brand) to-orange-400 animate-[dash-bar_0.9s_ease-out_both]"
                                        style={{ width: `${Math.max(3, (row.quantity / top) * 100)}%`, animationDelay: `${index * 80}ms` }}
                                    />
                                </div>
                                <span className="shrink-0 text-xs text-(--ink-soft) tabular-nums">{compact(row.amount)}</span>
                            </div>
                        </li>
                    ))}
                </ul>
            );
        }
    }
}

export default function DashboardPage() {
    const { user, role, enabledApps } = useAuth();
    const cards = useMemo(() => visibleDashboardCards(role, enabledApps), [role, enabledApps]);
    const [states, setStates] = useState<Record<string, CardState>>({});
    const [now, setNow] = useState(() => Date.now());
    const [refreshingAll, setRefreshingAll] = useState(false);
    const runId = useRef(0);

    // Keeps the "x min ago" labels current without touching Odoo.
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 30_000);
        return () => window.clearInterval(timer);
    }, []);

    const storageKey = user ? `dashboard-saved-v9-${user.uid}` : null;
    const persist = useCallback(
        (cards: Record<string, CardState>) => {
            if (!storageKey) return;
            try {
                const saved: Record<string, { data: unknown; fetchedAt: string }> = {};
                for (const [id, state] of Object.entries(cards)) {
                    if (state.data !== undefined && state.fetchedAt) saved[id] = { data: state.data, fetchedAt: state.fetchedAt };
                }
                window.localStorage.setItem(storageKey, JSON.stringify(saved));
            } catch {
                // storage unavailable: the server copy still works
            }
        },
        [storageKey]
    );

    // Opening the page never queries Odoo: show the copy kept in this browser at once, then the one saved on the server.
    useEffect(() => {
        if (!storageKey) return;
        let cancelled = false;
        const apply = (saved: Record<string, { data: unknown; fetchedAt: string }>) => {
            setStates(() => {
                const next: Record<string, CardState> = {};
                for (const card of cards) {
                    const entry = saved[card.id];
                    next[card.id] = entry ? { status: "ready", data: entry.data, fetchedAt: entry.fetchedAt } : { status: "empty" };
                }
                return next;
            });
        };
        const timer = window.setTimeout(() => {
            try {
                const local = window.localStorage.getItem(storageKey);
                if (local) apply(JSON.parse(local));
            } catch {
                // ignore a broken local copy
            }
            getSavedDashboard()
                .then((result) => {
                    if (cancelled) return;
                    apply(result.cards);
                    try {
                        window.localStorage.setItem(storageKey, JSON.stringify(result.cards));
                    } catch {
                        // ignore
                    }
                })
                .catch((error) => {
                    if (cancelled) return;
                    setStates((current) => (Object.keys(current).length ? current : Object.fromEntries(cards.map((card) => [card.id, { status: "error" as const, error: error instanceof Error ? error.message : "Failed to load." }]))));
                });
        }, 0);
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [storageKey, cards]);

    /** Recalculates every card from Odoo (two at a time) and saves the results. */
    const refreshCards = useCallback(async () => {
        const run = ++runId.current;
        setStates((current) => {
            const next = { ...current };
            for (const card of cards) next[card.id] = current[card.id]?.data !== undefined ? { ...current[card.id], refreshing: true, error: undefined } : { status: "loading" };
            return next;
        });

        const queue = cards.map((card) => card.id);
        const worker = async () => {
            for (let id = queue.shift(); id; id = queue.shift()) {
                try {
                    const result = await refreshDashboardCard(id);
                    if (run !== runId.current) return;
                    setStates((current) => {
                        const next = { ...current, [id]: { status: "ready" as const, data: result.data, fetchedAt: result.fetchedAt } };
                        persist(next);
                        return next;
                    });
                } catch (error) {
                    if (run !== runId.current) return;
                    const message = error instanceof Error ? error.message : "Failed to load.";
                    setStates((current) => ({
                        ...current,
                        [id]: current[id]?.data !== undefined ? { ...current[id], refreshing: false, error: message } : { status: "error", error: message },
                    }));
                }
            }
        };
        await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    }, [cards, persist]);

    async function refreshAll() {
        setRefreshingAll(true);
        await refreshCards();
        setRefreshingAll(false);
    }

    const loadedTimes = cards.map((card) => states[card.id]?.fetchedAt).filter((value): value is string => Boolean(value));
    const oldest = loadedTimes.length ? loadedTimes.reduce((a, b) => (a < b ? a : b)) : undefined;
    const busy = refreshingAll || cards.some((card) => states[card.id]?.status === "loading");

    return (
        <section>
            <style>{`@keyframes dash-bar{from{transform:scaleX(0)}to{transform:scaleX(1)}}@keyframes dash-grow{from{transform:scaleY(0)}to{transform:scaleY(1)}}@keyframes dash-ring{from{opacity:0;stroke-dashoffset:var(--ring-from,0)}to{opacity:1}}`}</style>
            <div className="flex flex-wrap items-end justify-between gap-4 animate-[dash-rise_0.5s_ease-out_both]">
                <div>
                    <h1 className="font-display text-3xl">Dashboard</h1>
                    <p className="mt-1 flex items-center gap-2 text-sm text-(--ink-soft)">
                        <span className="relative flex h-2 w-2">
                            {busy ? <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" /> : null}
                            <span className={`relative inline-flex h-2 w-2 rounded-full ${busy ? "bg-amber-500" : "bg-emerald-500"}`} />
                        </span>
                        {busy ? "Updating from Odoo..." : oldest ? `Data updated ${timeAgo(oldest, now)} · press Refresh data for the latest` : "Nothing loaded yet. Press Refresh data to pull the latest from Odoo."}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => void refreshAll()}
                    disabled={busy}
                    className="group inline-flex items-center gap-2 rounded-xl bg-(--brand) px-4 py-2.5 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(229,26,39,0.28)] transition hover:-translate-y-0.5 hover:shadow-[0_12px_22px_rgba(229,26,39,0.35)] active:translate-y-0 disabled:translate-y-0 disabled:opacity-60 disabled:shadow-none"
                >
                    <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : "transition group-hover:rotate-180"}`} />
                    {busy ? "Updating..." : "Refresh data"}
                </button>
            </div>

            <div className="mt-6 grid grid-flow-dense gap-4 md:grid-cols-2 xl:grid-cols-3">
                {cards.map((card, index) => {
                    const state = states[card.id];
                    const wide = card.id === "sales" || card.id === "today";
                    return (
                        <article
                            key={card.id}
                            style={{ animationDelay: `${index * 70}ms` }}
                            className={`group/card relative flex flex-col overflow-hidden rounded-2xl border border-(--line) bg-(--card)/90 p-5 shadow-[0_8px_24px_rgba(8,23,41,0.06)] backdrop-blur transition duration-300 hover:-translate-y-1 hover:shadow-[0_16px_34px_rgba(8,23,41,0.12)] animate-[dash-rise_0.6s_ease-out_both] ${
                                wide ? "md:col-span-2" : ""
                            }`}
                        >
                            <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-(--brand) via-orange-400 to-(--accent) opacity-70 transition group-hover/card:opacity-100" />
                            <div className="mb-4 flex items-center justify-between gap-2">
                                <p className="text-sm font-medium text-(--ink-soft)">{card.title}</p>
                                {card.link ? (
                                    <Link href={card.link} className="inline-flex items-center gap-1 text-xs font-semibold text-(--brand) opacity-0 transition group-hover/card:opacity-100 focus-visible:opacity-100">
                                        Open <ArrowRight className="h-3.5 w-3.5" />
                                    </Link>
                                ) : null}
                            </div>

                            <div className="min-h-20 flex-1">
                                {!state || state.status === "loading" ? (
                                    <Skeleton />
                                ) : state.status === "empty" ? (
                                    <p className="text-sm text-(--ink-soft)">No data saved yet. Press Refresh data to load it.</p>
                                ) : state.status === "error" ? (
                                    <p className="flex items-start gap-1.5 text-sm text-red-600">
                                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {state.error}
                                    </p>
                                ) : (
                                    <div className={`transition-opacity duration-300 ${state.refreshing ? "opacity-40" : ""}`}>
                                        <CardBoundary key={state.fetchedAt}>
                                            <CardBody id={card.id} data={state.data} />
                                        </CardBoundary>
                                        {state.error ? <p className="mt-2 text-xs text-red-600">Could not refresh: {state.error}</p> : null}
                                    </div>
                                )}
                            </div>

                            <p className="mt-4 text-[11px] text-(--ink-soft)">
                                {state?.refreshing ? "Updating..." : state?.fetchedAt ? `Updated ${timeAgo(state.fetchedAt, now)}` : " "}
                            </p>
                        </article>
                    );
                })}
            </div>
        </section>
    );
}
