"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
    AlertCircle,
    CalendarClock,
    Building2,
    CheckCircle2,
    ChevronDown,
    Container,
    Package,
    RefreshCw,
    Search,
    Ship,
    Truck,
} from "lucide-react";
import {
    diagnosePoTracking,
    getPoTrackingOrders,
    getSavedShipmentTracking,
    getTrackingCarriers,
    trackShipmentByBl,
    type TrackingCarrier,
    type PoTrackingContainer,
    type PoTrackingDiagnosis,
    type PoTrackingOrder,
    type ShipmentEvent,
    type ShipmentTracking,
} from "@/lib/client-odoo";

type BlGroup = {
    blNumber: string;
    orders: PoTrackingOrder[];
    containers: Array<PoTrackingContainer & { orderName: string }>;
    totalQty: number;
    /** Units written next to this B/L's containers in Odoo (exact), 0 when not given. */
    declaredQty: number;
};

type Stage = "waiting" | "departed" | "arrived" | "delivered";
type FilterKey = "all" | "soon" | "transit" | "arrived" | "untracked";
type TransitSort = "arrival-asc" | "arrival-desc" | "checked-desc" | "checked-asc";

const TRANSIT_SORTS: Array<{ key: TransitSort; label: string }> = [
    { key: "arrival-asc", label: "Arrival date · nearest first" },
    { key: "arrival-desc", label: "Arrival date · furthest first" },
    { key: "checked-desc", label: "Checked · most recent first" },
    { key: "checked-asc", label: "Checked · oldest first" },
];

const STAGES: Array<{ key: Stage; label: string }> = [
    { key: "waiting", label: "Loading" },
    { key: "departed", label: "Sailing" },
    { key: "arrived", label: "At port" },
    { key: "delivered", label: "Delivered" },
];

const DAY = 86_400_000;

/** B/Ls from the same shipping line share their first characters (e.g. 177GAT…). */
function seriesOf(blNumber: string) {
    return blNumber.length >= 8 ? blNumber.slice(0, 6).toUpperCase() : "";
}

/** The carrier already used for another B/L in the same series, if any. */
function carrierFromSeries(blNumber: string, carrierByBl: Record<string, string>) {
    const series = seriesOf(blNumber);
    if (!series) return undefined;
    const sibling = Object.keys(carrierByBl).find((other) => other !== blNumber && seriesOf(other) === series);
    return sibling ? carrierByBl[sibling] : undefined;
}

function toDate(value: string | undefined | null) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value: string | undefined | null, withTime = false) {
    const date = toDate(value);
    if (!date) return "—";
    return date.toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        ...(withTime ? { hour: "2-digit", minute: "2-digit" } : { year: "numeric" }),
    });
}

function timeAgo(iso: string | undefined | null) {
    const date = toDate(iso);
    if (!date) return "";
    const minutes = Math.round((Date.now() - date.getTime()) / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    return `${Math.round(hours / 24)} d ago`;
}

/** The carrier's wording is clipped in places ("Unloaded from at Port…"); tidy it up. */
function plainEvent(description: string) {
    return description
        .replace(/\s+from at\s+/i, " at ")
        .replace(/\s+on at\s+/i, " at ")
        .replace(/\(or Port Shuttle\)/i, "")
        .replace(/\s{2,}/g, " ")
        .trim();
}

function allEvents(tracking: ShipmentTracking) {
    return tracking.containers.flatMap((container) => container.events);
}

function stageOf(tracking: ShipmentTracking | undefined): Stage {
    if (!tracking) return "waiting";
    const status = tracking.status.toUpperCase();
    const actual = allEvents(tracking).filter((event) => event.isActual);
    const has = (pattern: RegExp) => actual.some((event) => pattern.test(event.description));

    if (status.includes("DELIVER") || has(/Empty Container Returned|Delivery to Consignee/i)) return "delivered";
    if (has(/Arrival at Port of Discharg|Unloaded.*Discharg/i)) return "arrived";
    const departure = toDate(tracking.origin?.departure);
    if (has(/Departure from Port of Loading|Loaded on/i) || (departure && departure.getTime() <= Date.now())) {
        return "departed";
    }
    return "waiting";
}

function latestActualEvent(tracking: ShipmentTracking | undefined): ShipmentEvent | null {
    if (!tracking) return null;
    const actual = allEvents(tracking).filter((event) => event.isActual && toDate(event.datetime));
    actual.sort((a, b) => b.datetime.localeCompare(a.datetime));
    return actual[0] ?? null;
}

type Eta = { date: Date | null; days: number | null; fromOdoo: boolean };

function etaOf(group: BlGroup, tracking: ShipmentTracking | undefined): Eta {
    const fromCarrier = toDate(tracking?.destination?.arrival);
    const date = fromCarrier ?? toDate(group.orders[0]?.expectedArrival);
    const days = date ? Math.ceil((date.getTime() - Date.now()) / DAY) : null;
    return { date, days, fromOdoo: !fromCarrier };
}

function etaChip(days: number | null, stage: Stage) {
    if (stage === "delivered") return { text: "Delivered", className: "bg-emerald-100 text-emerald-800" };
    if (stage === "arrived") return { text: "At destination port", className: "bg-emerald-100 text-emerald-800" };
    if (days === null) return { text: "No ETA", className: "bg-(--chip) text-(--ink-soft)" };
    if (days < 0) return { text: `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} late`, className: "bg-red-100 text-red-700" };
    if (days === 0) return { text: "Arrives today", className: "bg-amber-100 text-amber-800" };
    if (days <= 7) return { text: `In ${days} day${days === 1 ? "" : "s"}`, className: "bg-amber-100 text-amber-800" };
    return { text: `In ${days} days`, className: "bg-sky-100 text-sky-800" };
}

export default function PoTrackingPage() {
    const [orders, setOrders] = useState<PoTrackingOrder[]>([]);
    const [ordersLoading, setOrdersLoading] = useState(true);
    const [ordersError, setOrdersError] = useState<string | null>(null);
    const [includeReceived, setIncludeReceived] = useState(false);

    const [tracked, setTracked] = useState<Record<string, ShipmentTracking>>({});
    // Shipping line remembered per B/L, and the list to choose it from.
    const [carrierByBl, setCarrierByBl] = useState<Record<string, string>>({});
    const [carriers, setCarriers] = useState<TrackingCarrier[]>([]);
    const [trackingErrors, setTrackingErrors] = useState<Record<string, string>>({});
    const [updating, setUpdating] = useState<Set<string>>(new Set());
    const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
    const [confirmBulk, setConfirmBulk] = useState(false);

    const [search, setSearch] = useState("");
    const [filter, setFilter] = useState<FilterKey>("all");
    const [transitSort, setTransitSort] = useState<TransitSort>("arrival-asc");
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [highlighted, setHighlighted] = useState<string | null>(null);
    // The shipment whose tracking result is shown in the panel at the top.
    const [resultBl, setResultBl] = useState<string | null>(null);
    const revealResult = useCallback((blNumber: string) => setResultBl(blNumber), []);

    // Both reads are free: the PO list comes from Odoo, the last tracking
    // results from our own database. Qubictron is only called on a button press.
    useEffect(() => {
        getSavedShipmentTracking()
            .then((data) => {
                setTracked(data.tracked);
                setCarrierByBl(data.carriers ?? {});
            })
            .catch(() => undefined);
    }, []);

    // Only needed when a B/L's shipping line can't be detected; loaded once and cached on the server.
    const ensureCarriers = useCallback(() => {
        if (carriers.length > 0) return;
        getTrackingCarriers()
            .then((data) => setCarriers(data.carriers))
            .catch(() => undefined);
    }, [carriers.length]);

    const loadOrders = useCallback(async () => {
        setOrdersLoading(true);
        setOrdersError(null);
        try {
            const data = await getPoTrackingOrders({ includeReceived });
            setOrders(data.orders);
        } catch (error) {
            setOrdersError(error instanceof Error ? error.message : "Failed to load purchase orders.");
        } finally {
            setOrdersLoading(false);
        }
    }, [includeReceived]);

    useEffect(() => {
        void loadOrders();
    }, [loadOrders]);

    const groups = useMemo(() => {
        const byBl = new Map<string, BlGroup>();

        for (const order of orders) {
            // The container text doesn't say how many units sit in each container, so the PO's
            // total is shared out per B/L (all of it when the PO has a single B/L).
            const blCount = new Set(order.containers.map((container) => container.blNumber)).size;
            for (const container of order.containers) {
                const group = byBl.get(container.blNumber) ?? { blNumber: container.blNumber, orders: [], containers: [], totalQty: 0, declaredQty: 0 };
                if (!group.orders.some((existing) => existing.id === order.id)) {
                    group.orders.push(order);
                    group.totalQty += order.totalQty / blCount;
                }
                // Units typed on the container line are exact for that B/L.
                if (container.quantity > 0) {
                    group.declaredQty += container.quantity;
                }
                group.containers.push({ ...container, orderName: order.name });
                byBl.set(container.blNumber, group);
            }
        }
        return Array.from(byBl.values()).map((group) => (group.declaredQty > 0 ? { ...group, totalQty: group.declaredQty } : group));
    }, [orders]);

    const enriched = useMemo(
        () =>
            groups.map((group) => {
                const tracking = tracked[group.blNumber];
                const stage = stageOf(tracking);
                const eta = etaOf(group, tracking);
                return { group, tracking, stage, eta };
            }),
        [groups, tracked]
    );

    const counts = useMemo(() => {
        const result = { soon: 0, transit: 0, arrived: 0, untracked: 0 };
        for (const { tracking, stage, eta } of enriched) {
            if (!tracking) result.untracked += 1;
            else if (stage === "arrived" || stage === "delivered") result.arrived += 1;
            else result.transit += 1;
            if (stage !== "arrived" && stage !== "delivered" && eta.days !== null && eta.days <= 7) result.soon += 1;
        }
        return result;
    }, [enriched]);

    // Bring the result panel into view as soon as a new result is set.
    useEffect(() => {
        if (!resultBl) return;
        const frame = window.requestAnimationFrame(() =>
            document.getElementById("tracking-result")?.scrollIntoView({ behavior: "smooth", block: "start" })
        );
        return () => window.cancelAnimationFrame(frame);
    }, [resultBl]);

    const resultItem = resultBl ? enriched.find((item) => item.group.blNumber === resultBl) ?? null : null;

    // Jump to the shipment's normal place in the list (switching to the view it now belongs to).
    function showInList(item: (typeof enriched)[number]) {
        const target = item.group.blNumber;
        setSearch("");
        setFilter(item.stage === "arrived" || item.stage === "delivered" ? "arrived" : "transit");
        window.setTimeout(() => {
            document.getElementById(`bl-${target}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
            setHighlighted(target);
            window.setTimeout(() => setHighlighted((current) => (current === target ? null : current)), 2500);
        }, 150);
    }

    const visible = useMemo(() => {
        const query = search.trim().toLowerCase();
        return enriched
            .filter(({ group, tracking, stage, eta }) => {
                if (filter === "untracked" && tracking) return false;
                if (filter === "transit" && (!tracking || stage === "arrived" || stage === "delivered")) return false;
                if (filter === "arrived" && (!tracking || (stage !== "arrived" && stage !== "delivered"))) return false;
                if (filter === "soon" && (stage === "arrived" || stage === "delivered" || eta.days === null || eta.days > 7)) return false;
                if (!query) return true;
                return (
                    group.blNumber.toLowerCase().includes(query) ||
                    group.orders.some((order) =>
                        [order.name, order.vendorName, order.vendorRef].some((text) => text.toLowerCase().includes(query))
                    ) ||
                    group.containers.some(
                        (container) =>
                            container.containerNo.toLowerCase().includes(query) || container.sealNo.toLowerCase().includes(query)
                    )
                );
            })
            // Tracked shipments first (still travelling by soonest arrival, then
            // arrived ones), then the ones not tracked yet by expected date.
            .sort((a, b) => {
                // "On the way" view: the user picks what to order by.
                if (filter === "transit") {
                    const arrival = (item: (typeof enriched)[number]) => item.eta.date?.getTime() ?? Infinity;
                    const checked = (item: (typeof enriched)[number]) => toDate(item.tracking?.fetchedAt)?.getTime() ?? 0;
                    switch (transitSort) {
                        case "arrival-desc":
                            // Shipments without any arrival date go last.
                            if (arrival(a) === Infinity || arrival(b) === Infinity) return arrival(a) === arrival(b) ? 0 : arrival(a) === Infinity ? 1 : -1;
                            return arrival(b) - arrival(a);
                        case "checked-desc":
                            return checked(b) - checked(a);
                        case "checked-asc":
                            return checked(a) - checked(b);
                        default:
                            break;
                    }
                }
                const rank = (item: (typeof enriched)[number]) =>
                    !item.tracking ? 3 : item.stage === "arrived" || item.stage === "delivered" ? 2 : item.eta.days !== null && item.eta.days < 0 ? 1 : 0;
                if (rank(a) !== rank(b)) return rank(a) - rank(b);
                // Within a group: nearest arrival first (overdue ones: the most recently due first).
                const ta = a.eta.date?.getTime() ?? Infinity;
                const tb = b.eta.date?.getTime() ?? Infinity;
                return rank(a) === 1 ? tb - ta : ta - tb;
            });
    }, [enriched, filter, search, transitSort]);

    // Tracking re-sorts the list, so once the new order has rendered, scroll to the
    // card that was just tracked and open its results.
    const updateOne = useCallback(async (blNumber: string, chosenCarrier?: string, reveal = true) => {
        setUpdating((current) => new Set(current).add(blNumber));
        setTrackingErrors((current) => {
            const next = { ...current };
            delete next[blNumber];
            return next;
        });
        try {
            const carrier = chosenCarrier ?? carrierByBl[blNumber] ?? carrierFromSeries(blNumber, carrierByBl);
            const result = await trackShipmentByBl(blNumber, carrier);
            setTracked((current) => ({ ...current, [blNumber]: result }));
            const usedCarrier = carrier || result.carrierCode;
            if (usedCarrier) setCarrierByBl((current) => ({ ...current, [blNumber]: usedCarrier }));
            if (reveal) revealResult(blNumber);
        } catch (error) {
            const message = error instanceof Error ? error.message : "Tracking failed.";
            if (message.includes("shipping line")) ensureCarriers();
            setTrackingErrors((current) => ({ ...current, [blNumber]: message }));
        } finally {
            setUpdating((current) => {
                const next = new Set(current);
                next.delete(blNumber);
                return next;
            });
        }
    }, [carrierByBl, ensureCarriers, revealResult]);

    // Delivered shipments never change again, so "Update all" skips them to save requests.
    const bulkTargets = visible.filter(({ stage, tracking }) => !(tracking && stage === "delivered")).map(({ group }) => group.blNumber);

    async function updateAll() {
        setConfirmBulk(false);
        setBulkProgress({ done: 0, total: bulkTargets.length });
        for (let index = 0; index < bulkTargets.length; index += 1) {
            await updateOne(bulkTargets[index], undefined, false);
            setBulkProgress({ done: index + 1, total: bulkTargets.length });
        }
        setBulkProgress(null);
    }

    function toggle(blNumber: string) {
        setExpanded((current) => {
            const next = new Set(current);
            if (next.has(blNumber)) next.delete(blNumber);
            else next.add(blNumber);
            return next;
        });
    }

    const busy = bulkProgress !== null;
    const filters: Array<{ key: FilterKey; label: string; count: number; tone?: string }> = [
        { key: "all", label: "All", count: enriched.length },
        { key: "soon", label: "Arriving ≤ 7 days", count: counts.soon, tone: "text-amber-700" },
        { key: "transit", label: "On the way", count: counts.transit },
        { key: "arrived", label: "Arrived", count: counts.arrived },
        { key: "untracked", label: "Not tracked", count: counts.untracked },
    ];

    const renderCard = ({ group, tracking, stage, eta }: (typeof enriched)[number], pinned = false) => {
                    const isOpen = pinned || expanded.has(group.blNumber);
                    const isUpdating = updating.has(group.blNumber);
                    const error = trackingErrors[group.blNumber];
                    const chip = etaChip(eta.days, stage);
                    const stageIndex = STAGES.findIndex((item) => item.key === stage);
                    const latest = latestActualEvent(tracking);
                    const stale = tracking && Date.now() - new Date(tracking.fetchedAt).getTime() > DAY;
                    const accent =
                        stage === "arrived" || stage === "delivered"
                            ? "bg-emerald-500"
                            : !tracking
                              ? "bg-slate-300"
                              : eta.days !== null && eta.days <= 7
                                ? "bg-amber-500"
                                : "bg-sky-500";

                    return (
                        <article
                            key={pinned ? `result-${group.blNumber}` : group.blNumber}
                            id={pinned ? undefined : `bl-${group.blNumber}`}
                            className={`flex overflow-hidden rounded-2xl border bg-(--card) shadow-sm transition-shadow duration-500 ${
                                pinned || highlighted === group.blNumber ? "border-(--brand) ring-4 ring-(--brand)/20" : "border-(--line)"
                            }`}
                        >
                            <div className={`w-1.5 shrink-0 ${accent}`} />
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-start justify-between gap-4 p-5">
                                    {/* Who / what */}
                                    <div className="min-w-0">
                                        <p className="text-xl font-semibold leading-tight">{group.orders.map((order) => order.name).join(" · ")}</p>
                                        <p className="mt-0.5 text-sm text-(--ink-soft)">
                                            {Array.from(new Set(group.orders.map((order) => order.vendorName))).join(", ")}
                                        </p>
                                        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
                                            <Fact icon={<Container className="h-4 w-4" />} label="Containers" value={String(group.containers.length)} />
                                            {group.totalQty > 0 ? (
                                                <Fact icon={<Package className="h-4 w-4" />} label="Units" value={group.totalQty.toLocaleString("en-US")} />
                                            ) : null}
                                            {tracking?.vessels.length ? (
                                                <Fact icon={<Ship className="h-4 w-4" />} label="Vessel" value={tracking.vessels.join(" → ")} />
                                            ) : null}
                                            {tracking?.carrierName ? (
                                                <Fact icon={<Building2 className="h-4 w-4" />} label="Shipping line" value={shortCarrier(tracking.carrierName)} />
                                            ) : null}
                                        </dl>
                                    </div>

                                    {/* The one thing to look at */}
                                    <div className="text-right">
                                        <span className={`inline-block rounded-full px-3 py-1 text-sm font-semibold ${chip.className}`}>{chip.text}</span>
                                        <p className="mt-1.5 text-2xl font-semibold leading-none">{eta.date ? formatDate(eta.date.toISOString()) : "—"}</p>
                                        <p className="mt-1 text-xs text-(--ink-soft)">
                                            {stage === "delivered" ? "arrived" : eta.fromOdoo ? "expected (from PO)" : "estimated arrival"}
                                        </p>
                                    </div>
                                </div>

                                {/* Route + progress */}
                                {tracking ? (
                                    <div className="px-5 pb-4">
                                        <div className="flex items-center justify-between gap-3 text-sm font-medium">
                                            <span>{tracking.origin?.name || "Origin"}</span>
                                            <span className="h-px flex-1 bg-(--line)" />
                                            <span>{tracking.destination?.name || "Destination"}</span>
                                        </div>
                                        <div className="mt-3 grid grid-cols-4 gap-1.5">
                                            {STAGES.map((item, index) => (
                                                <div key={item.key}>
                                                    <div
                                                        className={`h-1.5 rounded-full ${
                                                            index <= stageIndex ? (stage === "waiting" ? "bg-slate-400" : "bg-(--brand)") : "bg-(--chip)"
                                                        }`}
                                                    />
                                                    <p className={`mt-1 text-[11px] ${index === stageIndex ? "font-semibold" : "text-(--ink-soft)"}`}>{item.label}</p>
                                                </div>
                                            ))}
                                        </div>

                                        {latest ? (
                                            <p className="mt-3 flex items-start gap-2 rounded-xl bg-(--chip) px-3 py-2 text-sm">
                                                <Truck className="mt-0.5 h-4 w-4 shrink-0 text-(--brand)" />
                                                <span>
                                                    <span className="font-medium">{plainEvent(latest.description)}</span>
                                                    <span className="text-(--ink-soft)">
                                                        {latest.location ? ` · ${latest.location}` : ""} · {timeAgo(latest.datetime) || formatDate(latest.datetime, true)}
                                                    </span>
                                                </span>
                                            </p>
                                        ) : null}
                                    </div>
                                ) : (
                                    <p className="px-5 pb-4 text-sm text-(--ink-soft)">Not tracked yet — press Track to get the latest position.</p>
                                )}

                                {error ? (
                                    <div className="mx-5 mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
                                        <p className="flex items-center gap-1.5">
                                            <AlertCircle className="h-4 w-4 shrink-0" /> {error}
                                        </p>
                                        {error.includes("shipping line") ? (
                                            <CarrierPicker
                                                carriers={carriers}
                                                disabled={isUpdating || busy}
                                                onTrack={(code) => void updateOne(group.blNumber, code)}
                                            />
                                        ) : null}
                                    </div>
                                ) : null}

                                {/* Footer */}
                                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-(--line) px-5 py-3">
                                    {pinned ? (
                                        <span className="text-sm text-(--ink-soft)">Containers & history</span>
                                    ) : (
                                        <button type="button" onClick={() => toggle(group.blNumber)} className="inline-flex items-center gap-1.5 text-sm text-(--ink-soft)">
                                            <ChevronDown className={`h-4 w-4 transition ${isOpen ? "rotate-180" : ""}`} />
                                            {isOpen ? "Hide details" : "Containers & history"}
                                        </button>
                                    )}
                                    <div className="flex items-center gap-3">
                                        <span className={`text-xs ${stale ? "text-amber-600" : "text-(--ink-soft)"}`}>
                                            {tracking ? `Checked ${timeAgo(tracking.fetchedAt)}` : ""}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => void updateOne(group.blNumber)}
                                            disabled={isUpdating || busy}
                                            className="inline-flex items-center gap-2 rounded-xl border border-(--line) bg-white px-3 py-1.5 text-sm font-medium disabled:opacity-60"
                                        >
                                            <RefreshCw className={`h-4 w-4 ${isUpdating ? "animate-spin" : ""}`} />
                                            {tracking ? "Update" : "Track"}
                                        </button>
                                    </div>
                                </div>

                                {isOpen ? <Details group={group} tracking={tracking} /> : null}
                            </div>
                        </article>
        );
    };

    return (
        <section>
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="font-display text-3xl">PO Tracking</h1>
                    <p className="mt-1 text-sm text-(--ink-soft)">Where your imported shipments are, and when they land.</p>
                </div>
                <Ship className="h-8 w-8 shrink-0 text-(--brand)" aria-hidden="true" />
            </div>

            {/* Headline numbers */}
            <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Headline icon={<CalendarClock className="h-5 w-5" />} label="Arriving within 7 days" value={counts.soon} tone="amber" />
                <Headline icon={<Ship className="h-5 w-5" />} label="On the way" value={counts.transit} tone="sky" />
                <Headline icon={<CheckCircle2 className="h-5 w-5" />} label="Arrived" value={counts.arrived} tone="emerald" />
                <Headline icon={<Package className="h-5 w-5" />} label="Not tracked yet" value={counts.untracked} tone="slate" />
            </div>

            {/* Controls */}
            <div className="mt-5 flex flex-wrap items-center gap-2">
                {filters.map((item) => (
                    <button
                        key={item.key}
                        type="button"
                        onClick={() => setFilter(item.key)}
                        className={`rounded-full border px-3.5 py-1.5 text-sm transition ${
                            filter === item.key
                                ? "border-(--brand) bg-(--brand) font-medium text-white"
                                : `border-(--line) bg-(--card) ${item.tone ?? ""}`
                        }`}
                    >
                        {item.label} <span className="opacity-70">{item.count}</span>
                    </button>
                ))}
            </div>

            {filter === "transit" ? (
                <label className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-(--ink-soft)">Order by</span>
                    <select
                        value={transitSort}
                        onChange={(event) => setTransitSort(event.target.value as TransitSort)}
                        className="rounded-xl border border-(--line) bg-white px-3 py-1.5 text-sm"
                    >
                        {TRANSIT_SORTS.map((option) => (
                            <option key={option.key} value={option.key}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                </label>
            ) : null}

            <div className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl border border-(--line) bg-(--card) p-3">
                <div className="relative min-w-[14rem] flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--ink-soft)" />
                    <input
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Search PO, vendor, B/L, container or seal"
                        className="w-full rounded-xl border border-(--line) bg-white py-2 pl-9 pr-3 text-sm"
                    />
                </div>

                <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={includeReceived} onChange={(event) => setIncludeReceived(event.target.checked)} className="h-4 w-4" />
                    Include fully received
                </label>

                {confirmBulk ? (
                    <div className="flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-1.5 text-sm text-amber-800">
                        This uses {bulkTargets.length} request{bulkTargets.length === 1 ? "" : "s"}.
                        <button type="button" onClick={() => void updateAll()} className="rounded-lg bg-(--brand) px-3 py-1 font-medium text-white">
                            Go
                        </button>
                        <button type="button" onClick={() => setConfirmBulk(false)} className="px-2 py-1">
                            Cancel
                        </button>
                    </div>
                ) : (
                    <button
                        type="button"
                        onClick={() => setConfirmBulk(true)}
                        disabled={busy || bulkTargets.length === 0}
                        className="inline-flex items-center gap-2 rounded-xl bg-(--brand) px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                    >
                        <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
                        {busy ? `Updating ${bulkProgress.done} of ${bulkProgress.total}` : `Update all (${bulkTargets.length})`}
                    </button>
                )}
            </div>

            <PoCheck />

            {ordersError ? (
                <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{ordersError}</p>
            ) : null}
            {ordersLoading && orders.length === 0 ? <p className="mt-6 text-sm text-(--ink-soft)">Loading purchase orders from Odoo...</p> : null}
            {!ordersLoading && !ordersError && visible.length === 0 ? (
                <p className="mt-6 rounded-2xl border border-dashed border-(--line) px-4 py-10 text-center text-sm text-(--ink-soft)">
                    Nothing to show for this view.
                </p>
            ) : null}

            {/* Result of the shipment that was just tracked — shown whatever view/filter is active,
                because tracking moves it to another group (e.g. out of "Not tracked"). */}
            {resultItem ? (
                <div id="tracking-result" className="mt-5 scroll-mt-4 rounded-2xl bg-(--brand)/5 p-3">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
                        <p className="flex items-center gap-2 text-sm font-semibold">
                            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                            Tracking result · {resultItem.group.orders.map((order) => order.name).join(" · ")}
                            <span className="font-normal text-(--ink-soft)">
                                — now listed under {resultItem.stage === "arrived" || resultItem.stage === "delivered" ? "Arrived" : "On the way"}
                            </span>
                        </p>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => showInList(resultItem)}
                                className="rounded-lg border border-(--line) bg-white px-3 py-1 text-sm"
                            >
                                Show in list
                            </button>
                            <button type="button" onClick={() => setResultBl(null)} className="rounded-lg px-2 py-1 text-sm text-(--ink-soft)">
                                Dismiss
                            </button>
                        </div>
                    </div>
                    {renderCard(resultItem, true)}
                </div>
            ) : null}

            {/* Shipments */}
            <div className="mt-5 space-y-4">{visible.map((item) => renderCard(item))}</div>

        </section>
    );
}

function Details({ group, tracking }: { group: BlGroup; tracking: ShipmentTracking | undefined }) {
    const [eventsFor, setEventsFor] = useState<string | null>(null);
    const activeNumber = eventsFor ?? tracking?.containers[0]?.number ?? null;
    const activeContainer = tracking?.containers.find((container) => container.number === activeNumber);

    return (
        <div className="space-y-4 border-t border-(--line) bg-(--chip)/40 p-5">
            <div className="overflow-x-auto">
                <table className="w-full min-w-[34rem] text-sm">
                    <thead>
                        <tr className="text-left text-xs text-(--ink-soft)">
                            <th className="pb-2 pr-3 font-medium">Container</th>
                            <th className="pb-2 pr-3 font-medium">Seal</th>
                            <th className="pb-2 font-medium">Last update</th>
                        </tr>
                    </thead>
                    <tbody>
                        {group.containers.map((container) => {
                            const live = tracking?.containers.find((entry) => entry.number.toUpperCase() === container.containerNo);
                            return (
                                <tr key={`${container.orderName}-${container.containerNo}`} className="border-t border-(--line) align-top">
                                    <td className="py-2 pr-3 font-medium">{container.containerNo || "(not listed)"}</td>
                                    <td className="py-2 pr-3 text-(--ink-soft)">{container.sealNo || "—"}</td>
                                                                        <td className="py-2">
                                        {live?.lastEvent ? (
                                            <>
                                                {plainEvent(live.lastEvent.description)}
                                                <span className="block text-xs text-(--ink-soft)">
                                                    {live.lastEvent.location ? `${live.lastEvent.location} · ` : ""}
                                                    {formatDate(live.lastEvent.datetime, true)}
                                                    {live.lastEvent.isActual ? "" : " (expected)"}
                                                </span>
                                            </>
                                        ) : (
                                            <span className="text-(--ink-soft)">—</span>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <p className="text-xs text-(--ink-soft)">
                B/L {group.blNumber}
                {tracking?.transshipments.length ? ` · via ${tracking.transshipments.map((stop) => stop.name).join(", ")}` : ""}
            </p>

            {activeContainer ? (
                <div>
                    <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium">History for</p>
                        {tracking!.containers.map((container) => (
                            <button
                                key={container.number}
                                type="button"
                                onClick={() => setEventsFor(container.number)}
                                className={`rounded-full border px-2.5 py-0.5 text-xs ${
                                    container.number === activeNumber ? "border-(--brand) bg-(--brand) text-white" : "border-(--line) bg-white"
                                }`}
                            >
                                {container.number}
                            </button>
                        ))}
                    </div>
                    <ol className="mt-3 space-y-3 border-l-2 border-(--line) pl-4">
                        {activeContainer.events.map((event, index) => (
                            <li key={`${event.datetime}-${index}`} className="relative text-sm">
                                <span
                                    className={`absolute -left-[1.4rem] top-1.5 h-2.5 w-2.5 rounded-full ${event.isActual ? "bg-(--brand)" : "border-2 border-(--line) bg-white"}`}
                                />
                                <p className={event.isActual ? "font-medium" : "text-(--ink-soft)"}>{plainEvent(event.description)}</p>
                                <p className="text-xs text-(--ink-soft)">
                                    {event.location ? `${event.location} · ` : ""}
                                    {formatDate(event.datetime, true)}
                                    {event.isActual ? "" : " · expected"}
                                </p>
                            </li>
                        ))}
                    </ol>
                </div>
            ) : null}
        </div>
    );
}

function CarrierPicker({
    carriers,
    disabled,
    onTrack,
}: {
    carriers: TrackingCarrier[];
    disabled: boolean;
    onTrack: (code: string) => void;
}) {
    const [text, setText] = useState("");
    const match = carriers.find((carrier) => carrier.name.toLowerCase() === text.trim().toLowerCase());
    const listId = useId();

    return (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-(--ink)">
            <input
                list={listId}
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder={carriers.length ? "Type the shipping line (e.g. Evergreen)" : "Loading shipping lines..."}
                className="min-w-[14rem] flex-1 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm"
            />
            <datalist id={listId}>
                {carriers.map((carrier) => (
                    <option key={carrier.code} value={carrier.name} />
                ))}
            </datalist>
            <button
                type="button"
                disabled={!match || disabled}
                onClick={() => match && onTrack(match.code)}
                className="rounded-lg bg-(--brand) px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
                Track with this line
            </button>
        </div>
    );
}

/** "Mediterranean Shipping Company (MSC)" → "MSC"; names without a bracket stay as they are. */
function shortCarrier(name: string) {
    const bracket = /\(([^)]+)\)\s*$/.exec(name);
    return bracket ? bracket[1] : name;
}

function Fact({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
    return (
        <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-(--chip) text-(--ink-soft)">{icon}</span>
            <div className="leading-tight">
                <dt className="text-[11px] uppercase tracking-wide text-(--ink-soft)">{label}</dt>
                <dd className="text-sm font-semibold">{value}</dd>
            </div>
        </div>
    );
}

function Headline({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: "amber" | "sky" | "emerald" | "slate" }) {
    const tones = {
        amber: "bg-amber-100 text-amber-700",
        sky: "bg-sky-100 text-sky-700",
        emerald: "bg-emerald-100 text-emerald-700",
        slate: "bg-slate-100 text-slate-600",
    };
    return (
        <div className="flex items-center gap-3 rounded-2xl border border-(--line) bg-(--card) px-4 py-3">
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tones[tone]}`}>{icon}</span>
            <div>
                <p className="text-2xl font-semibold leading-none">{value}</p>
                <p className="mt-1 text-xs text-(--ink-soft)">{label}</p>
            </div>
        </div>
    );
}

/** "Why isn't my PO listed?" — looks one purchase order up in Odoo and explains. */
function PoCheck() {
    const [open, setOpen] = useState(false);
    const [poName, setPoName] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<PoTrackingDiagnosis | null>(null);

    async function check() {
        setLoading(true);
        setError(null);
        setResult(null);
        try {
            setResult(await diagnosePoTracking(poName));
        } catch (checkError) {
            setError(checkError instanceof Error ? checkError.message : "Check failed.");
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="mt-3">
            <button type="button" onClick={() => setOpen((current) => !current)} className="text-sm text-(--ink-soft) underline-offset-2 hover:underline">
                {open ? "Hide" : "Missing a PO? Check why it isn't listed"}
            </button>

            {open ? (
                <div className="mt-2 rounded-2xl border border-(--line) bg-(--card) p-4">
                    <form
                        onSubmit={(event) => {
                            event.preventDefault();
                            void check();
                        }}
                        className="flex flex-wrap gap-2"
                    >
                        <input
                            value={poName}
                            onChange={(event) => setPoName(event.target.value)}
                            placeholder="PO number, e.g. P11789"
                            className="min-w-[12rem] flex-1 rounded-xl border border-(--line) bg-white px-3 py-2 text-sm"
                        />
                        <button type="submit" disabled={loading || !poName.trim()} className="rounded-xl bg-(--brand) px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
                            {loading ? "Checking..." : "Check"}
                        </button>
                    </form>

                    {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

                    {result ? (
                        <div className="mt-4 space-y-3 text-sm">
                            {result.reasons.length === 0 ? (
                                <p className="rounded-xl bg-emerald-50 px-3 py-2 font-medium text-emerald-800">
                                    {result.name} meets every condition — it should be listed (try Reload PO list).
                                </p>
                            ) : (
                                <div className="rounded-xl bg-amber-50 px-3 py-2 text-amber-900">
                                    <p className="font-medium">{result.name || "This PO"} is not listed because:</p>
                                    <ul className="mt-1 list-disc space-y-0.5 pl-5">
                                        {result.reasons.map((reason) => (
                                            <li key={reason}>{reason}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            {result.found ? (
                                <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-[10rem_1fr]">
                                    <dt className="text-(--ink-soft)">Status</dt>
                                    <dd>{result.state}{result.receiptStatus ? ` · receipt ${result.receiptStatus}` : ""}</dd>
                                    <dt className="text-(--ink-soft)">Purchase Type</dt>
                                    <dd>{result.types.length ? result.types.join(", ") : "—"}</dd>
                                    <dt className="text-(--ink-soft)">Source Document</dt>
                                    <dd className="break-words">{result.sourceDocument || "—"}</dd>
                                    <dt className="text-(--ink-soft)">Notes</dt>
                                    <dd className="whitespace-pre-wrap break-words">{result.notesPreview || "—"}</dd>
                                    <dt className="text-(--ink-soft)">B/L found</dt>
                                    <dd>
                                        {result.parsed.length
                                            ? Array.from(new Set(result.parsed.map((entry) => `${entry.blNumber} (from ${entry.from})`))).join(", ")
                                            : "none"}
                                    </dd>
                                </dl>
                            ) : null}
                        </div>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
