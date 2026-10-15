"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
    AlertCircle,
    CalendarClock,
    Building2,
    CheckCircle2,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    Container,
    Download,
    List,
    Map as MapIcon,
    MapPin,
    Package,
    RefreshCw,
    Search,
    Ship,
    Truck,
} from "lucide-react";
import {
    diagnosePoTracking,
    geocodePorts,
    exportPoTrackingExcel,
    getPoBrands,
    getPoBills,
    type PoBillStatus,
    getPoTrackingOrders,
    getSeaRoutes,
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
import type { MapShipment } from "@/components/shipment-map";
import { lookupPort, positionBySchedule, type LatLng } from "@/lib/shipment-route";

// Leaflet touches `window`, so the map is only ever loaded in the browser.
const ShipmentMap = dynamic(() => import("@/components/shipment-map").then((module) => module.ShipmentMap), {
    ssr: false,
    loading: () => <p className="mt-6 text-sm text-(--ink-soft)">Loading map...</p>,
});

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
const PAGE_SIZE = 20;

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

/**
 * The containers to show for a B/L. Odoo's notes sometimes hold only the B/L (one
 * "(not listed)" placeholder) while the carrier's live tracking knows every container —
 * so containers the carrier reports are added, and the placeholder dropped once any are known.
 */
function containersFor(group: BlGroup, tracking: ShipmentTracking | undefined) {
    const listed = group.containers.filter((container) => container.containerNo);
    const known = new Set(listed.map((container) => container.containerNo.toUpperCase()));
    const orderName = group.orders[0]?.name ?? "";
    const fromTracking = (tracking?.containers ?? [])
        .map((container) => container.number.toUpperCase())
        .filter((number) => number && !known.has(number))
        .map((number) => ({ containerNo: number, sealNo: "", orderName }));
    const merged = [...listed, ...fromTracking];
    return merged.length > 0 ? merged : group.containers;
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

/**
 * Where the cargo ended up when that is beyond the port of discharge. Uses the
 * carrier's delivery place when it was saved, and otherwise the place of the
 * consignee-delivery / empty-return events (e.g. unloaded at Khor al Fakkan, but
 * the empty container came back at Jebel Ali).
 */
function finalDestinationOf(tracking: ShipmentTracking | undefined): string {
    if (!tracking) return "";
    const place = (name: string) => name.trim().toLowerCase().split(",")[0].trim();
    const port = place(tracking.destination?.name ?? "");
    const differs = (name: string) => Boolean(name.trim()) && place(name) !== port;

    if (tracking.finalDestination?.name && differs(tracking.finalDestination.name)) {
        return tracking.finalDestination.name;
    }
    const delivered = allEvents(tracking)
        .filter((event) => event.isActual && event.location && toDate(event.datetime) && /Delivery to Consignee|Empty Container Return|Container Returned|\bDelivered\b/i.test(event.description))
        .sort((a, b) => b.datetime.localeCompare(a.datetime));
    const hit = delivered.find((event) => differs(event.location));
    return hit ? hit.location : "";
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
    const [view, setView] = useState<"list" | "map">("list");
    const [page, setPage] = useState(1);
    // Tyre brands per PO, fetched only for the shipments on the visible page (or when exporting).
    const [brandsByOrder, setBrandsByOrder] = useState<Record<number, string[]>>({});
    // Vendor-bill payment status per PO, fetched only for arrived shipments on screen.
    const [billsByOrder, setBillsByOrder] = useState<Record<number, PoBillStatus>>({});
    const [scrollTarget, setScrollTarget] = useState<string | null>(null);
    const [exporting, setExporting] = useState(false);
    const [exportError, setExportError] = useState<string | null>(null);
    // Sea routes by route key; "failed" keys fall back to a rough lane so they're not retried.
    const [seaRouteError, setSeaRouteError] = useState<string | null>(null);
    const [seaPaths, setSeaPaths] = useState<Record<string, LatLng[][] | null>>({});
    // Port coordinates for names the built-in list doesn't know (geocoded once on the server, then remembered).
    const [portPoints, setPortPoints] = useState<Record<string, LatLng | null>>({});
    const geocodingRef = useRef(false);
    // Map side panel: shipments the user hid from the map (none hidden = all shown).
    const [hiddenBls, setHiddenBls] = useState<Set<string>>(new Set());
    const [mapListSearch, setMapListSearch] = useState("");
    const [mapFocus, setMapFocus] = useState<{ blNumber: string; n: number } | null>(null);
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
                // Fully received in Odoo means it has arrived, whether or not it was ever tracked.
                const received = group.orders.length > 0 && group.orders.every((order) => order.fullyReceived || order.receiptDone);
                const trackedStage = stageOf(tracking);
                const stage: Stage = received && trackedStage !== "delivered" ? "arrived" : trackedStage;
                const eta = etaOf(group, tracking);
                return { group, tracking, stage, eta, received };
            }),
        [groups, tracked]
    );

    const counts = useMemo(() => {
        const result = { soon: 0, transit: 0, arrived: 0, untracked: 0 };
        for (const { tracking, stage, eta, received } of enriched) {
            if (!tracking && !received) result.untracked += 1;
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
    // The list is paged, so the page holding it is opened first (see the scrollTarget effect).
    function showInList(item: (typeof enriched)[number]) {
        setSearch("");
        setFilter(item.stage === "arrived" || item.stage === "delivered" ? "arrived" : "transit");
        setScrollTarget(item.group.blNumber);
    }

    const visible = useMemo(() => {
        const query = search.trim().toLowerCase();
        return enriched
            .filter(({ group, tracking, stage, eta, received }) => {
                if (filter === "untracked" && (tracking || received)) return false;
                if (filter === "transit" && (!(tracking || received) || stage === "arrived" || stage === "delivered")) return false;
                if (filter === "arrived" && (!(tracking || received) || (stage !== "arrived" && stage !== "delivered"))) return false;
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
                    !item.tracking && !item.received ? 3 : item.stage === "arrived" || item.stage === "delivered" ? 2 : item.eta.days !== null && item.eta.days < 0 ? 1 : 0;
                if (rank(a) !== rank(b)) return rank(a) - rank(b);
                // Within a group: nearest arrival first (overdue ones: the most recently due first).
                const ta = a.eta.date?.getTime() ?? Infinity;
                const tb = b.eta.date?.getTime() ?? Infinity;
                return rank(a) === 1 ? tb - ta : ta - tb;
            });
    }, [enriched, filter, search, transitSort]);

    const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
    const currentPage = Math.min(page, pageCount);
    const pagedVisible = useMemo(() => visible.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE), [visible, currentPage]);

    // A new filter / search / sort starts again from the first page.
    useEffect(() => {
        setPage(1);
    }, [filter, search, transitSort, includeReceived]);

    // Open the page that holds the requested shipment, then scroll to it and flash it.
    useEffect(() => {
        if (!scrollTarget || view !== "list") return;
        const index = visible.findIndex((item) => item.group.blNumber === scrollTarget);
        if (index < 0) return;
        const targetPage = Math.floor(index / PAGE_SIZE) + 1;
        if (currentPage !== targetPage) {
            setPage(targetPage);
            return;
        }
        const target = scrollTarget;
        const timer = window.setTimeout(() => {
            document.getElementById(`bl-${target}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
            setHighlighted(target);
            window.setTimeout(() => setHighlighted((current) => (current === target ? null : current)), 2500);
            setScrollTarget(null);
        }, 150);
        return () => window.clearTimeout(timer);
    }, [scrollTarget, visible, currentPage, view]);

    // Brands are read from Odoo only for the shipments on screen.
    useEffect(() => {
        const need = new Set<number>();
        const pinned = resultBl ? enriched.find((item) => item.group.blNumber === resultBl) : undefined;
        for (const { group } of [...pagedVisible, ...(pinned ? [pinned] : [])]) {
            for (const order of group.orders) {
                if (brandsByOrder[order.id] === undefined) need.add(order.id);
            }
        }
        if (need.size === 0) return;
        let cancelled = false;
        getPoBrands(Array.from(need))
            .then((data) => {
                if (cancelled) return;
                setBrandsByOrder((current) => {
                    const next = { ...current };
                    for (const id of need) next[id] = data.brands[String(id)] ?? [];
                    return next;
                });
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [pagedVisible, brandsByOrder, resultBl, enriched]);

    useEffect(() => {
        const need = new Set<number>();
        const pinned = resultBl ? enriched.find((item) => item.group.blNumber === resultBl) : undefined;
        for (const { group, stage } of [...pagedVisible, ...(pinned ? [pinned] : [])]) {
            if (stage !== "arrived" && stage !== "delivered") continue;
            for (const order of group.orders) {
                if (billsByOrder[order.id] === undefined) need.add(order.id);
            }
        }
        if (need.size === 0) return;
        let cancelled = false;
        getPoBills(Array.from(need))
            .then((data) => {
                if (cancelled) return;
                setBillsByOrder((current) => {
                    const next = { ...current };
                    for (const id of need) next[id] = data.bills[String(id)] ?? { state: "no_bill", count: 0, billNames: [] };
                    return next;
                });
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [pagedVisible, billsByOrder, resultBl, enriched]);

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

    const renderCard = ({ group, tracking, stage, eta, received }: (typeof enriched)[number], pinned = false) => {
                    const isOpen = pinned || expanded.has(group.blNumber);
                    const isUpdating = updating.has(group.blNumber);
                    const error = trackingErrors[group.blNumber];
                    const chip = received && !tracking ? { text: "Received", className: "bg-emerald-100 text-emerald-800" } : etaChip(eta.days, stage);
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
                                        <p className="mt-2 inline-flex items-center gap-2 rounded-lg bg-(--chip) px-2.5 py-1 text-sm">
                                            <span className="text-(--ink-soft)">B/L</span>
                                            <span className="font-semibold tracking-wide">{group.blNumber}</span>
                                        </p>
                                        {(() => {
                                            const brands = Array.from(new Set(group.orders.flatMap((order) => brandsByOrder[order.id] ?? []))).sort((a, b) => a.localeCompare(b));
                                            return brands.length > 0 ? (
                                                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                                    <span className="text-xs text-(--ink-soft)">Brands</span>
                                                    {brands.map((brand) => (
                                                        <span key={brand} className="rounded-full border border-(--line) bg-white px-2.5 py-0.5 text-xs font-medium">
                                                            {brand}
                                                        </span>
                                                    ))}
                                                </div>
                                            ) : null;
                                        })()}
                                        {stage === "arrived" || stage === "delivered" ? (
                                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                                <span className="text-xs text-(--ink-soft)">Vendor bill</span>
                                                {group.orders.map((order) => {
                                                    const bill = billsByOrder[order.id];
                                                    const label = !bill
                                                        ? "…"
                                                        : ({ paid: "Paid", in_payment: "In payment", partial: "Partially paid", not_paid: "Not paid", no_bill: "No bill" } as Record<string, string>)[bill.state] ?? bill.state;
                                                    const tone =
                                                        bill?.state === "paid" || bill?.state === "in_payment"
                                                            ? "bg-emerald-100 text-emerald-800"
                                                            : bill?.state === "partial"
                                                              ? "bg-amber-100 text-amber-800"
                                                              : bill?.state === "not_paid"
                                                                ? "bg-red-100 text-red-700"
                                                                : "bg-(--chip) text-(--ink-soft)";
                                                    return (
                                                        <span key={order.id} className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${tone}`} title={bill?.billNames.join(", ")}>
                                                            {group.orders.length > 1 ? `${order.name}: ` : ""}
                                                            {label}
                                                        </span>
                                                    );
                                                })}
                                            </div>
                                        ) : null}
                                        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
                                            <Fact icon={<Container className="h-4 w-4" />} label="Containers" value={String(containersFor(group, tracking).length)} />
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
                                        {finalDestinationOf(tracking) ? (
                                            <p className="mt-1.5 flex items-center justify-end gap-1.5 text-sm">
                                                <MapPin className="h-4 w-4 text-(--brand)" aria-hidden="true" />
                                                <span className="text-(--ink-soft)">Final destination</span>
                                                <span className="font-semibold">{finalDestinationOf(tracking)}</span>
                                            </p>
                                        ) : null}
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
                                    <p className="px-5 pb-4 text-sm text-(--ink-soft)">
                                        {received ? "Received in Odoo." : "Not tracked yet — press Track to get the latest position."}
                                    </p>
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
                                        {stage === "arrived" || stage === "delivered" ? null : (
                                            <button
                                                type="button"
                                                onClick={() => void updateOne(group.blNumber)}
                                                disabled={isUpdating || busy}
                                                className="inline-flex items-center gap-2 rounded-xl border border-(--line) bg-white px-3 py-1.5 text-sm font-medium disabled:opacity-60"
                                            >
                                                <RefreshCw className={`h-4 w-4 ${isUpdating ? "animate-spin" : ""}`} />
                                                {tracking ? "Update" : "Track"}
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {isOpen ? <Details group={group} tracking={tracking} /> : null}
                            </div>
                        </article>
        );
    };

    // Map data comes entirely from what's already saved — no tracking requests.
    const stopsOf = useCallback(
        (tracking: ShipmentTracking) => {
            const raw = [
                { name: tracking.origin?.name ?? "", at: tracking.origin?.at, arrive: null as string | null, depart: tracking.origin?.departure ?? null },
                ...tracking.transshipments.map((stop) => ({ name: stop.name, at: stop.at, arrive: stop.arrival || null, depart: stop.departure || null })),
                { name: tracking.destination?.name ?? "", at: tracking.destination?.at, arrive: tracking.destination?.arrival ?? null, depart: null as string | null },
            ];
            return raw.map((stop) => ({
                ...stop,
                at: (stop.at ?? lookupPort(stop.name) ?? portPoints[stop.name] ?? null) as LatLng | null,
            }));
        },
        [portPoints]
    );

    const mapCandidates = useMemo(
        () =>
            visible.filter(
                (item): item is typeof item & { tracking: ShipmentTracking } => Boolean(item.tracking?.origin?.name && item.tracking.destination?.name)
            ),
        [visible]
    );

    // Look up the ports the built-in list doesn't know (the server remembers every answer).
    useEffect(() => {
        if (view !== "map" || geocodingRef.current) return;
        const unknown = new Set<string>();
        for (const { tracking } of mapCandidates) {
            for (const stop of stopsOf(tracking)) {
                if (stop.name && !stop.at && portPoints[stop.name] === undefined) unknown.add(stop.name);
            }
        }
        if (unknown.size === 0) return;
        geocodingRef.current = true;
        geocodePorts(Array.from(unknown))
            .then((data) => setPortPoints((current) => ({ ...current, ...data.points })))
            .catch(() => setPortPoints((current) => ({ ...current, ...Object.fromEntries(Array.from(unknown, (name) => [name, null])) })))
            .finally(() => {
                geocodingRef.current = false;
            });
    }, [view, mapCandidates, stopsOf, portPoints]);

    const resolvedCandidates = useMemo(() => {
        const items: Array<{ item: (typeof mapCandidates)[number]; stops: Array<{ name: string; at: LatLng; arrive: string | null; depart: string | null }>; routeKey: string }> = [];
        for (const item of mapCandidates) {
            const stops = stopsOf(item.tracking);
            if (stops.some((stop) => !stop.at)) continue;
            const resolved = stops as Array<{ name: string; at: LatLng; arrive: string | null; depart: string | null }>;
            items.push({ item, stops: resolved, routeKey: resolved.map((stop) => stop.at.join(",")).join(">") });
        }
        return items;
    }, [mapCandidates, stopsOf]);

    // Sea routes between the ports are computed on the server (they route round land).
    useEffect(() => {
        if (view !== "map") return;
        const missing = new Map<string, LatLng[]>();
        for (const { routeKey, stops } of resolvedCandidates) {
            if (seaPaths[routeKey] === undefined) missing.set(routeKey, stops.map((stop) => stop.at));
        }
        if (missing.size === 0) return;
        let cancelled = false;
        getSeaRoutes(Array.from(missing, ([id, stops]) => ({ id, stops })))
            .then((data) => {
                if (cancelled) return;
                setSeaPaths((current) => {
                    const next = { ...current };
                    for (const id of missing.keys()) next[id] = data.paths[id] ?? null;
                    return next;
                });
            })
            .catch((error) => {
                if (cancelled) return;
                setSeaRouteError(error instanceof Error ? error.message : "Sea routing failed.");
                setSeaPaths((current) => {
                    const next = { ...current };
                    for (const id of missing.keys()) next[id] = null;
                    return next;
                });
            });
        return () => {
            cancelled = true;
        };
    }, [view, resolvedCandidates, seaPaths]);

    const routesLoading = resolvedCandidates.some(({ routeKey }) => seaPaths[routeKey] === undefined);
    const portsLoading = mapCandidates.some(({ tracking }) => stopsOf(tracking).some((stop) => stop.name && !stop.at && portPoints[stop.name] === undefined));

    const mapShipments = useMemo<MapShipment[]>(() => {
        const now = Date.now();
        const shipments: MapShipment[] = [];
        for (const { item, stops, routeKey } of resolvedCandidates) {
            const { group, tracking, stage, eta } = item;
            const sea = seaPaths[routeKey];
            if (sea === undefined) continue;
            // If sea routing failed, fall back to straight port-to-port lines.
            const legs: LatLng[][] = sea ?? stops.slice(0, -1).map((stop, index) => [stop.at, stops[index + 1].at]);

            const time = (value: string | null) => toDate(value)?.getTime() ?? null;
            const schedule = stops.map((stop, index) => ({
                at: stop.at,
                arrive: index === stops.length - 1 ? eta.date?.getTime() ?? time(stop.arrive) : time(stop.arrive),
                depart: time(stop.depart),
            }));
            const finished = stage === "arrived" || stage === "delivered";
            const where = positionBySchedule(legs, schedule, now, finished);

            const legName = `${stops[where.legIndex]?.name ?? ""} → ${stops[where.legIndex + 1]?.name ?? ""}`;
            const positionNote = finished
                ? "Arrived at the destination port."
                : !where.exact
                  ? "Rough estimate: some dates are missing, so progress is spread over the whole voyage."
                  : where.atPort === "port"
                    ? `Waiting at ${stops[where.legIndex]?.name ?? "port"} — leaves ${formatDate(stops[where.legIndex]?.depart)}.`
                    : `Estimated from the saved schedule, sailing ${legName}.`;

            shipments.push({
                blNumber: group.blNumber,
                title: group.orders.map((order) => order.name).join(" · "),
                vendor: group.orders[0]?.vendorName ?? "",
                carrier: tracking.carrierName,
                vessel: tracking.vessels[Math.min(where.legIndex, Math.max(0, tracking.vessels.length - 1))] ?? "",
                origin: tracking.origin?.name ?? "",
                destination: tracking.destination?.name ?? "",
                stage,
                etaText: etaChip(eta.days, stage).text,
                stops: stops.map((stop) => ({ name: stop.name, at: stop.at })),
                legs,
                at: where.at,
                travelled: where.travelled,
                positionNote,
            });
        }
        return shipments;
    }, [resolvedCandidates, seaPaths]);

    const shownOnMap = useMemo(() => mapShipments.filter((item) => !hiddenBls.has(item.blNumber)), [mapShipments, hiddenBls]);
    const mapListRows = useMemo(() => {
        const query = mapListSearch.trim().toLowerCase();
        return query
            ? mapShipments.filter((item) => [item.title, item.blNumber, item.vendor, item.origin, item.destination, item.vessel].some((text) => text.toLowerCase().includes(query)))
            : mapShipments;
    }, [mapShipments, mapListSearch]);

    // On the map the update button follows the ticked shipments; in the list it follows the current filter.
    // Delivered shipments never change again, so they are skipped to save requests.
    const selectionActive = view === "map" && hiddenBls.size > 0;
    const bulkTargets =
        view === "map"
            ? shownOnMap.filter((item) => item.stage !== "delivered").map((item) => item.blNumber)
            : visible.filter(({ stage, tracking, received }) => !(received || (tracking && stage === "delivered"))).map(({ group }) => group.blNumber);

    // The Excel export covers what the current view is showing (all pages, or the ticked map shipments).
    async function exportToExcel() {
        setExporting(true);
        setExportError(null);
        try {
            const mapBls = new Set(shownOnMap.map((item) => item.blNumber));
            const items = view === "map" ? visible.filter((item) => mapBls.has(item.group.blNumber)) : visible;
            if (items.length === 0) throw new Error("There are no shipments to export.");

            // Brands for every exported PO (the page only loaded the ones on screen).
            const brands: Record<number, string[]> = { ...brandsByOrder };
            const missing = Array.from(new Set(items.flatMap((item) => item.group.orders.map((order) => order.id)))).filter((id) => brands[id] === undefined);
            for (let index = 0; index < missing.length; index += 300) {
                const chunk = missing.slice(index, index + 300);
                const data = await getPoBrands(chunk);
                for (const id of chunk) brands[id] = data.brands[String(id)] ?? [];
            }
            setBrandsByOrder(brands);

            const city = (name: string | undefined) => (name ?? "").split(",")[0].trim();
            const rows = items.map(({ group, tracking }) => {
                // A PO split over several B/Ls: this B/L carries its share of the PO's value.
                const amount = group.orders.reduce((sum, order) => {
                    const blCount = new Set(order.containers.map((container) => container.blNumber)).size || 1;
                    const declared = order.containers.filter((container) => container.blNumber === group.blNumber).reduce((total, container) => total + container.quantity, 0);
                    const share = declared > 0 && order.totalQty > 0 ? declared / order.totalQty : 1 / blCount;
                    return sum + order.amountTotal * Math.min(1, share);
                }, 0);
                return {
                    bl: group.blNumber,
                    sealine: tracking?.carrierCode ?? "",
                    type: tracking?.referenceType === "BK" ? "BK" : "BL",
                    // Dates are sent exactly as the carrier / Odoo wrote them (no time-zone shift).
                    eta: (tracking?.destination?.arrival || group.orders[0]?.expectedArrival || "").slice(0, 10) || null,
                    etd: (tracking?.origin?.departure || "").slice(0, 10) || null,
                    brand: Array.from(new Set(group.orders.flatMap((order) => brands[order.id] ?? []))).sort((a, b) => a.localeCompare(b)).join(", "),
                    customer: Array.from(new Set(group.orders.map((order) => order.companyName).filter(Boolean))).join(", "),
                    pol: city(tracking?.origin?.name),
                    pod: city(tracking?.destination?.name),
                    vol: containersFor(group, tracking).length,
                    qty: Math.round(group.totalQty),
                    amount: amount > 0 ? Number(amount.toFixed(2)) : null,
                    factory: Array.from(new Set(group.orders.map((order) => order.vendorName).filter(Boolean))).join(", "),
                };
            });

            const blob = await exportPoTrackingExcel(rows);
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `PO-Tracking-${new Date().toISOString().slice(0, 10)}.xlsx`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
        } catch (error) {
            setExportError(error instanceof Error ? error.message : "Export failed.");
        } finally {
            setExporting(false);
        }
    }

    function setMapListVisibility(rows: MapShipment[], visibleOnMap: boolean) {
        setHiddenBls((current) => {
            const next = new Set(current);
            for (const row of rows) {
                if (visibleOnMap) next.delete(row.blNumber);
                else next.add(row.blNumber);
            }
            return next;
        });
    }

    function toggleOnMap(blNumber: string) {
        setHiddenBls((current) => {
            const next = new Set(current);
            if (next.has(blNumber)) next.delete(blNumber);
            else next.add(blNumber);
            return next;
        });
    }

    // Port names that couldn't be placed even after looking them up.
    const unknownPorts = useMemo(() => {
        const names = new Set<string>();
        for (const { tracking } of mapCandidates) {
            for (const stop of stopsOf(tracking)) {
                if (stop.name && !stop.at && portPoints[stop.name] === null) names.add(stop.name);
            }
        }
        return Array.from(names);
    }, [mapCandidates, stopsOf, portPoints]);

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

                <div className="inline-flex overflow-hidden rounded-xl border border-(--line) bg-white" role="group" aria-label="View">
                    <button
                        type="button"
                        onClick={() => setView("list")}
                        aria-pressed={view === "list"}
                        className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm ${view === "list" ? "bg-(--chip) font-medium text-(--brand)" : "text-(--ink-soft)"}`}
                    >
                        <List className="h-4 w-4" aria-hidden="true" />
                        List view
                    </button>
                    <button
                        type="button"
                        onClick={() => setView("map")}
                        aria-pressed={view === "map"}
                        className={`inline-flex items-center gap-1.5 border-l border-(--line) px-3 py-2 text-sm ${view === "map" ? "bg-(--chip) font-medium text-(--brand)" : "text-(--ink-soft)"}`}
                    >
                        <MapIcon className="h-4 w-4" aria-hidden="true" />
                        Map view
                    </button>
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
                        {busy ? `Updating ${bulkProgress.done} of ${bulkProgress.total}` : `${selectionActive ? "Update selected" : "Update all"} (${bulkTargets.length})`}
                    </button>
                )}

                <button
                    type="button"
                    onClick={() => void exportToExcel()}
                    disabled={exporting || (view === "map" ? shownOnMap.length === 0 : visible.length === 0)}
                    className="inline-flex items-center gap-2 rounded-xl border border-(--line) bg-white px-4 py-2 text-sm font-medium text-(--ink) disabled:opacity-60"
                    title={view === "map" ? "Export the shipments ticked on the map" : "Export every shipment in the current filter"}
                >
                    <Download className={`h-4 w-4 ${exporting ? "animate-pulse" : ""}`} />
                    {exporting ? "Preparing..." : "Export to Excel"}
                </button>
            </div>
            {exportError ? <p className="mt-2 text-sm text-red-600">{exportError}</p> : null}

            <PoCheck />

            {ordersError ? (
                <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{ordersError}</p>
            ) : null}
            {ordersLoading ? (
                <p className="mt-6 flex items-center gap-2 text-sm text-(--ink-soft)" role="status">
                    <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
                    {orders.length === 0 ? "Loading purchase orders from Odoo..." : "Refreshing the list from Odoo..."}
                </p>
            ) : null}
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
            {view === "map" ? (
                <div className="mt-5">
                    {seaRouteError ? (
                        <p className="mb-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                            Sea routing is unavailable ({seaRouteError}), so routes are drawn as rough straight lines and may cross land.
                            If you just updated the app, restart the server.
                        </p>
                    ) : null}
                    {routesLoading || portsLoading ? <p className="mb-2 text-xs text-(--ink-soft)">Plotting routes...</p> : null}
                    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_21rem]">
                        <ShipmentMap
                            shipments={routesLoading || portsLoading ? [] : shownOnMap}
                            focus={mapFocus}
                            onOpen={(blNumber) => {
                                setView("list");
                                const item = enriched.find((entry) => entry.group.blNumber === blNumber);
                                if (item) showInList(item);
                            }}
                        />

                        <aside className="flex h-[34rem] flex-col overflow-hidden rounded-2xl border border-(--line) bg-(--card)" aria-label="Shipments on the map">
                            <div className="border-b border-(--line) p-3">
                                <div className="flex items-center justify-between gap-2">
                                    <p className="text-sm font-semibold">
                                        Shipments <span className="font-normal text-(--ink-soft)">· {shownOnMap.length} of {mapShipments.length} on map</span>
                                    </p>
                                </div>
                                <div className="relative mt-2">
                                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-(--ink-soft)" />
                                    <input
                                        value={mapListSearch}
                                        onChange={(event) => setMapListSearch(event.target.value)}
                                        placeholder="Filter by PO, B/L, vendor, port"
                                        className="w-full rounded-lg border border-(--line) bg-white py-1.5 pl-8 pr-2 text-xs"
                                    />
                                </div>
                                <div className="mt-2 flex gap-2 text-xs">
                                    <button type="button" onClick={() => setMapListVisibility(mapListRows, true)} className="rounded-lg border border-(--line) bg-white px-2.5 py-1 font-medium">
                                        Show all
                                    </button>
                                    <button type="button" onClick={() => setMapListVisibility(mapListRows, false)} className="rounded-lg border border-(--line) bg-white px-2.5 py-1 font-medium">
                                        Hide all
                                    </button>
                                </div>
                            </div>

                            <ul className="flex-1 divide-y divide-(--line) overflow-y-auto">
                                {mapListRows.length === 0 ? (
                                    <li className="p-4 text-center text-xs text-(--ink-soft)">No shipments match.</li>
                                ) : (
                                    mapListRows.map((item) => {
                                        const onMap = !hiddenBls.has(item.blNumber);
                                        return (
                                            <li key={item.blNumber} className={`flex items-start gap-2.5 px-3 py-2.5 ${onMap ? "" : "opacity-55"}`}>
                                                <input
                                                    type="checkbox"
                                                    checked={onMap}
                                                    onChange={() => toggleOnMap(item.blNumber)}
                                                    className="mt-1 h-4 w-4 shrink-0"
                                                    aria-label={`Show ${item.title} on the map`}
                                                />
                                                <div className="min-w-0 flex-1">
                                                    <button
                                                        type="button"
                                                        disabled={!onMap}
                                                        onClick={() => setMapFocus((current) => ({ blNumber: item.blNumber, n: (current?.n ?? 0) + 1 }))}
                                                        className="block w-full text-left disabled:cursor-default"
                                                        title={onMap ? "Zoom to this shipment" : "Tick it to show it on the map"}
                                                    >
                                                        <span className="block truncate text-sm font-semibold">{item.title}</span>
                                                        <span className="block truncate text-xs text-(--ink-soft)">{item.vendor}</span>
                                                    </button>
                                                    <p className="mt-0.5 truncate text-xs">
                                                        {item.origin.split(",")[0]} → {item.destination.split(",")[0]}
                                                    </p>
                                                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-(--ink-soft)">
                                                        <span>B/L {item.blNumber}</span>
                                                        <span className="font-medium text-(--ink)">{item.etaText}</span>
                                                    </p>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setHiddenBls(new Set(mapShipments.filter((other) => other.blNumber !== item.blNumber).map((other) => other.blNumber)));
                                                        setMapFocus((current) => ({ blNumber: item.blNumber, n: (current?.n ?? 0) + 1 }));
                                                    }}
                                                    className="shrink-0 rounded-md border border-(--line) px-1.5 py-0.5 text-[11px] text-(--ink-soft) hover:text-(--brand)"
                                                    title="Show only this shipment"
                                                >
                                                    Only
                                                </button>
                                            </li>
                                        );
                                    })
                                )}
                            </ul>
                        </aside>
                    </div>
                    <p className="mt-2 text-xs text-(--ink-soft)">
                        Estimated from the schedule already saved for each shipment (departure, transshipment and arrival dates) along real sea
                        lanes — nothing is requested from the tracking service, and these aren&rsquo;t live vessel positions. Click a ship for its
                        details and a VesselFinder link.
                    </p>
                    {!routesLoading && !portsLoading && visible.length - mapShipments.length > 0 ? (
                        <p className="mt-1 text-xs text-(--ink-soft)">
                            Not on the map: {visible.length - mapCandidates.length} not tracked yet (no saved ports — press Update on them) and{" "}
                            {mapCandidates.length - mapShipments.length} tracked but with a port that couldn&rsquo;t be located.
                        </p>
                    ) : null}
                    {unknownPorts.length > 0 ? (
                        <p className="mt-1 text-xs text-amber-700">
                            Couldn&rsquo;t locate: {unknownPorts.slice(0, 12).join(" · ")}
                            {unknownPorts.length > 12 ? ` · +${unknownPorts.length - 12} more` : ""}
                        </p>
                    ) : null}
                </div>
            ) : (
                <div className="mt-5">
                    {pageCount > 1 ? (
                        <nav className="mt-5 flex flex-wrap items-center justify-between gap-3" aria-label="Pages">
                            <p className="text-sm text-(--ink-soft)">
                                Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, visible.length)} of {visible.length} shipments
                            </p>
                            <div className="flex items-center gap-1">
                                <button
                                    type="button"
                                    onClick={() => setPage(currentPage - 1)}
                                    disabled={currentPage <= 1}
                                    className="inline-flex items-center gap-1 rounded-lg border border-(--line) bg-white px-2.5 py-1.5 text-sm disabled:opacity-50"
                                >
                                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                                    Prev
                                </button>
                                {Array.from({ length: pageCount }, (_, index) => index + 1)
                                    .filter((number) => number === 1 || number === pageCount || Math.abs(number - currentPage) <= 1)
                                    .map((number, index, shown) => (
                                        <span key={number} className="flex items-center gap-1">
                                            {index > 0 && number - shown[index - 1] > 1 ? <span className="px-1 text-(--ink-soft)">…</span> : null}
                                            <button
                                                type="button"
                                                onClick={() => setPage(number)}
                                                aria-current={number === currentPage ? "page" : undefined}
                                                className={`min-w-9 rounded-lg border px-2.5 py-1.5 text-sm ${
                                                    number === currentPage ? "border-(--brand) bg-(--brand) font-medium text-white" : "border-(--line) bg-white"
                                                }`}
                                            >
                                                {number}
                                            </button>
                                        </span>
                                    ))}
                                <button
                                    type="button"
                                    onClick={() => setPage(currentPage + 1)}
                                    disabled={currentPage >= pageCount}
                                    className="inline-flex items-center gap-1 rounded-lg border border-(--line) bg-white px-2.5 py-1.5 text-sm disabled:opacity-50"
                                >
                                    Next
                                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                                </button>
                            </div>
                        </nav>
                    ) : null}
                    <div className={`${pageCount > 1 ? "mt-4 " : ""}space-y-4 transition-opacity ${ordersLoading ? "pointer-events-none opacity-50" : ""}`}>
                        {pagedVisible.map((item) => renderCard(item))}
                    </div>
                </div>
            )}

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
                        {containersFor(group, tracking).map((container) => {
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
                                    <dt className="text-(--ink-soft)">Notes fields read</dt>
                                    <dd className="break-words">{result.notesFieldNames.length ? result.notesFieldNames.join(", ") : "none found"}</dd>
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
