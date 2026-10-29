"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { FileText, LayoutGrid, List, Mail, MapPin, Phone, Search, UserRound, X } from "lucide-react";
import { getMyContacts } from "@/lib/client-odoo";
import { OdooContact } from "@/types/odoo";

type ViewMode = "grid" | "list";

const VIEW_KEY = "odoopp:myContactsView";
const AVATAR_TONES = [
    "bg-rose-100 text-rose-700",
    "bg-amber-100 text-amber-700",
    "bg-emerald-100 text-emerald-700",
    "bg-sky-100 text-sky-700",
    "bg-violet-100 text-violet-700",
    "bg-teal-100 text-teal-700",
];

function initialsOf(name: string) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

function Avatar({ contact, size }: { contact: OdooContact; size: "sm" | "lg" }) {
    const tone = AVATAR_TONES[contact.customerId % AVATAR_TONES.length];
    return (
        <span
            className={`flex shrink-0 items-center justify-center rounded-2xl font-semibold ${tone} ${size === "lg" ? "h-12 w-12 text-base" : "h-10 w-10 text-sm"}`}
        >
            {initialsOf(contact.customerName)}
        </span>
    );
}

function ReportButton({ customerId }: { customerId: number }) {
    return (
        <Link
            href={`/customers/${customerId}`}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-(--brand) px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:opacity-90"
        >
            <FileText className="h-3.5 w-3.5" />
            Customer Report
        </Link>
    );
}

function Detail({ icon: Icon, value, href }: { icon: typeof Mail; value: string; href?: string }) {
    if (!value) return null;
    const content = (
        <span className="flex min-w-0 items-center gap-2 text-sm text-(--ink-soft)">
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{value}</span>
        </span>
    );
    return href ? (
        <a href={href} className="min-w-0 hover:text-(--ink) hover:underline">
            {content}
        </a>
    ) : (
        content
    );
}

function addressOf(contact: OdooContact) {
    return [contact.street, contact.city].filter(Boolean).join(", ");
}

export default function MyContactsPage() {
    const [contacts, setContacts] = useState<OdooContact[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [query, setQuery] = useState("");
    const [view, setView] = useState<ViewMode>("grid");

    useEffect(() => {
        const timer = window.setTimeout(() => {
            try {
                const saved = window.localStorage.getItem(VIEW_KEY);
                if (saved === "grid" || saved === "list") setView(saved);
            } catch {
                // storage unavailable: keep the default view
            }
        }, 0);
        return () => window.clearTimeout(timer);
    }, []);

    useEffect(() => {
        let cancelled = false;
        getMyContacts()
            .then((data) => {
                if (!cancelled) setContacts(data.contacts);
            })
            .catch((err) => {
                if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load contacts");
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    function changeView(next: ViewMode) {
        setView(next);
        try {
            window.localStorage.setItem(VIEW_KEY, next);
        } catch {
            // ignore
        }
    }

    const filtered = useMemo(() => {
        const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
        if (terms.length === 0) return contacts;
        return contacts.filter((contact) => {
            const haystack = [contact.customerName, contact.email, contact.phone, contact.street, contact.city, contact.salespersonName]
                .join(" ")
                .toLowerCase();
            return terms.every((term) => haystack.includes(term));
        });
    }, [contacts, query]);

    return (
        <div className="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-8">
            <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                <div>
                    <h1 className="text-2xl font-semibold text-(--ink)">My Contacts</h1>
                    <p className="mt-1 text-sm text-(--ink-soft)">
                        {loading ? "Loading contacts..." : `${filtered.length} of ${contacts.length} contacts you can access`}
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <div className="relative w-full md:w-80">
                        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-(--ink-soft)" />
                        <input
                            type="search"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="Search name, phone, email, city..."
                            className="w-full rounded-full border border-(--line) bg-(--card) py-2.5 pr-9 pl-10 text-sm outline-none focus:border-(--brand)"
                        />
                        {query && (
                            <button
                                type="button"
                                onClick={() => setQuery("")}
                                aria-label="Clear search"
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-(--ink-soft) hover:text-(--ink)"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        )}
                    </div>
                    <div className="inline-flex shrink-0 rounded-full border border-(--line) bg-(--card) p-1">
                        {([
                            ["grid", LayoutGrid, "Grid view"],
                            ["list", List, "List view"],
                        ] as const).map(([mode, Icon, label]) => (
                            <button
                                key={mode}
                                type="button"
                                onClick={() => changeView(mode)}
                                aria-label={label}
                                aria-pressed={view === mode}
                                className={`rounded-full p-2 transition ${view === mode ? "bg-(--brand) text-white" : "text-(--ink-soft) hover:bg-(--chip)"}`}
                            >
                                <Icon className="h-4 w-4" />
                            </button>
                        ))}
                    </div>
                </div>
            </header>

            {error && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

            {loading ? (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {Array.from({ length: 6 }).map((_, index) => (
                        <div key={index} className="h-40 animate-pulse rounded-3xl border border-(--line) bg-(--card)" />
                    ))}
                </div>
            ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-3xl border border-dashed border-(--line) bg-(--card) py-16 text-(--ink-soft)">
                    <UserRound className="h-8 w-8" />
                    <p className="text-sm">{contacts.length === 0 ? "No contacts are available for your account." : "No contacts match your search."}</p>
                </div>
            ) : view === "grid" ? (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {filtered.map((contact) => (
                        <article
                            key={contact.customerId}
                            className="group flex flex-col gap-4 rounded-3xl border border-(--line) bg-(--card) p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                        >
                            <div className="flex items-center gap-3">
                                <Avatar contact={contact} size="lg" />
                                <div className="min-w-0">
                                    <h2 className="truncate text-base font-semibold text-(--ink)">{contact.customerName}</h2>
                                    {contact.salespersonName !== "-" && (
                                        <p className="truncate text-xs text-(--ink-soft)">Salesperson: {contact.salespersonName}</p>
                                    )}
                                </div>
                            </div>
                            <div className="flex min-h-14 flex-col gap-1.5">
                                <Detail icon={Phone} value={contact.phone} href={contact.phone ? `tel:${contact.phone}` : undefined} />
                                <Detail icon={Mail} value={contact.email} href={contact.email ? `mailto:${contact.email}` : undefined} />
                                <Detail icon={MapPin} value={addressOf(contact)} />
                            </div>
                            <div className="mt-auto flex justify-end border-t border-(--line) pt-3">
                                <ReportButton customerId={contact.customerId} />
                            </div>
                        </article>
                    ))}
                </div>
            ) : (
                <div className="divide-y divide-(--line) overflow-hidden rounded-3xl border border-(--line) bg-(--card) shadow-sm">
                    {filtered.map((contact) => (
                        <div
                            key={contact.customerId}
                            className="flex flex-col gap-3 px-5 py-3.5 transition hover:bg-(--chip) md:flex-row md:items-center md:gap-5"
                        >
                            <div className="flex min-w-0 items-center gap-3 md:w-1/3">
                                <Avatar contact={contact} size="sm" />
                                <div className="min-w-0">
                                    <h2 className="truncate text-sm font-semibold text-(--ink)">{contact.customerName}</h2>
                                    {contact.salespersonName !== "-" && (
                                        <p className="truncate text-xs text-(--ink-soft)">{contact.salespersonName}</p>
                                    )}
                                </div>
                            </div>
                            <div className="grid min-w-0 flex-1 gap-1 md:grid-cols-3 md:gap-4">
                                <Detail icon={Phone} value={contact.phone} href={contact.phone ? `tel:${contact.phone}` : undefined} />
                                <Detail icon={Mail} value={contact.email} href={contact.email ? `mailto:${contact.email}` : undefined} />
                                <Detail icon={MapPin} value={addressOf(contact)} />
                            </div>
                            <div className="md:shrink-0">
                                <ReportButton customerId={contact.customerId} />
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
