"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useCallback } from "react";
import { ClipboardList, LayoutDashboard, LogOut, ScanSearch, Settings, ShoppingBasket, Target, Users, type LucideIcon } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

const links: Array<{ href: string; label: string; icon: LucideIcon }> = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/orders/pending", label: "Pending Orders", icon: ClipboardList },
    { href: "/product-scanner", label: "Product Scanner", icon: ScanSearch },
    { href: "/purchase-order", label: "Purchase Order", icon: ShoppingBasket },
    { href: "/salesperson-activity", label: "Salesperson Activity", icon: Users },
    { href: "/sales-targets", label: "Sales Targets", icon: Target },
    { href: "/settings", label: "Settings", icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const router = useRouter();
    const { user, role, loading, logout } = useAuth();

    const visibleLinks = useMemo(() => {
        if (role === "purchase") {
            return links.filter(
                (link) =>
                    link.href === "/orders/pending" ||
                    link.href === "/purchase-order" ||
                    link.href === "/settings" ||
                    link.href === "/product-scanner"
            );
        }

        if (role === "salesperson") {
            return links.filter((link) => link.href === "/sales-targets" || link.href === "/settings");
        }

        if (role === "store") {
            return links.filter((link) => link.href === "/orders/pending" || link.href === "/product-scanner" || link.href === "/settings");
        }

        return links;
    }, [role]);

    const isPathAllowed = useCallback((path: string) => {
        if (role === "admin") return true;
        if (visibleLinks.some((link) => path.startsWith(link.href))) return true;
        // Allow sub-pages under /orders/ for roles that have access to /orders/pending
        if (visibleLinks.some((link) => link.href === "/orders/pending") && path.startsWith("/orders/")) return true;
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

    return (
        <div className="min-h-screen bg-(--bg) text-(--ink)">
            <header className="border-b border-(--line) bg-(--card)/90 shadow-[0_10px_35px_rgba(32,98,176,0.08)] backdrop-blur">
                <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:gap-4">
                    <div className="order-2 flex min-w-0 items-center gap-3 lg:order-1">
                        <div className="rounded-2xl border border-[rgba(32,98,176,0.14)] bg-white px-2.5 py-1.5 shadow-[0_10px_24px_rgba(32,98,176,0.08)] sm:px-3 sm:py-2">
                            <Image src="/applogo.png" alt="OdooPlus Logo" width={160} height={32} className="h-7 w-auto sm:h-8" />
                        </div>
                        <div className="min-w-0">
                            <p className="truncate font-display text-base tracking-tight text-(--brand) sm:text-xl">Dubai Medical Equipment</p>
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                                <span className="inline-flex rounded-full bg-[rgba(74,184,72,0.12)] px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-(--accent)">
                                    Sales Hub
                                </span>
                                <p className="text-xs text-(--ink-soft)">Odoo extension workspace</p>
                            </div>
                        </div>
                    </div>
                    <div className="order-1 flex w-full min-w-0 items-center gap-3 rounded-2xl border border-[rgba(32,98,176,0.16)] bg-white px-3 py-2 lg:order-2 lg:ml-auto lg:w-auto lg:bg-transparent lg:px-0 lg:py-0 lg:border-transparent">
                        <div className="min-w-0 lg:text-right">
                            <p className="text-[11px] uppercase tracking-widest text-(--ink-soft)">Signed in as</p>
                            <p className="truncate text-sm font-semibold text-(--ink)">{user?.email}</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => logout()}
                            className="ml-auto inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[rgba(32,98,176,0.2)] bg-white text-(--brand) transition hover:bg-(--chip) hover:text-(--ink)"
                            aria-label="Sign out"
                            title="Sign out"
                        >
                            <LogOut className="h-4 w-4" aria-hidden="true" />
                        </button>
                    </div>
                </div>
                <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 px-4 pb-3 sm:px-6">
                    <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-7">
                        {visibleLinks.map((link) => {
                            const active = pathname.startsWith(link.href);
                            const Icon = link.icon;
                            return (
                                <Link
                                    key={link.href}
                                    href={link.href}
                                    onClick={() => {
                                        if (link.href === "/orders/pending") {
                                            window.dispatchEvent(new Event("pending-orders-reset-to-first-page"));
                                        }
                                    }}
                                    className={`inline-flex items-center gap-2 rounded-2xl border px-3 py-2 text-sm font-medium transition ${active
                                        ? "border-transparent bg-(--brand) text-white shadow-[0_8px_20px_rgba(32,98,176,0.24)]"
                                        : "border-(--line) bg-white text-(--ink) hover:border-[rgba(32,98,176,0.35)] hover:bg-(--chip)"
                                        }`}
                                >
                                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                                    <span className="truncate">{link.label}</span>
                                </Link>
                            );
                        })}
                    </div>
                </div>
            </header>
            <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">{children}</main>
        </div>
    );
}
