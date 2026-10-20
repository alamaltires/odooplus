"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useCallback, useRef, useState } from "react";
import { ClipboardList, HandCoins, LayoutDashboard, LogOut, Menu, PackageSearch, Percent, Pin, PinOff, Ship, ScanSearch, Settings, ShoppingBasket, Tag, Target, TrendingUp, UserSearch, Users, X, type LucideIcon } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { CompanySelector } from "@/components/company-selector";
import { APP_DEFINITIONS, defaultAppHrefsForRole } from "@/lib/app-permissions";

// Add new sidebar entries here — each one just needs an icon; the route and
// label live in `APP_DEFINITIONS` (shared with the per-user permissions
// modal in Settings) so both stay in sync automatically.
const ICONS: Record<string, LucideIcon> = {
    "/dashboard": LayoutDashboard,
    "/orders/pending": ClipboardList,
    "/product-scanner": ScanSearch,
    "/product-requests": PackageSearch,
    "/msrp-finder": Tag,
    "/purchase-order": ShoppingBasket,
    "/po-tracking": Ship,
    "/products-performance": TrendingUp,
    "/margin-analytics": Percent,
    "/salesperson-activity": Users,
    "/customer-activity": UserSearch,
    "/sales-targets": Target,
    "/payment-followup": HandCoins,
    "/settings": Settings,
};

const links: Array<{ href: string; label: string; icon: LucideIcon }> = APP_DEFINITIONS.map((app) => ({
    ...app,
    icon: ICONS[app.href] ?? LayoutDashboard,
}));

export function AppShell({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const router = useRouter();
    const { user, role, enabledApps, loading, logout } = useAuth();
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    // Desktop rail: icons only, widens over the page while the mouse is on it and folds again after opening an app.
    const [expanded, setExpanded] = useState(false);
    const [labelsVisible, setLabelsVisible] = useState(false);
    // Pinned: the sidebar stays open and pushes the page instead of overlaying it.
    const [pinned, setPinned] = useState(false);
    const hoverTimer = useRef<number | null>(null);
    const lockedUntilLeave = useRef(false);

    const clearHoverTimer = () => {
        if (hoverTimer.current !== null) {
            window.clearTimeout(hoverTimer.current);
            hoverTimer.current = null;
        }
    };
    const openRail = () => {
        if (lockedUntilLeave.current) return;
        clearHoverTimer();
        hoverTimer.current = window.setTimeout(() => setExpanded(true), 70);
    };
    const closeRail = () => {
        clearHoverTimer();
        hoverTimer.current = window.setTimeout(() => setExpanded(false), 120);
    };

    // Restore the saved choice after mount (reading storage during render would mismatch SSR).
    useEffect(() => {
        const timer = window.setTimeout(() => {
            try {
                setPinned(window.localStorage.getItem("odoopp:sidebarPinned") === "1");
            } catch {
                // storage unavailable: stay unpinned
            }
        }, 0);
        return () => window.clearTimeout(timer);
    }, []);

    const togglePin = () => {
        setPinned((wasPinned) => {
            const next = !wasPinned;
            try {
                window.localStorage.setItem("odoopp:sidebarPinned", next ? "1" : "0");
            } catch {
                // ignore
            }
            return next;
        });
    };

    // Labels that need a real "show/hide" (company selector) appear once the rail is mostly open.
    useEffect(() => {
        if (!expanded && !pinned) {
            const timer = window.setTimeout(() => setLabelsVisible(false), 0);
            return () => window.clearTimeout(timer);
        }
        const timer = window.setTimeout(() => setLabelsVisible(true), 140);
        return () => window.clearTimeout(timer);
    }, [expanded, pinned]);

    // Any navigation (link, redirect, back button) folds the rail again.
    useEffect(() => {
        const timer = window.setTimeout(() => setExpanded(false), 0);
        return () => window.clearTimeout(timer);
    }, [pathname]);

    useEffect(() => clearHoverTimer, []);

    const visibleLinks = useMemo(() => {
        if (role === "admin") {
            return links;
        }

        // A per-user override (set via the permissions modal in Settings)
        // replaces the role default entirely; `/settings` is always kept so
        // a fully-restricted user can still reach their own account instead
        // of being stuck on a blank "Loading..." screen.
        const allowedHrefs = enabledApps ?? defaultAppHrefsForRole(role);
        const effectiveHrefs = allowedHrefs.includes("/settings") ? allowedHrefs : [...allowedHrefs, "/settings"];
        return links.filter((link) => effectiveHrefs.includes(link.href));
    }, [role, enabledApps]);

    const isPathAllowed = useCallback((path: string) => {
        if (role === "admin") return true;
        if (visibleLinks.some((link) => path.startsWith(link.href))) return true;
        // Allow sub-pages under /orders/ for roles that have access to /orders/pending
        if (visibleLinks.some((link) => link.href === "/orders/pending") && path.startsWith("/orders/")) return true;
        // Customer report pages are linked from Salesperson Activity and Payment
        // Followup but aren't a sidebar entry of their own, so allow them for
        // anyone with access to either of those apps.
        if (
            visibleLinks.some((link) => link.href === "/salesperson-activity" || link.href === "/payment-followup") &&
            path.startsWith("/customers/")
        ) {
            return true;
        }
        // Sales target details drill-down is linked from Sales Targets but isn't
        // its own sidebar entry, so allow it for anyone with access to Sales Targets.
        if (visibleLinks.some((link) => link.href === "/sales-targets") && path.startsWith("/sales-target-details")) {
            return true;
        }
        return false;
    }, [role, visibleLinks]);

    useEffect(() => {
        if (loading || role === "admin" || visibleLinks.length === 0) {
            return;
        }

        if (!isPathAllowed(pathname)) {
            router.replace(visibleLinks[0].href);
        }
    }, [loading, pathname, role, router, visibleLinks, isPathAllowed]);

    const isAllowedPath = isPathAllowed(pathname);

    if (loading || !isAllowedPath) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-(--bg) text-(--ink)">
                <p className="text-sm tracking-wide">Loading your workspace...</p>
            </div>
        );
    }

    const showFull = expanded || pinned;

    const fade = (full: boolean, index = 0) => ({
        className: `overflow-hidden whitespace-nowrap transition-[max-width,opacity,transform] duration-300 ease-out motion-reduce:transition-none ${full ? "max-w-48 translate-x-0 opacity-100" : "max-w-0 -translate-x-2 opacity-0"}`,
        style: { transitionDelay: full ? `${40 + index * 18}ms` : "0ms" },
    });

    const renderBrand = (full: boolean) => (
        <div className="flex items-center px-4 pt-6 pb-5">
            <div className="shrink-0 overflow-hidden rounded-2xl shadow-[0_10px_24px_rgba(229,26,39,0.18)]">
                <Image src="/logo.png" alt="Al Amal Odoo++ logo" width={40} height={40} className="h-10 w-10" priority unoptimized />
            </div>
            <div className={`min-w-0 ${full ? "ml-3" : "ml-0"} transition-[margin] duration-300`}>
                <div {...fade(full)}>
                    <p className="truncate font-display text-lg tracking-tight text-(--brand)">Al Amal Tyres</p>
                    <span className="inline-flex rounded-full bg-[rgba(74,184,72,0.12)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-(--accent)">
                        Odoo++ Hub
                    </span>
                </div>
            </div>
        </div>
    );

    const renderNav = (full: boolean, desktop: boolean) => (
        <nav className="flex-1 space-y-1 overflow-y-auto overflow-x-hidden px-3">
            {visibleLinks.map((link, index) => {
                const active = pathname.startsWith(link.href);
                const Icon = link.icon;
                return (
                    <Link
                        key={link.href}
                        href={link.href}
                        title={full ? undefined : link.label}
                        onClick={() => {
                            setMobileNavOpen(false);
                            if (desktop && !pinned) {
                                // Fold right away and stay folded until the mouse leaves and comes back.
                                lockedUntilLeave.current = true;
                                clearHoverTimer();
                                setExpanded(false);
                            }
                            if (link.href === "/orders/pending") {
                                window.dispatchEvent(new Event("pending-orders-reset-to-first-page"));
                            }
                        }}
                        className={`group flex items-center rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors ${active
                            ? "bg-(--brand) text-white shadow-[0_8px_20px_rgba(229,26,39,0.24)]"
                            : "text-(--ink) hover:bg-(--chip)"
                            }`}
                    >
                        <Icon className="h-5 w-5 shrink-0 transition-transform duration-200 group-hover:scale-110" aria-hidden="true" />
                        <span className={`${full ? "ml-3" : "ml-0"} transition-[margin] duration-300`}>
                            <span {...fade(full, index)} className={`block ${fade(full, index).className}`}>
                                {link.label}
                            </span>
                        </span>
                    </Link>
                );
            })}
        </nav>
    );

    const renderUser = (full: boolean) => (
        <div className="flex items-center border-t border-(--line) px-4 py-4">
            <div className={`min-w-0 ${full ? "mr-3 flex-1" : "mr-0"} overflow-hidden whitespace-nowrap transition-[max-width,opacity,margin] duration-300 ease-out motion-reduce:transition-none ${full ? "max-w-56 opacity-100" : "max-w-0 opacity-0"}`}>
                <p className="text-[11px] uppercase tracking-widest text-(--ink-soft)">Signed in as</p>
                <p className="truncate text-sm font-semibold text-(--ink)">{user?.email}</p>
            </div>
            <button
                type="button"
                onClick={() => logout()}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[rgba(229,26,39,0.2)] bg-white text-(--brand) transition hover:bg-(--chip) hover:text-(--ink)"
                aria-label="Sign out"
                title="Sign out"
            >
                <LogOut className="h-4 w-4" aria-hidden="true" />
            </button>
        </div>
    );

    // The company selector keeps its own state, so it stays mounted; in the folded rail only its icon shows.
    const renderCompany = (full: boolean) => (
        <div
            className={
                full
                    ? ""
                    : "[&_button]:justify-center [&_button]:px-0 [&_button>span]:hidden [&_button>svg:last-child]:hidden"
            }
        >
            <CompanySelector />
        </div>
    );

    return (
        <div className="min-h-screen bg-(--bg) text-(--ink) lg:flex">
            {/* Desktop rail: reserves a slim column; the sidebar widens OVER the page on hover so tables keep their space. */}
            <div className={`hidden lg:relative lg:z-40 lg:block lg:shrink-0 lg:transition-[width] lg:duration-300 ${pinned ? "lg:w-64" : "lg:w-18"}`}>
                <aside
                    onMouseEnter={openRail}
                    onMouseLeave={() => {
                        lockedUntilLeave.current = false;
                        closeRail();
                    }}
                    onFocus={openRail}
                    onBlur={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) closeRail();
                    }}
                    className={`sticky top-0 flex h-screen flex-col border-r border-(--line) bg-(--card) transition-[width,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${showFull ? "w-64" : "w-18"} ${expanded && !pinned ? "shadow-[12px_0_40px_rgba(8,23,41,0.14)]" : ""}`}
                >
                    <button
                        type="button"
                        onClick={togglePin}
                        aria-pressed={pinned}
                        aria-label={pinned ? "Unpin sidebar" : "Pin sidebar open"}
                        title={pinned ? "Unpin sidebar" : "Pin sidebar open"}
                        tabIndex={showFull ? 0 : -1}
                        className={`absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-full border transition-[opacity,background-color,color] duration-200 ${showFull ? "opacity-100" : "pointer-events-none opacity-0"} ${pinned ? "border-transparent bg-(--brand) text-white" : "border-(--line) bg-white text-(--ink-soft) hover:bg-(--chip) hover:text-(--ink)"}`}
                    >
                        {pinned ? <PinOff className="h-3.5 w-3.5" aria-hidden="true" /> : <Pin className="h-3.5 w-3.5" aria-hidden="true" />}
                    </button>
                    {renderBrand(showFull)}
                    {renderCompany(labelsVisible)}
                    {renderNav(showFull, true)}
                    {renderUser(showFull)}
                </aside>
            </div>

            {/* Mobile top bar */}
            <header className="flex items-center gap-2.5 border-b border-(--line) bg-(--card)/90 px-4 py-3 shadow-[0_10px_35px_rgba(229,26,39,0.08)] backdrop-blur lg:hidden">
                <button
                    type="button"
                    onClick={() => setMobileNavOpen(true)}
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[rgba(229,26,39,0.2)] bg-white text-(--brand)"
                    aria-label="Open navigation"
                >
                    <Menu className="h-4 w-4" aria-hidden="true" />
                </button>
                <div className="flex items-center gap-2.5">
                    <div className="overflow-hidden rounded-xl shadow-[0_6px_16px_rgba(229,26,39,0.18)]">
                        <Image src="/logo.png" alt="Al Amal Odoo++ logo" width={32} height={32} className="h-8 w-8" priority unoptimized />
                    </div>
                    <p className="font-display text-base tracking-tight text-(--brand)">Al Amal Tyres</p>
                </div>
            </header>

            {/* Mobile slide-over sidebar — kept mounted (not conditionally
                rendered) so the transform/opacity transitions below can
                animate both the open AND the close, instead of just
                popping in and vanishing instantly. */}
            <div
                className={`fixed inset-0 z-50 lg:hidden ${mobileNavOpen ? "" : "pointer-events-none"}`}
                aria-hidden={!mobileNavOpen}
            >
                <div
                    className={`absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-300 ease-out ${mobileNavOpen ? "opacity-100" : "opacity-0"
                        }`}
                    onClick={() => setMobileNavOpen(false)}
                    aria-hidden="true"
                />
                <aside
                    className={`absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-(--card) shadow-2xl transition-transform duration-300 ease-out ${mobileNavOpen ? "translate-x-0" : "-translate-x-full"
                        }`}
                >
                    <div className="flex items-center justify-between px-2">
                        {renderBrand(true)}
                        <button
                            type="button"
                            onClick={() => setMobileNavOpen(false)}
                            className="mr-4 inline-flex h-9 w-9 items-center justify-center rounded-full border border-(--line) bg-white text-(--ink)"
                            aria-label="Close navigation"
                        >
                            <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                    </div>
                    {renderCompany(true)}
                    {renderNav(true, false)}
                    {renderUser(true)}
                </aside>
            </div>

            <main className="min-w-0 flex-1 px-4 py-8 sm:px-6 lg:px-8">{children}</main>
        </div>
    );
}
