"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { searchSalesOrder, sendPendingOrderEmail } from "@/lib/client-odoo";
import { BackorderStatus, SavedBackorder, SalesOrderMatch } from "@/types/odoo";

function formatDate(value: string | undefined) {
    if (!value) {
        return "-";
    }

    return value.slice(0, 10);
}

function formatDateTime(value: string | undefined) {
    if (!value) {
        return "-";
    }

    return value.replace("T", " ").slice(0, 16);
}

function formatCurrency(value: number) {
    return `AED ${value.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;
}

function summarizeBackorder(backorder: SavedBackorder) {
    return backorder.products.reduce(
        (summary, product) => {
            summary.totalItems += 1;
            summary.totalShortage += Number(product.shortage ?? 0);
            summary.totalValue += Number(product.price ?? 0) * Number(product.shortage ?? 0);
            return summary;
        },
        {
            totalItems: 0,
            totalShortage: 0,
            totalValue: 0,
        }
    );
}

function normalizeStatus(value: SavedBackorder["status"]): BackorderStatus {
    if (value === "ready" || value === "partial" || value === "procced") {
        return value;
    }

    return "pendding";
}

function getStatusMeta(status: BackorderStatus) {
    if (status === "procced") {
        return {
            label: "Procced",
            progress: 100,
            barClassName: "bg-sky-500",
            badgeClassName: "bg-sky-100 text-sky-700",
        };
    }

    if (status === "ready") {
        return {
            label: "Ready",
            progress: 100,
            barClassName: "bg-emerald-500",
            badgeClassName: "bg-emerald-100 text-emerald-700",
        };
    }

    if (status === "partial") {
        return {
            label: "Partial",
            progress: 55,
            barClassName: "bg-amber-500",
            badgeClassName: "bg-amber-100 text-amber-700",
        };
    }

    return {
        label: "Pendding",
        progress: 20,
        barClassName: "bg-slate-400",
        badgeClassName: "bg-slate-100 text-slate-700",
    };
}

function SavedBackorderCard({ backorder }: { backorder: SavedBackorder }) {
    const summary = summarizeBackorder(backorder);
    const detailsHref = `/orders/pending/manual/${backorder.id}`;
    const sourceLabel = backorder.source === "manual" ? "Manual" : "From Odoo";
    const status = normalizeStatus(backorder.status);
    const statusMeta = getStatusMeta(status);
    const categoryLabels = Array.from(
        new Set(
            backorder.products
                .map((product) => String(product.category_name ?? "").trim())
                .filter((value) => Boolean(value))
        )
    );
    const categoryChipClasses = [
        "border-rose-200 bg-rose-50 text-rose-700",
        "border-amber-200 bg-amber-50 text-amber-700",
        "border-emerald-200 bg-emerald-50 text-emerald-700",
        "border-sky-200 bg-sky-50 text-sky-700",
        "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700",
        "border-indigo-200 bg-indigo-50 text-indigo-700",
    ];

    return (
        <article className="flex h-full flex-col rounded-[1.75rem] border border-(--line) bg-linear-to-br from-white to-(--card) p-5 shadow-sm shadow-slate-200/60">
            <div className="mb-4 h-2 overflow-hidden rounded-full bg-slate-200">
                <div
                    className={`h-full rounded-full transition-all ${statusMeta.barClassName}`}
                    style={{ width: `${statusMeta.progress}%` }}
                />
            </div>
            <div className="flex items-start justify-between gap-3">
                <div>
                    <p className="text-xs font-medium uppercase tracking-[0.2em] text-(--accent)">Saved Backorder</p>
                    <p className="mt-2 text-xl font-semibold text-(--ink)">{backorder.order_number}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                        {categoryLabels.length > 0 ? (
                            categoryLabels.slice(0, 6).map((label, index) => (
                                <span
                                    key={label}
                                    className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${categoryChipClasses[index % categoryChipClasses.length]}`}
                                >
                                    {label}
                                </span>
                            ))
                        ) : (
                            <span className="rounded-full border border-slate-300 bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-700">
                                Uncategorized
                            </span>
                        )}
                        {categoryLabels.length > 6 ? (
                            <span className="rounded-full border border-(--line) bg-(--chip) px-2.5 py-1 text-[11px] font-medium text-(--ink-soft)">
                                +{categoryLabels.length - 6} more
                            </span>
                        ) : null}
                    </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                    <span className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${statusMeta.badgeClassName}`}>
                        {statusMeta.label}
                    </span>
                    <span className="rounded-full bg-(--chip) px-3 py-1 text-xs font-medium text-(--ink-soft)">
                        {summary.totalItems} items
                    </span>
                    <span className="rounded-full bg-[rgba(32,98,176,0.08)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-(--brand)">
                        {sourceLabel}
                    </span>
                </div>
            </div>

            <div className="mt-4 space-y-2 text-sm text-(--ink-soft)">
                <p>
                    Customer: <span className="font-medium text-(--ink)">{backorder.customer_name}</span>
                </p>
                <p>
                    Salesperson: <span className="font-medium text-(--ink)">{backorder.salesperson_name}</span>
                </p>
                <p>
                    Order Date: <span className="font-medium text-(--ink)">{formatDate(backorder.order_date)}</span>
                </p>
                <p>
                    Saved At: <span className="font-medium text-(--ink)">{formatDateTime(backorder.saved_at)}</span>
                </p>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-(--chip) p-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-(--ink-soft)">Shortage Qty</p>
                    <p className="mt-2 text-lg font-semibold text-(--ink)">{summary.totalShortage}</p>
                </div>
                <div className="rounded-2xl bg-(--chip) p-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-(--ink-soft)">Shortage Value</p>
                    <p className="mt-2 text-lg font-semibold text-(--ink)">{formatCurrency(summary.totalValue)}</p>
                </div>
            </div>

            <p className="mt-4 text-sm text-(--ink-soft)">Products are shown only after opening the saved backorder.</p>

            <Link
                href={detailsHref}
                className="mt-5 inline-flex items-center justify-center rounded-xl bg-(--brand) px-4 py-2 text-sm font-medium text-white"
            >
                Open Saved Backorder
            </Link>
        </article>
    );
}

export default function PendingOrdersPage() {
    const PAGE_SIZE = 12;
    const { user } = useAuth();

    const [salesOrderNumber, setSalesOrderNumber] = useState("");
    const [matchedOrder, setMatchedOrder] = useState<SalesOrderMatch | null>(null);
    const [searching, setSearching] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [info, setInfo] = useState<string | null>(null);

    const [savedBackorders, setSavedBackorders] = useState<SavedBackorder[]>([]);
    const [loadingSaved, setLoadingSaved] = useState(true);
    const [savedSearch, setSavedSearch] = useState("");
    const [appliedSavedSearch, setAppliedSavedSearch] = useState("");
    const [selectedStatusFilter, setSelectedStatusFilter] = useState<"all" | BackorderStatus>("all");
    const [currentPage, setCurrentPage] = useState(1);
    const [hasNextPage, setHasNextPage] = useState(false);
    const [pageCursorByPage, setPageCursorByPage] = useState<Record<number, string | null>>({ 1: null });
    const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
    const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">("unsupported");
    const [inAppNotice, setInAppNotice] = useState<{ title: string; body: string } | null>(null);

    const previousStatusesRef = useRef<Record<string, BackorderStatus>>({});
    const didHydrateStatusesRef = useRef(false);
    const inAppNoticeTimerRef = useRef<number | null>(null);
    const refreshInFlightRef = useRef(false);

    function clearInAppNoticeTimer() {
        if (inAppNoticeTimerRef.current !== null) {
            window.clearTimeout(inAppNoticeTimerRef.current);
            inAppNoticeTimerRef.current = null;
        }
    }

    function playInAppNotificationTone() {
        if (typeof window === "undefined") {
            return;
        }

        try {
            const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
            if (!AudioCtx) {
                return;
            }

            const context = new AudioCtx();
            void context.resume();

            const oscillator = context.createOscillator();
            const gainNode = context.createGain();

            oscillator.type = "sine";
            oscillator.frequency.setValueAtTime(880, context.currentTime);
            oscillator.frequency.exponentialRampToValueAtTime(660, context.currentTime + 0.2);

            gainNode.gain.setValueAtTime(0.0001, context.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.02);
            gainNode.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.22);

            oscillator.connect(gainNode);
            gainNode.connect(context.destination);

            oscillator.start();
            oscillator.stop(context.currentTime + 0.23);

            window.setTimeout(() => {
                void context.close();
            }, 300);
        } catch {
            // Ignore audio playback failures (browser policy/device settings).
        }
    }

    function showInAppNotice(title: string, body: string) {
        setInAppNotice({ title, body });
        clearInAppNoticeTimer();
        inAppNoticeTimerRef.current = window.setTimeout(() => {
            setInAppNotice(null);
            inAppNoticeTimerRef.current = null;
        }, 4500);
    }

    async function maybeNotifyStatusChange(
        backorder: SavedBackorder,
        fromStatus: BackorderStatus,
        toStatus: BackorderStatus
    ) {
        const fromMeta = getStatusMeta(fromStatus);
        const toMeta = getStatusMeta(toStatus);
        const message = `Status changed: ${fromMeta.label} -> ${toMeta.label}`;
        const productLines = backorder.products.map((product) => ({
            name: product.name || "-",
            orderedQuantity: Number(product.ordered_quantity ?? 0),
            availableQuantity: Number(product.available_quantity ?? 0),
            shortage: Number(product.shortage ?? 0),
        }));

        showInAppNotice(`Backorder ${backorder.order_number} updated`, message);
        playInAppNotificationTone();

        if (typeof window === "undefined" || !("Notification" in window)) {
            try {
                await sendPendingOrderEmail({
                    orderId: backorder.order_id,
                    orderNumber: backorder.order_number,
                    customerName: backorder.customer_name,
                    salespersonName: backorder.salesperson_name,
                    previousStatus: fromStatus,
                    currentStatus: toStatus,
                    products: productLines,
                });
                setInfo(`Backorder ${backorder.order_number}: ${fromMeta.label} -> ${toMeta.label}. Store email sent.`);
            } catch {
                setInfo(`Backorder ${backorder.order_number}: ${fromMeta.label} -> ${toMeta.label}`);
            }

            return;
        }

        if (window.Notification.permission === "granted") {
            void new window.Notification(`Backorder ${backorder.order_number} updated`, {
                body: message,
                tag: `backorder-status-${backorder.id}`,
                silent: false,
                requireInteraction: true,
            });
        }

        try {
            await sendPendingOrderEmail({
                orderId: backorder.order_id,
                orderNumber: backorder.order_number,
                customerName: backorder.customer_name,
                salespersonName: backorder.salesperson_name,
                previousStatus: fromStatus,
                currentStatus: toStatus,
                products: productLines,
            });
            setInfo(`Backorder ${backorder.order_number}: ${fromMeta.label} -> ${toMeta.label}. Store email sent.`);
        } catch {
            setInfo(`Backorder ${backorder.order_number}: ${fromMeta.label} -> ${toMeta.label}`);
        }
    }

    useEffect(() => {
        return () => {
            clearInAppNoticeTimer();
        };
    }, []);

    const visibleSavedBackorders = useMemo(() => savedBackorders, [savedBackorders]);

    const statusFilteredBackorders = useMemo(() => {
        if (selectedStatusFilter === "all") {
            return visibleSavedBackorders;
        }

        return visibleSavedBackorders.filter(
            (backorder) => normalizeStatus(backorder.status) === selectedStatusFilter
        );
    }, [selectedStatusFilter, visibleSavedBackorders]);

    async function loadSavedBackordersPage(
        page: number,
        searchQuery: string,
        statusFilter: "all" | BackorderStatus,
        options?: { silent?: boolean; background?: boolean }
    ) {
        if (!user) {
            return;
        }

        if (refreshInFlightRef.current) {
            return;
        }

        const silent = Boolean(options?.silent);
        const background = Boolean(options?.background);

        refreshInFlightRef.current = true;

        if (!silent) {
            setLoadingSaved(true);
        }

        if (!background) {
            setError(null);
        }

        try {
            const normalizedSearch = searchQuery.trim();
            const isSearchMode = normalizedSearch.length > 0;
            const isStatusFilterMode = statusFilter !== "all";
            const cursor = !isSearchMode && !isStatusFilterMode ? pageCursorByPage[page] ?? null : null;
            const params = new URLSearchParams({ limit: String(PAGE_SIZE) });

            if (cursor) {
                params.set("cursor", cursor);
            }
            if (isSearchMode) {
                params.set("search", normalizedSearch);
            }
            if (isStatusFilterMode) {
                params.set("status", statusFilter);
            }
            if (isSearchMode && !isStatusFilterMode) {
                params.set("page", String(page));
            }

            const idToken = await user.getIdToken();
            const response = await fetch(`/api/backorders?${params.toString()}`, {
                cache: "no-store",
                headers: {
                    Authorization: `Bearer ${idToken}`,
                },
            });
            const result = (await response.json()) as {
                items?: SavedBackorder[];
                nextCursor?: string | null;
                hasNextPage?: boolean;
                error?: string;
            };

            if (!response.ok || result.error) {
                throw new Error(result.error ?? "Failed to load saved backorders.");
            }

            const nextItems = result.items ?? [];
            const nextStatuses = nextItems.reduce<Record<string, BackorderStatus>>((acc, backorder) => {
                acc[backorder.id] = normalizeStatus(backorder.status);
                return acc;
            }, {});

            if (didHydrateStatusesRef.current) {
                for (const backorder of nextItems) {
                    const previousStatus = previousStatusesRef.current[backorder.id];
                    const currentStatusValue = nextStatuses[backorder.id];
                    if (previousStatus && previousStatus !== currentStatusValue) {
                        void maybeNotifyStatusChange(backorder, previousStatus, currentStatusValue);
                    }
                }
            }

            previousStatusesRef.current = nextStatuses;
            didHydrateStatusesRef.current = true;

            setSavedBackorders(nextItems);
            setLastSyncedAt(new Date().toISOString());
            setHasNextPage(isStatusFilterMode || isSearchMode ? false : Boolean(result.hasNextPage));
            setCurrentPage(isStatusFilterMode || isSearchMode ? 1 : page);

            if (!isSearchMode && !isStatusFilterMode) {
                setPageCursorByPage((current) => {
                    const next = { ...current };
                    next[page] = cursor;
                    if (result.nextCursor) {
                        next[page + 1] = result.nextCursor;
                    } else {
                        delete next[page + 1];
                    }
                    return next;
                });
            }
        } catch (loadError) {
            if (!background) {
                setError(loadError instanceof Error ? loadError.message : "Failed to load saved backorders.");
            }
        } finally {
            refreshInFlightRef.current = false;
            if (!silent) {
                setLoadingSaved(false);
            }
        }
    }

    useEffect(() => {
        if (typeof window === "undefined" || !("Notification" in window)) {
            setNotificationPermission("unsupported");
            return;
        }

        setNotificationPermission(window.Notification.permission);
    }, []);

    useEffect(() => {
        if (!user) {
            setLoadingSaved(false);
            setLastSyncedAt(null);
            return;
        }

        setCurrentPage(1);
        setPageCursorByPage({ 1: null });
        setHasNextPage(false);
        setSavedSearch("");
        setAppliedSavedSearch("");
        setSelectedStatusFilter("all");
        void loadSavedBackordersPage(1, "", "all");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user]);

    useEffect(() => {
        if (!user) {
            return;
        }

        setCurrentPage(1);
        setPageCursorByPage({ 1: null });
        setHasNextPage(false);
        void loadSavedBackordersPage(1, appliedSavedSearch, selectedStatusFilter);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedStatusFilter]);

    useEffect(() => {
        if (!user) {
            return;
        }

        let lastRefreshTime = 0;

        function refreshIfNeeded() {
            const now = Date.now();
            if (now - lastRefreshTime < 60_000) {
                return;
            }

            lastRefreshTime = now;
            void loadSavedBackordersPage(currentPage, appliedSavedSearch, selectedStatusFilter, {
                silent: true,
                background: true,
            });
        }

        function handleWindowFocus() {
            refreshIfNeeded();
        }

        function handleVisibilityChange() {
            if (document.visibilityState === "visible") {
                refreshIfNeeded();
            }
        }

        window.addEventListener("focus", handleWindowFocus);
        document.addEventListener("visibilitychange", handleVisibilityChange);

        return () => {
            window.removeEventListener("focus", handleWindowFocus);
            document.removeEventListener("visibilitychange", handleVisibilityChange);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, currentPage, appliedSavedSearch, selectedStatusFilter]);

    useEffect(() => {
        function handleResetToFirstPage() {
            if (!user) {
                return;
            }

            setSavedSearch("");
            setAppliedSavedSearch("");
            setSelectedStatusFilter("all");
            setCurrentPage(1);
            setPageCursorByPage({ 1: null });
            setHasNextPage(false);
            void loadSavedBackordersPage(1, "", "all");
        }

        window.addEventListener("pending-orders-reset-to-first-page", handleResetToFirstPage);
        return () => {
            window.removeEventListener("pending-orders-reset-to-first-page", handleResetToFirstPage);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user]);

    async function handleSearch(event: FormEvent) {
        event.preventDefault();

        if (!user) {
            return;
        }

        setAppliedSavedSearch(savedSearch);
        setCurrentPage(1);
        setPageCursorByPage({ 1: null });
        await loadSavedBackordersPage(1, savedSearch, selectedStatusFilter);
    }

    async function handleRefreshSavedBackorders() {
        if (!user) {
            return;
        }

        await loadSavedBackordersPage(currentPage, appliedSavedSearch, selectedStatusFilter);
    }

    async function handleSearchOrder(event: FormEvent) {
        event.preventDefault();

        if (!user) {
            return;
        }

        setSearching(true);
        setError(null);
        setInfo(null);
        setMatchedOrder(null);

        try {
            const data = await searchSalesOrder(salesOrderNumber);
            if (!data.order) {
                setInfo("No matching sales order number was found.");
                return;
            }

            setMatchedOrder(data.order);
        } catch (searchError) {
            setError(searchError instanceof Error ? searchError.message : "Failed to search order.");
        } finally {
            setSearching(false);
        }
    }

    async function handleEnableNotifications() {
        if (typeof window === "undefined" || !("Notification" in window)) {
            setNotificationPermission("unsupported");
            setInfo("Desktop notifications are not supported in this browser.");
            return;
        }

        if (!window.isSecureContext) {
            setInfo("Desktop notifications require a secure context (HTTPS or localhost).");
            return;
        }

        const currentPermission = window.Notification.permission;
        setNotificationPermission(currentPermission);

        if (currentPermission === "granted") {
            setInfo("Desktop notifications are already enabled.");
            return;
        }

        if (currentPermission === "denied") {
            setInfo("Desktop notifications are blocked in browser settings. Allow notifications for this site, then try again.");
            return;
        }

        setInfo("Requesting desktop notification permission...");

        try {
            const permission = await Promise.resolve(window.Notification.requestPermission());
            const effectivePermission = window.Notification.permission ?? permission;
            setNotificationPermission(effectivePermission);

            if (effectivePermission === "granted") {
                setInfo("Desktop notifications enabled.");
                return;
            }

            if (effectivePermission === "denied") {
                setInfo("Desktop notifications were denied. Please allow them in browser site settings.");
                return;
            }

            setInfo("Desktop notification permission is still pending.");
        } catch {
            setInfo("Unable to request notification permission in this browser context.");
        }
    }

    async function handleTestNotification() {
        if (typeof window === "undefined" || !("Notification" in window)) {
            setInfo("Desktop notifications are not supported in this browser.");
            return;
        }

        if (!window.isSecureContext) {
            setInfo("Desktop notifications require a secure context (HTTPS or localhost).");
            return;
        }

        if (window.Notification.permission === "default") {
            await handleEnableNotifications();
        }

        setNotificationPermission(window.Notification.permission);

        if (window.Notification.permission !== "granted") {
            if (window.Notification.permission === "denied") {
                setInfo("Desktop notifications are denied. Allow notifications in browser site settings.");
                return;
            }

            setInfo("Please enable desktop notifications first.");
            return;
        }

        void new window.Notification("Backorder notification test", {
            body: "Desktop notifications are working.",
            tag: "backorder-notification-test",
            silent: false,
            requireInteraction: true,
        });

        showInAppNotice("Backorder notification test", "Desktop notifications are working.");
        playInAppNotificationTone();
        setInfo("Test notification sent.");
    }

    return (
        <section className="max-w-6xl">
            <div
                className={`fixed right-4 top-4 z-50 w-[min(92vw,22rem)] rounded-2xl border border-emerald-200 bg-white/95 p-4 shadow-lg shadow-slate-300/50 backdrop-blur transition-all duration-300 ${inAppNotice ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-3 opacity-0"
                    }`}
                aria-live="polite"
                role="status"
            >
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700">Notification</p>
                <p className="mt-1 text-sm font-semibold text-(--ink)">{inAppNotice?.title ?? ""}</p>
                <p className="mt-1 text-sm text-(--ink-soft)">{inAppNotice?.body ?? ""}</p>
            </div>

            <h1 className="font-display text-3xl">Pending Orders</h1>
            <p className="mt-1 text-sm text-(--ink-soft)">Search by sales order number and create backorder view.</p>

            <form onSubmit={handleSearchOrder} className="mt-6 rounded-2xl border border-(--line) bg-(--card) p-4">
                <label className="block">
                    <span className="mb-2 block text-sm font-medium">Enter Sales Order Number</span>
                    <div className="flex items-center gap-2">
                        <input
                            value={salesOrderNumber}
                            onChange={(event) => setSalesOrderNumber(event.target.value)}
                            placeholder="Example: S00045"
                            required
                            className="min-w-0 flex-1 rounded-xl border border-(--line) bg-white px-3 py-2"
                        />
                        <button
                            type="submit"
                            disabled={searching}
                            className="shrink-0 rounded-xl bg-(--brand) px-4 py-2 text-sm font-medium text-white"
                        >
                            {searching ? "Searching..." : "Search"}
                        </button>
                        <Link
                            href="/orders/pending/manual"
                            className="inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-xl border border-(--line) bg-white px-4 py-2 text-sm font-medium text-(--ink)"
                        >
                            Add Manual Backorder
                        </Link>
                    </div>
                </label>
            </form>

            {error ? <p className="mt-4 text-red-600">{error}</p> : null}
            {info ? <p className="mt-4 text-sm text-(--ink-soft)">{info}</p> : null}

            {matchedOrder ? (
                <article className="mt-6 rounded-2xl border border-(--line) bg-(--card) p-5">
                    <p className="text-sm text-(--ink-soft)">Matched Sales Order</p>
                    <p className="mt-1 text-xl font-semibold">{matchedOrder.name}</p>
                    <p className="mt-1 text-sm text-(--ink-soft)">Customer: {matchedOrder.partner_id?.[1] ?? "-"}</p>
                    <p className="text-sm text-(--ink-soft)">Date: {formatDate(matchedOrder.date_order)}</p>

                    <Link
                        href={`/orders/${matchedOrder.id}`}
                        className="mt-4 inline-flex rounded-xl bg-(--brand) px-4 py-2 text-sm font-medium text-white"
                    >
                        Backorder
                    </Link>
                </article>
            ) : null}

            <div className="mt-8">
                <div className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
                    <div>
                        <h2 className="font-display text-2xl">Saved Backorders</h2>
                        <p className="mt-1 text-sm text-(--ink-soft)">All backorders saved in Firestore.</p>
                        <p className="mt-1 text-xs text-(--ink-soft)">
                            Last synced: {lastSyncedAt ? formatDateTime(lastSyncedAt) : "-"}
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={handleRefreshSavedBackorders}
                            disabled={loadingSaved}
                            className="rounded-xl border border-(--line) bg-white px-3 py-2 text-xs font-semibold text-(--ink) disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {loadingSaved ? "Refreshing..." : "Refresh"}
                        </button>
                        {notificationPermission === "unsupported" ? null : (
                            <>
                                <span className="rounded-full bg-(--chip) px-2.5 py-1 text-[11px] font-medium text-(--ink-soft)">
                                    Permission: {notificationPermission}
                                </span>
                                <button
                                    type="button"
                                    onClick={handleEnableNotifications}
                                    className="rounded-xl border border-(--line) bg-white px-3 py-2 text-xs font-semibold text-(--ink)"
                                >
                                    {notificationPermission === "granted" ? "Notifications Enabled" : "Enable Desktop Notifications"}
                                </button>
                                <button
                                    type="button"
                                    onClick={handleTestNotification}
                                    className="rounded-xl border border-(--line) bg-white px-3 py-2 text-xs font-semibold text-(--ink)"
                                >
                                    Test Desktop Notification
                                </button>
                            </>
                        )}
                    </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-(--line) bg-(--card) p-3">
                    <p className="mr-1 text-xs font-semibold uppercase tracking-[0.12em] text-(--ink-soft)">Status Legend</p>
                    <button
                        type="button"
                        onClick={() => setSelectedStatusFilter("all")}
                        className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${selectedStatusFilter === "all" ? "bg-(--brand) text-white" : "bg-white text-(--ink) border border-(--line)"}`}
                    >
                        All
                    </button>
                    <button
                        type="button"
                        onClick={() => setSelectedStatusFilter("pendding")}
                        className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${selectedStatusFilter === "pendding" ? "bg-slate-500 text-white" : "bg-slate-100 text-slate-700"}`}
                    >
                        <span className="h-2 w-4 rounded-full bg-slate-400" aria-hidden="true" />
                        Pendding
                    </button>
                    <button
                        type="button"
                        onClick={() => setSelectedStatusFilter("partial")}
                        className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${selectedStatusFilter === "partial" ? "bg-amber-500 text-white" : "bg-amber-100 text-amber-700"}`}
                    >
                        <span className="h-2 w-4 rounded-full bg-amber-500" aria-hidden="true" />
                        Partial
                    </button>
                    <button
                        type="button"
                        onClick={() => setSelectedStatusFilter("ready")}
                        className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${selectedStatusFilter === "ready" ? "bg-emerald-500 text-white" : "bg-emerald-100 text-emerald-700"}`}
                    >
                        <span className="h-2 w-4 rounded-full bg-emerald-500" aria-hidden="true" />
                        Ready
                    </button>
                    <button
                        type="button"
                        onClick={() => setSelectedStatusFilter("procced")}
                        className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${selectedStatusFilter === "procced" ? "bg-sky-500 text-white" : "bg-sky-100 text-sky-700"}`}
                    >
                        <span className="h-2 w-4 rounded-full bg-sky-500" aria-hidden="true" />
                        Procced
                    </button>
                </div>

                <div className="mt-4 rounded-2xl border border-(--line) bg-(--card) p-4">
                    <form onSubmit={handleSearch} className="block">
                        <label className="block">
                            <span className="mb-2 block text-sm font-medium">Search Saved Backorders</span>
                            <div className="flex items-center gap-2">
                                <input
                                    value={savedSearch}
                                    onChange={(event) => setSavedSearch(event.target.value)}
                                    placeholder="Search across all saved backorders"
                                    className="min-w-0 flex-1 rounded-xl border border-(--line) bg-white px-3 py-2"
                                />
                                <button
                                    type="submit"
                                    className="shrink-0 rounded-xl bg-(--brand) px-4 py-2 text-sm font-medium text-white"
                                >
                                    Search Backorders
                                </button>
                            </div>
                        </label>
                    </form>
                    <p className="mt-2 text-xs text-(--ink-soft)">
                        Showing {statusFilteredBackorders.length} result{statusFilteredBackorders.length === 1 ? "" : "s"}
                        {selectedStatusFilter === "all" ? " on this page." : " across all backorders."}
                    </p>
                </div>

                {loadingSaved ? <p className="mt-4 text-sm">Loading saved backorders...</p> : null}

                {!loadingSaved && savedBackorders.length === 0 ? (
                    <p className="mt-4 text-sm text-(--ink-soft)">No saved backorders yet.</p>
                ) : null}

                {!loadingSaved && savedBackorders.length > 0 && selectedStatusFilter === "all" ? (
                    <div className="mt-4 flex flex-col items-center justify-between gap-3 rounded-2xl border border-(--line) bg-(--card) p-4 sm:flex-row">
                        <p className="text-sm text-(--ink-soft)">Page {currentPage}</p>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => {
                                    if (currentPage > 1) {
                                        void loadSavedBackordersPage(currentPage - 1, appliedSavedSearch, selectedStatusFilter);
                                    }
                                }}
                                disabled={loadingSaved || currentPage <= 1}
                                className="rounded-xl border border-(--line) bg-white px-3 py-1.5 text-sm font-medium text-(--ink) disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                Previous
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    if (hasNextPage) {
                                        void loadSavedBackordersPage(currentPage + 1, appliedSavedSearch, selectedStatusFilter);
                                    }
                                }}
                                disabled={loadingSaved || !hasNextPage}
                                className="rounded-xl border border-(--line) bg-white px-3 py-1.5 text-sm font-medium text-(--ink) disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                Next
                            </button>
                        </div>
                    </div>
                ) : null}

                <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {statusFilteredBackorders.map((backorder) => (
                        <SavedBackorderCard key={backorder.id} backorder={backorder} />
                    ))}
                </div>
            </div>
        </section>
    );
}
