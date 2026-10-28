"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, ChevronDown, ChevronLeft, ChevronRight, Download, RefreshCw, Search, Warehouse, X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { getAgedStock, getAgedStockExplanation, type AgedStockExplanation, type AgedStockResponse, type AgedStockRow } from "@/lib/client-odoo";

/** One scan fetches everything older than this; the age pills then filter instantly, without asking Odoo again. */
const SCAN_BASE_DAYS = 90;
const AGE_PILLS = [
    { days: 90, label: "3 months+" },
    { days: 180, label: "6 months+" },
    { days: 270, label: "9 months+" },
    { days: 365, label: "1 year+" },
];
const BUCKET_COLORS = ["bg-emerald-500", "bg-amber-400", "bg-orange-500", "bg-red-500"];
const PAGE_SIZE = 25;

function timeAgo(iso: string | null) {
    if (!iso) return "";
    const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    return `${Math.round(hours / 24)} d ago`;
}

function ageText(days: number) {
    if (days < 60) return `${days} days`;
    if (days < 365) return `${Math.round(days / 30)} months`;
    const years = days / 365;
    return `${years.toFixed(1)} years`;
}

const ageTone = (days: number) => (days > 365 ? "bg-red-500" : days > 270 ? "bg-orange-500" : days > 180 ? "bg-amber-500" : "bg-yellow-400");
const ageBadge = (days: number) =>
    days > 365 ? "bg-red-100 text-red-700" : days > 270 ? "bg-orange-100 text-orange-700" : days > 180 ? "bg-amber-100 text-amber-800" : "bg-yellow-100 text-yellow-800";

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
    return (
        <div className="rounded-2xl border border-(--line) bg-(--card) p-5 shadow-[0_8px_24px_rgba(8,23,41,0.05)] animate-[dash-rise_0.5s_ease-out_both]">
            <p className="text-sm text-(--ink-soft)">{label}</p>
            <p className={`mt-2 font-display text-3xl leading-tight tabular-nums ${tone ?? ""}`}>{value}</p>
            {hint ? <p className="mt-1 truncate text-xs text-(--ink-soft)">{hint}</p> : null}
        </div>
    );
}

const fmtQty = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** Shows which stock lines and receipts were counted to date one aged-stock row. */
function ExplainModal({ row, minAgeDays, onClose }: { row: AgedStockRow; minAgeDays: number; onClose: () => void }) {
    const [data, setData] = useState<AgedStockExplanation | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [now] = useState(() => Date.now());

    useEffect(() => {
        let cancelled = false;
        getAgedStockExplanation({ productId: row.productId, lotName: row.lotName, warehouse: row.warehouse, minAgeDays })
            .then((value) => {
                if (!cancelled) setData(value);
            })
            .catch((loadError) => {
                if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Failed to load the details.");
            });
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose();
        };
        document.addEventListener("keydown", onKey);
        return () => {
            cancelled = true;
            document.removeEventListener("keydown", onKey);
        };
    }, [row, minAgeDays, onClose]);

    // The stock on hand here, split by the receipt it came from (whole units of each receipt), so the lines add up to the on-hand quantity.
    const layers = useMemo(() => {
        if (!data) return [];
        const items = data.receipts
            .filter((receipt) => receipt.onShelf > 0)
            .map((receipt) => ({
                date: receipt.date,
                document: receipt.document || "-",
                partner: receipt.partner || receipt.source || "-",
                quantity: receipt.onShelfWarehouse,
                unitCost: receipt.unitCost,
                ageDays: receipt.ageDays,
            }));
        if (data.unexplainedQuantity > 1e-9) {
            items.push({
                date: data.unexplainedDate || "-",
                document: "Opening balance / correction",
                partner: "-",
                quantity: data.unexplainedQuantity,
                unitCost: null,
                ageDays: data.unexplainedDate ? Math.max(0, Math.floor((now - new Date(data.unexplainedDate).getTime()) / 86_400_000)) : 0,
            });
        }
        return items;
    }, [data, now]);
    const agedQty = layers.filter((layer) => layer.ageDays >= (data?.minAgeDays ?? 0)).reduce((total, layer) => total + layer.quantity, 0);
    const totalQty = layers.reduce((total, layer) => total + layer.quantity, 0);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
            <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-(--line) bg-(--card) shadow-xl">
                <div className="flex items-start justify-between gap-3 border-b border-(--line) p-5">
                    <div>
                        <p className="font-display text-xl leading-snug">{row.productName}</p>
                        <p className="mt-1 text-sm text-(--ink-soft)">
                            {row.brand ? `${row.brand} · ` : ""}Lot: {row.lotName || "none"} · {row.warehouse}
                        </p>
                    </div>
                    <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 hover:bg-(--chip)">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="space-y-5 overflow-y-auto p-5 text-sm">
                    {error ? <p className="text-red-600">{error}</p> : null}
                    {!data && !error ? <p className="text-(--ink-soft)">Loading the records...</p> : null}
                    {data ? (
                        <>
                            <div className="grid grid-cols-3 gap-3">
                                <div className="rounded-xl border border-(--line) p-3">
                                    <p className="text-xs text-(--ink-soft)">On hand</p>
                                    <p className="mt-1 text-2xl font-semibold tabular-nums">{fmtQty(totalQty)}</p>
                                </div>
                                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                                    <p className="text-xs text-amber-800">Aged ({data.minAgeDays}+ days)</p>
                                    <p className="mt-1 text-2xl font-semibold tabular-nums text-amber-900">{fmtQty(agedQty)}</p>
                                </div>
                                <div className="rounded-xl border border-(--line) p-3">
                                    <p className="text-xs text-(--ink-soft)">Newer</p>
                                    <p className="mt-1 text-2xl font-semibold tabular-nums">{fmtQty(totalQty - agedQty)}</p>
                                </div>
                            </div>

                            <div className="overflow-x-auto rounded-xl border border-(--line)">
                                <table className="w-full min-w-136 text-left">
                                    <thead className="bg-(--chip) text-xs text-(--ink-soft)">
                                        <tr>
                                            <th className="px-3 py-2 font-medium">Received</th>
                                            <th className="px-3 py-2 font-medium">Document</th>
                                            <th className="px-3 py-2 font-medium">Partner</th>
                                            <th className="px-3 py-2 text-right font-medium">Qty</th>
                                            <th className="px-3 py-2 text-right font-medium">Unit cost</th>
                                            <th className="px-3 py-2 text-right font-medium">Age</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {layers.length === 0 ? (
                                            <tr>
                                                <td colSpan={6} className="px-3 py-4 text-center text-(--ink-soft)">
                                                    No receipts were found for this stock.
                                                </td>
                                            </tr>
                                        ) : null}
                                        {layers.map((layer, index) => {
                                            const aged = layer.ageDays >= data.minAgeDays;
                                            return (
                                                <tr key={index} className={`border-t border-(--line)/60 ${aged ? "bg-amber-50" : ""}`}>
                                                    <td className="px-3 py-2 tabular-nums">{layer.date}</td>
                                                    <td className="px-3 py-2">{layer.document}</td>
                                                    <td className="px-3 py-2">{layer.partner}</td>
                                                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{fmtQty(layer.quantity)}</td>
                                                    <td className="px-3 py-2 text-right tabular-nums">{layer.unitCost ? fmtQty(layer.unitCost) : "-"}</td>
                                                    <td className="px-3 py-2 text-right">
                                                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${aged ? ageBadge(layer.ageDays) : "bg-(--chip)"}`}>{ageText(layer.ageDays)}</span>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                    {layers.length > 0 ? (
                                        <tfoot>
                                            <tr className="border-t border-(--line) bg-(--chip) font-semibold">
                                                <td className="px-3 py-2" colSpan={3}>Total on hand</td>
                                                <td className="px-3 py-2 text-right tabular-nums">{fmtQty(totalQty)}</td>
                                                <td colSpan={2} />
                                            </tr>
                                        </tfoot>
                                    ) : null}
                                </table>
                            </div>
                        </>
                    ) : null}
                </div>
            </div>
        </div>
    );
}

export default function ProductScannerPage() {
    const { user } = useAuth();
    const storageKey = user ? `aged-stock-v1-${user.uid}` : null;

    const [result, setResult] = useState<AgedStockResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [exporting, setExporting] = useState(false);

    const [minAge, setMinAge] = useState(180);
    const [warehouse, setWarehouse] = useState("");
    const [brand, setBrand] = useState("");
    const [search, setSearch] = useState("");
    const [sort, setSort] = useState<"age" | "quantity">("age");
    const [page, setPage] = useState(1);

    // Show the last scan straight away when coming back to the page.
    useEffect(() => {
        if (!storageKey) return;
        const timer = window.setTimeout(() => {
            try {
                const saved = window.localStorage.getItem(storageKey);
                if (saved) setResult(JSON.parse(saved) as AgedStockResponse);
            } catch {
                // ignore a broken saved copy
            }
        }, 0);
        return () => window.clearTimeout(timer);
    }, [storageKey]);

    const scan = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await getAgedStock({ minAgeDays: SCAN_BASE_DAYS });
            setResult(response);
            setPage(1);
            if (storageKey) {
                try {
                    window.localStorage.setItem(storageKey, JSON.stringify(response));
                } catch {
                    // storage full or unavailable
                }
            }
        } catch (scanError) {
            setError(scanError instanceof Error ? scanError.message : "Failed to scan aged stock.");
        } finally {
            setLoading(false);
        }
    }, [storageKey]);

    // Everything below is worked out from the scan, so filters respond instantly.
    const aged = useMemo(() => (result ? result.rows.filter((row) => row.ageDays >= minAge) : []), [result, minAge]);
    const agedUnits = aged.reduce((total, row) => total + row.quantity, 0);
    const oldest = aged[0] ?? null;

    const warehouses = useMemo(() => {
        const totals = new Map<string, number>();
        for (const row of aged) totals.set(row.warehouse, (totals.get(row.warehouse) ?? 0) + row.quantity);
        return Array.from(totals, ([name, units]) => ({ name, units })).sort((a, b) => b.units - a.units);
    }, [aged]);
    const brands = useMemo(() => Array.from(new Set(aged.map((row) => row.brand).filter(Boolean))).sort((a, b) => a.localeCompare(b)), [aged]);

    const rows = useMemo(() => {
        const query = search.trim().toLowerCase();
        return aged
            .filter((row) => (!warehouse || row.warehouse === warehouse) && (!brand || row.brand === brand) && (!query || `${row.productName} ${row.brand} ${row.lotName}`.toLowerCase().includes(query)))
            .sort((a, b) => (sort === "age" ? b.ageDays - a.ageDays || b.quantity - a.quantity : b.quantity - a.quantity || b.ageDays - a.ageDays));
    }, [aged, warehouse, brand, search, sort]);

    // A product that appears on several rows (lots / warehouses) is folded into one expandable line.
    const groups = useMemo(() => {
        const byProduct = new Map<number, AgedStockRow[]>();
        for (const row of rows) {
            const list = byProduct.get(row.productId);
            if (list) list.push(row);
            else byProduct.set(row.productId, [row]);
        }
        return Array.from(byProduct, ([productId, items]) => {
            const quantity = items.reduce((total, item) => total + item.quantity, 0);
            const cost = items.reduce((total, item) => total + (item.unitCost ?? 0) * item.quantity, 0);
            const lasts = items.map((item) => item.lastReceivedDate).filter((value): value is string => Boolean(value)).sort();
            const firsts = items.map((item) => item.firstReceivedDate).filter((value): value is string => Boolean(value)).sort();
            return {
                productId,
                rows: items,
                summary: {
                    ...items[0],
                    lotName: "",
                    unitCost: cost > 0 ? cost / quantity : null,
                    warehouse: Array.from(new Set(items.map((item) => item.warehouse))).join(", "),
                    locations: [],
                    quantity,
                    ageDays: Math.max(...items.map((item) => item.ageDays)),
                    lastReceivedDate: lasts[lasts.length - 1] ?? "",
                    firstReceivedDate: firsts[0] ?? "",
                    // The quantities belong to the row holding the newest / oldest receipt.
                    lastReceivedQty: items.filter((item) => item.lastReceivedDate === (lasts[lasts.length - 1] ?? "")).reduce((best, item) => Math.max(best, item.lastReceivedQty ?? 0), 0) || null,
                    firstReceivedQty: items.filter((item) => item.firstReceivedDate === (firsts[0] ?? "")).reduce((best, item) => Math.max(best, item.firstReceivedQty ?? 0), 0) || null,
                } as AgedStockRow,
            };
        });
    }, [rows]);
    const [expanded, setExpanded] = useState<Set<number>>(new Set());
    const [explainRow, setExplainRow] = useState<AgedStockRow | null>(null);
    const closeExplain = useCallback(() => setExplainRow(null), []);
    const toggleGroup = (productId: number) =>
        setExpanded((current) => {
            const next = new Set(current);
            if (next.has(productId)) next.delete(productId);
            else next.add(productId);
            return next;
        });

    const pageCount = Math.max(1, Math.ceil(groups.length / PAGE_SIZE));
    const currentPage = Math.min(page, pageCount);
    const pageGroups = groups.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
    const shownUnits = rows.reduce((total, row) => total + row.quantity, 0);
    const maxAge = Math.max(...aged.map((row) => row.ageDays), 1);
    const bucketTotal = result ? result.buckets.reduce((total, bucket) => total + bucket.units, 0) : 0;
    const filtered = Boolean(warehouse || brand || search.trim());

    async function handleExport() {
        if (rows.length === 0) return;
        setExporting(true);
        try {
            const XLSX = await import("xlsx");
            const worksheet = XLSX.utils.json_to_sheet(
                rows.map((row: AgedStockRow) => ({
                    Product: row.productName,
                    Brand: row.brand,
                    Lot: row.lotName,
                    "Lot Cost": row.unitCost ?? "",
                    Warehouse: row.warehouse,
                    Locations: row.locations.join(", "),
                    Quantity: row.quantity,
                    "Last Receive Qty": row.lastReceivedQty ?? "",
                    "Oldest Receive Qty": row.firstReceivedQty ?? "",
                    "Last Receive": row.lastReceivedDate ?? "",
                    "Oldest Receive": row.firstReceivedDate ?? "",
                    "In Stock Since": row.oldestDate,
                    "Age (Days)": row.ageDays,
                }))
            );
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, "Aged Stock");
            XLSX.writeFile(workbook, `aged-stock-${minAge}d-${new Date().toISOString().slice(0, 10)}.xlsx`);
        } catch (exportError) {
            setError(exportError instanceof Error ? exportError.message : "Failed to export Excel file.");
        } finally {
            setExporting(false);
        }
    }

    return (
        <section>
            {/* Header */}
            <div className="flex flex-wrap items-end justify-between gap-4 animate-[dash-rise_0.5s_ease-out_both]">
                <div>
                    <h1 className="font-display text-3xl">Aged Stock</h1>
                    <p className="mt-1 max-w-xl text-sm text-(--ink-soft)">
                        Stock that has been sitting in your warehouses the longest, counted from the date it arrived.
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    {result ? <span className="text-xs text-(--ink-soft)">Scanned {timeAgo(result.scannedAt)}</span> : null}
                    <button
                        type="button"
                        onClick={() => void scan()}
                        disabled={loading}
                        className="group inline-flex items-center gap-2 rounded-xl bg-(--brand) px-4 py-2.5 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(229,26,39,0.28)] transition hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-60 disabled:shadow-none"
                    >
                        <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : "transition group-hover:rotate-180"}`} />
                        {loading ? "Scanning warehouses..." : result ? "Scan again" : "Scan warehouses"}
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="mt-4 animate-[dash-rise_0.3s_ease-out_both]" role="progressbar" aria-label="Scanning warehouses">
                    <p className="text-xs text-(--ink-soft)">Reading warehouse stock and the receipts still on hand...</p>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-(--chip)">
                        <div className="h-full w-full rounded-full bg-[linear-gradient(90deg,var(--chip)_20%,var(--brand)_50%,var(--chip)_80%)] bg-[length:200%_100%] animate-[dash-shimmer_1.2s_linear_infinite]" />
                    </div>
                </div>
            ) : null}

            {error ? (
                <p className="mt-4 flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
                </p>
            ) : null}

            {/* Empty / loading states */}
            {!result && !loading ? (
                <div className="mt-8 rounded-2xl border border-dashed border-(--line) bg-(--card) px-6 py-14 text-center animate-[dash-rise_0.5s_ease-out_both]">
                    <Warehouse className="mx-auto h-10 w-10 text-(--brand)" aria-hidden="true" />
                    <p className="mt-3 font-display text-xl">Find your slow-moving stock</p>
                    <p className="mx-auto mt-1 max-w-md text-sm text-(--ink-soft)">
                        One scan reads every warehouse. After that you can switch between 3 months, 6 months and 1 year, or filter by warehouse and brand, instantly.
                    </p>
                    <button type="button" onClick={() => void scan()} className="mt-5 rounded-xl bg-(--brand) px-5 py-2.5 text-sm font-semibold text-white">
                        Scan warehouses
                    </button>
                </div>
            ) : null}

            {loading && !result ? (
                <div className="mt-6 grid gap-4 sm:grid-cols-3">
                    {[0, 1, 2].map((index) => (
                        <div key={index} className="h-28 rounded-2xl bg-[linear-gradient(90deg,var(--chip)_25%,#fff_50%,var(--chip)_75%)] bg-[length:200%_100%] animate-[dash-shimmer_1.4s_linear_infinite]" />
                    ))}
                </div>
            ) : null}

            {result ? (
                <div className={`transition-opacity ${loading ? "opacity-50" : ""}`}>
                    {/* Age filter */}
                    <div className="mt-6 flex flex-wrap items-center gap-2">
                        <span className="mr-1 text-sm font-medium">Older than</span>
                        {AGE_PILLS.map((pill) => (
                            <button
                                key={pill.days}
                                type="button"
                                onClick={() => {
                                    setMinAge(pill.days);
                                    setPage(1);
                                }}
                                className={`rounded-full border px-4 py-1.5 text-sm transition ${
                                    minAge === pill.days ? "border-(--brand) bg-(--brand) font-semibold text-white shadow-sm" : "border-(--line) bg-white hover:bg-(--chip)"
                                }`}
                            >
                                {pill.label}
                            </button>
                        ))}
                    </div>

                    {/* Key figures */}
                    <div className="mt-4 grid gap-4 sm:grid-cols-3">
                        <Stat
                            label={`Aged stock (${AGE_PILLS.find((pill) => pill.days === minAge)?.label.toLowerCase()})`}
                            value={`${Math.round(agedUnits).toLocaleString("en-US")} units`}
                            hint={`${result.totalUnits > 0 ? ((agedUnits / result.totalUnits) * 100).toFixed(1) : 0}% of ${Math.round(result.totalUnits).toLocaleString("en-US")} on hand · ${aged.length.toLocaleString("en-US")} lines`}
                            tone={agedUnits > 0 ? "text-red-600" : "text-emerald-600"}
                        />
                        <Stat label="Oldest item" value={oldest ? ageText(oldest.ageDays) : "-"} hint={oldest ? `${oldest.productName}${oldest.brand ? ` · ${oldest.brand}` : ""}` : "Nothing this old"} />
                        <Stat
                            label="Most aged stock in"
                            value={warehouses[0]?.name ?? "-"}
                            hint={warehouses[0] ? `${Math.round(warehouses[0].units).toLocaleString("en-US")} units aged here` : undefined}
                        />
                    </div>

                    {/* Age distribution */}
                    <div className="mt-4 rounded-2xl border border-(--line) bg-(--card) p-5 animate-[dash-rise_0.6s_ease-out_both]">
                        <p className="text-sm font-medium">How old is everything on hand</p>
                        <div className="mt-3 flex h-4 overflow-hidden rounded-full bg-(--chip)">
                            {result.buckets.map((bucket, index) =>
                                bucket.units > 0 ? (
                                    <div
                                        key={bucket.label}
                                        className={`${BUCKET_COLORS[index]} origin-left animate-[dash-bar_0.9s_ease-out_both] ${(result.buckets[index + 1]?.fromDays ?? Infinity) <= minAge ? "opacity-40" : ""}`}
                                        style={{ width: `${(bucket.units / Math.max(bucketTotal, 1)) * 100}%` }}
                                        title={`${bucket.label}: ${Math.round(bucket.units).toLocaleString("en-US")} units`}
                                    />
                                ) : null
                            )}
                        </div>
                        <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-sm">
                            {result.buckets.map((bucket, index) => (
                                <li key={bucket.label} className="flex items-center gap-2">
                                    <span className={`h-2.5 w-2.5 rounded-full ${BUCKET_COLORS[index]}`} />
                                    <span className="text-(--ink-soft)">{bucket.label}</span>
                                    <span className="font-semibold tabular-nums">{Math.round(bucket.units).toLocaleString("en-US")}</span>
                                    <span className="text-xs text-(--ink-soft)">({bucketTotal > 0 ? Math.round((bucket.units / bucketTotal) * 100) : 0}%)</span>
                                </li>
                            ))}
                        </ul>
                        {result.unknownAgeUnits > 0 ? (
                            <p className="mt-2 text-xs text-(--ink-soft)">{Math.round(result.unknownAgeUnits).toLocaleString("en-US")} units have no incoming date in Odoo, so they are not aged.</p>
                        ) : null}
                    </div>

                    {/* List */}
                    <div className="mt-4 rounded-2xl border border-(--line) bg-(--card) p-5 animate-[dash-rise_0.7s_ease-out_both]">
                        {warehouses.length > 1 ? (
                            <div className="mb-4 flex flex-wrap items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => setWarehouse("")}
                                    className={`rounded-full border px-3 py-1 text-sm ${!warehouse ? "border-(--brand) bg-(--chip) font-medium" : "border-(--line) bg-white"}`}
                                >
                                    All warehouses
                                </button>
                                {warehouses.map((wh) => (
                                    <button
                                        key={wh.name}
                                        type="button"
                                        onClick={() => {
                                            setWarehouse(warehouse === wh.name ? "" : wh.name);
                                            setPage(1);
                                        }}
                                        className={`rounded-full border px-3 py-1 text-sm ${warehouse === wh.name ? "border-(--brand) bg-(--chip) font-medium" : "border-(--line) bg-white"}`}
                                    >
                                        {wh.name} <span className="text-xs text-(--ink-soft)">{Math.round(wh.units).toLocaleString("en-US")}</span>
                                    </button>
                                ))}
                            </div>
                        ) : null}

                        <div className="flex flex-wrap items-center gap-3">
                            <label className="relative min-w-52 flex-1">
                                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--ink-soft)" />
                                <input
                                    value={search}
                                    onChange={(event) => {
                                        setSearch(event.target.value);
                                        setPage(1);
                                    }}
                                    placeholder="Search product, brand or lot"
                                    className="w-full rounded-xl border border-(--line) bg-white py-2 pl-9 pr-3 text-sm"
                                />
                            </label>
                            <select
                                value={brand}
                                onChange={(event) => {
                                    setBrand(event.target.value);
                                    setPage(1);
                                }}
                                className="rounded-xl border border-(--line) bg-white px-3 py-2 text-sm"
                            >
                                <option value="">All brands</option>
                                {brands.map((name) => (
                                    <option key={name} value={name}>
                                        {name}
                                    </option>
                                ))}
                            </select>
                            <select value={sort} onChange={(event) => setSort(event.target.value as "age" | "quantity")} className="rounded-xl border border-(--line) bg-white px-3 py-2 text-sm">
                                <option value="age">Oldest first</option>
                                <option value="quantity">Largest quantity first</option>
                            </select>
                            <button
                                type="button"
                                onClick={() => void handleExport()}
                                disabled={rows.length === 0 || exporting}
                                className="inline-flex items-center gap-2 rounded-xl border border-(--line) bg-white px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <Download className="h-4 w-4" aria-hidden="true" />
                                {exporting ? "Exporting..." : "Export"}
                            </button>
                        </div>

                        <p className="mt-3 text-sm text-(--ink-soft)">
                            {rows.length.toLocaleString("en-US")} line{rows.length === 1 ? "" : "s"} · {Math.round(shownUnits).toLocaleString("en-US")} units
                            {filtered ? " (filtered)" : ""}
                            {result.truncated ? " · showing the oldest 5,000 lines" : ""}
                        </p>

                        {rows.length === 0 ? (
                            <p className="mt-6 rounded-xl bg-(--chip) px-4 py-8 text-center text-sm text-(--ink-soft)">
                                {filtered ? "Nothing matches these filters." : "No stock this old. Nice."}
                            </p>
                        ) : (
                            <div className="mt-3 overflow-x-auto">
                                <table className="w-full min-w-240 border-collapse text-left text-sm">
                                    <thead className="text-xs uppercase tracking-wide text-(--ink-soft)">
                                        <tr className="border-b border-(--line)">
                                            <th className="py-2 pr-3 font-medium">Product</th>
                                            <th className="px-3 py-2 font-medium">Lot</th>
                                            <th className="px-3 py-2 text-right font-medium">Lot cost</th>
                                            <th className="px-3 py-2 font-medium">Warehouse</th>
                                            <th className="px-3 py-2 text-right font-medium">Qty</th>
                                            <th className="px-3 py-2 font-medium">Last receive</th>
                                            <th className="px-3 py-2 font-medium">Oldest receive</th>
                                            <th className="py-2 pl-3 font-medium">Age</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {pageGroups.map((group) => {
                                            const folded = group.rows.length > 1;
                                            const open = expanded.has(group.productId);
                                            const renderCells = (row: AgedStockRow, child: boolean, summary: boolean) => (
                                                <>
                                                    <td className={`py-3 pr-3 ${child ? "pl-7" : ""}`}>
                                                        {child ? null : (
                                                            <div className="flex items-start gap-2">
                                                                {summary ? <ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-(--ink-soft) transition ${open ? "" : "-rotate-90"}`} /> : null}
                                                                <div>
                                                                    <p className="font-medium leading-snug">{row.productName}</p>
                                                                    {row.brand ? <p className="text-xs text-(--ink-soft)">{row.brand}</p> : null}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="px-3 py-3 text-(--ink-soft)">{summary ? `${group.rows.length} lots / warehouses` : row.lotName || "-"}</td>
                                                    <td className="px-3 py-3 text-right tabular-nums">
                                                        {row.unitCost ? row.unitCost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "-"}
                                                    </td>
                                                    <td className="px-3 py-3">
                                                        <p>{row.warehouse}</p>
                                                        {summary ? null : (
                                                            <p className="max-w-48 truncate text-xs text-(--ink-soft)" title={row.locations.join(", ")}>
                                                                {row.locations.map((location) => location.split("/").slice(1).join("/")).filter(Boolean).join(", ")}
                                                            </p>
                                                        )}
                                                    </td>
                                                    <td className="px-3 py-3 text-right font-semibold tabular-nums">{Math.round(row.quantity).toLocaleString("en-US")}</td>
                                                    <td className="px-3 py-3 tabular-nums">
                                                        <p>{row.lastReceivedDate || "-"}</p>
                                                        {row.lastReceivedQty ? <p className="text-xs text-(--ink-soft)">{fmtQty(row.lastReceivedQty)} pcs</p> : null}
                                                    </td>
                                                    <td className="px-3 py-3 tabular-nums">
                                                        <p>{row.firstReceivedDate || "-"}</p>
                                                        {row.firstReceivedQty ? <p className="text-xs text-(--ink-soft)">{fmtQty(row.firstReceivedQty)} pcs</p> : null}
                                                    </td>
                                                    <td className="py-3 pl-3">
                                                        <div className="flex items-center gap-3">
                                                            <div className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-(--chip)">
                                                                <div className={`h-full rounded-full ${ageTone(row.ageDays)}`} style={{ width: `${Math.max(6, (row.ageDays / maxAge) * 100)}%` }} />
                                                            </div>
                                                            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ageBadge(row.ageDays)}`}>{ageText(row.ageDays)}</span>
                                                        </div>
                                                    </td>
                                                </>
                                            );
                                            if (!folded) {
                                                const row = group.rows[0];
                                                return (
                                                    <tr
                                                        key={`${row.productId}-${row.lotName}-${row.warehouse}`}
                                                        onClick={() => setExplainRow(row)}
                                                        className="cursor-pointer border-b border-(--line)/60 transition hover:bg-(--chip)/50"
                                                    >
                                                        {renderCells(row, false, false)}
                                                    </tr>
                                                );
                                            }
                                            return (
                                                <Fragment key={group.productId}>
                                                    <tr
                                                        onClick={() => toggleGroup(group.productId)}
                                                        className="cursor-pointer border-b border-(--line)/60 bg-(--chip)/30 transition hover:bg-(--chip)/60"
                                                        aria-expanded={open}
                                                    >
                                                        {renderCells(group.summary, false, true)}
                                                    </tr>
                                                    {open
                                                        ? group.rows.map((row) => (
                                                              <tr
                                                                  key={`${row.productId}-${row.lotName}-${row.warehouse}`}
                                                                  onClick={() => setExplainRow(row)}
                                                                            className="cursor-pointer border-b border-(--line)/40 bg-white/60 transition hover:bg-(--chip)/50"
                                                              >
                                                                  {renderCells(row, true, false)}
                                                              </tr>
                                                          ))
                                                        : null}
                                                </Fragment>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {pageCount > 1 ? (
                            <div className="mt-4 flex items-center justify-between text-sm">
                                <span className="text-(--ink-soft)">
                                    Page {currentPage} of {pageCount}
                                </span>
                                <div className="flex gap-2">
                                    <button type="button" onClick={() => setPage(currentPage - 1)} disabled={currentPage <= 1} className="inline-flex items-center gap-1 rounded-lg border border-(--line) bg-white px-3 py-1.5 disabled:opacity-40">
                                        <ChevronLeft className="h-4 w-4" /> Previous
                                    </button>
                                    <button type="button" onClick={() => setPage(currentPage + 1)} disabled={currentPage >= pageCount} className="inline-flex items-center gap-1 rounded-lg border border-(--line) bg-white px-3 py-1.5 disabled:opacity-40">
                                        Next <ChevronRight className="h-4 w-4" />
                                    </button>
                                </div>
                            </div>
                        ) : null}
                    </div>
                </div>
            ) : null}
            {explainRow ? <ExplainModal row={explainRow} minAgeDays={minAge} onClose={closeExplain} /> : null}
            <style>{`@keyframes dash-bar{from{transform:scaleX(0)}to{transform:scaleX(1)}}`}</style>
        </section>
    );
}
