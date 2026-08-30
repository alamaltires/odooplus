"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ShoppingBasket } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { getDashboardStats } from "@/lib/client-odoo";
import { OdooDashboardStats } from "@/types/odoo";

type Stats = OdooDashboardStats;

const emptyStats: Stats = {
    pendingCount: 0,
    confirmedCount: 0,
    draftCount: 0,
    selectedActivityType: "crmVisits",
    salespersonDailyActivities: [],
};

export default function DashboardPage() {
    const { user } = useAuth();
    const [stats, setStats] = useState<Stats>(emptyStats);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        async function load() {
            if (!user) {
                return;
            }

            setLoading(true);
            try {
                const data = await getDashboardStats();
                setStats(data);
                setError(null);
            } catch (loadError) {
                setError(loadError instanceof Error ? loadError.message : "Failed to load stats.");
            } finally {
                setLoading(false);
            }
        }

        void load();
    }, [user]);

    useEffect(() => {
        if (!user) {
            setStats(emptyStats);
        }
    }, [user]);

    return (
        <section>
            <div className="flex items-end justify-between">
                <div>
                    <h1 className="font-display text-3xl">Dashboard</h1>
                    <p className="text-sm text-(--ink-soft)">Live overview from your Odoo ERP.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Link href="/orders/pending" className="rounded-full bg-(--brand) px-4 py-2 text-sm text-white">
                        View Pending Orders
                    </Link>
                    <Link
                        href="/purchase-order"
                        className="inline-flex items-center gap-1.5 rounded-full border border-(--line) bg-(--card) px-4 py-2 text-sm hover:bg-(--chip)"
                    >
                        <ShoppingBasket className="h-4 w-4" aria-hidden="true" />
                        Purchase Order
                    </Link>
                </div>
            </div>

            {error ? (
                <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
                    {error}
                </div>
            ) : null}

            <div className="mt-6 grid gap-4 sm:grid-cols-3">
                {[
                    { label: "Daily Pending Orders", value: stats.pendingCount },
                    { label: "Daily Confirmed Orders", value: stats.confirmedCount },
                    { label: "Daily Issued Invoices", value: stats.draftCount },
                ].map((item) => (
                    <article
                        key={item.label}
                        className="rounded-2xl border border-(--line) bg-(--card) p-5 shadow-[0_8px_20px_rgba(8,23,41,0.05)]"
                    >
                        <p className="text-sm text-(--ink-soft)">{item.label}</p>
                        <p className="mt-3 font-display text-4xl">{loading ? "..." : item.value}</p>
                    </article>
                ))}
            </div>
        </section>
    );
}
