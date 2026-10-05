"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useCallback, useState } from "react";
import { ClipboardList, HandCoins, LayoutDashboard, LogOut, Menu, PackageSearch, Percent, Ship, ScanSearch, Settings, ShoppingBasket, Target, TrendingUp, Users, X, type LucideIcon } from "lucide-react";
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
    "/purchase-order": ShoppingBasket,
    "/po-tracking": Ship,
    "/products-performance": TrendingUp,
    "/margin-analytics": Percent,
    "/salesperson-activity": Users,
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

    const brandBlock = (
        <div className="flex items-center gap-3 px-5 pt-6 pb-5">
            <div className="shrink-0 overflow-hidden rounded-2xl shadow-[0_10px_24px_rgba(229,26,39,0.18)]">
                <Image src="/logo.png" alt="Al Amal Odoo++ logo" width={40} height={40} className="h-10 w-10" priority unoptimized />
            </div>
            <div className="min-w-0">
                <p className="truncate font-display text-lg tracking-tight text-(--brand)">Al Amal Tyres</p>
                <span className="inline-flex rounded-full bg-[rgba(74,184,72,0.12)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-(--accent)">
                    Odoo++ Hub
                </span>
            </div>
        </div>
    );

    const navList = (
        <nav className="flex-1 space-y-1 overflow-y-auto px-3">
            {visibleLinks.map((link) => {
                const active = pathname.startsWith(link.href);
                const Icon = link.icon;
                return (
                    <Link
                        key={link.href}
                        href={link.href}
                        onClick={() => {
                            setMobileNavOpen(false);
                            if (link.href === "/orders/pending") {
                                window.dispatchEvent(new Event("pending-orders-reset-to-first-page"));
                            }
                        }}
                        className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${active
                            ? "bg-(--brand) text-white shadow-[0_8px_20px_rgba(229,26,39,0.24)]"
                            : "text-(--ink) hover:bg-(--chip)"
                            }`}
                    >
                        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span className="truncate">{link.label}</span>
                    </Link>
                );
            })}
        </nav>
    );

    const userBlock = (
        <div className="flex items-center gap-3 border-t border-(--line) px-4 py-4">
            <div className="min-w-0 flex-1">
                <p className="text-[11px] uppercase tracking-widest text-(--ink-soft)">Signed in as</p>
                <p className="truncate text-sm font-semibold text-(--ink)">{user?.email}</p>
            </div>
            <button
                type="button"
                onClick={() => logout()}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[rgba(229,26,39,0.2)] bg-white text-(--brand) transition hover:bg-(--chip) hover:text-(--ink)"
                aria-label="Sign out"
                title="Sign out"
            >
                <LogOut className="h-4 w-4" aria-hidden="true" />
            </button>
        </div>
    );

    return (
        <div className="min-h-screen bg-(--bg) text-(--ink) lg:flex">
            {/* Desktop sidebar */}
            <aside className="hidden lg:flex lg:w-64 lg:shrink-0 lg:flex-col lg:border-r lg:border-(--line) lg:bg-(--card)">
                {brandBlock}
                <CompanySelector />
                {navList}
                {userBlock}
            </aside>

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
                        {brandBlock}
                        <button
                            type="button"
                            onClick={() => setMobileNavOpen(false)}
                            className="mr-4 inline-flex h-9 w-9 items-center justify-center rounded-full border border-(--line) bg-white text-(--ink)"
                            aria-label="Close navigation"
                        >
                            <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                    </div>
                    <CompanySelector />
                    {navList}
                    {userBlock}
                </aside>
            </div>

            <main className="min-w-0 flex-1 px-4 py-8 sm:px-6 lg:px-8">{children}</main>
        </div>
    );
}
