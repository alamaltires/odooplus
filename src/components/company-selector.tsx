"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Building2, ChevronDown } from "lucide-react";
import { getCompanies } from "@/lib/client-odoo";
import {
    getSelectedCompanyIds,
    hasStoredCompanySelection,
    setSelectedCompanyIds,
    subscribeSelectedCompanyIds,
} from "@/lib/company-filter";

type Company = { id: number; name: string };

export function CompanySelector() {
    const [companies, setCompanies] = useState<Company[]>([]);
    const [loading, setLoading] = useState(true);
    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    const selectedIds = useSyncExternalStore(
        subscribeSelectedCompanyIds,
        getSelectedCompanyIds,
        () => []
    );

    useEffect(() => {
        let cancelled = false;

        getCompanies()
            .then((data) => {
                if (cancelled) return;
                setCompanies(data.companies);
                if (!hasStoredCompanySelection() && data.companies.length > 0) {
                    setSelectedCompanyIds(data.companies.map((company) => company.id));
                }
            })
            .catch(() => {
                if (!cancelled) setCompanies([]);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (!open) return;

        function handleClickOutside(event: MouseEvent) {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setOpen(false);
            }
        }

        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [open]);

    if (loading || companies.length <= 1) {
        return null;
    }

    const allSelected = selectedIds.length === companies.length;
    const label = allSelected
        ? "All Companies"
        : selectedIds.length === 0
            ? "No companies"
            : selectedIds.length === 1
                ? companies.find((company) => company.id === selectedIds[0])?.name ?? "1 company"
                : `${selectedIds.length} companies`;

    function toggleCompany(id: number) {
        const next = selectedIds.includes(id)
            ? selectedIds.filter((existing) => existing !== id)
            : [...selectedIds, id];
        setSelectedCompanyIds(next);
    }

    function toggleAll() {
        setSelectedCompanyIds(allSelected ? [] : companies.map((company) => company.id));
    }

    return (
        <div ref={containerRef} className="relative px-3 pb-3">
            <button
                type="button"
                onClick={() => setOpen((value) => !value)}
                className="flex w-full items-center gap-2 rounded-xl border border-(--line) bg-white px-3 py-2 text-left text-sm font-medium text-(--ink) shadow-sm transition hover:bg-(--chip)"
            >
                <Building2 className="h-4 w-4 shrink-0 text-(--brand)" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{label}</span>
                <ChevronDown className={`h-4 w-4 shrink-0 text-(--ink-soft) transition ${open ? "rotate-180" : ""}`} aria-hidden="true" />
            </button>

            {open ? (
                <div className="absolute inset-x-3 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-xl border border-(--line) bg-white p-1.5 shadow-lg">
                    <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-semibold text-(--ink) hover:bg-(--chip)">
                        <input
                            type="checkbox"
                            checked={allSelected}
                            onChange={toggleAll}
                            className="h-4 w-4 rounded border-(--line) text-(--brand) focus:ring-(--brand)"
                        />
                        Select All
                    </label>
                    <div className="my-1 border-t border-(--line)" />
                    {companies.map((company) => (
                        <label
                            key={company.id}
                            className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-(--ink) hover:bg-(--chip)"
                        >
                            <input
                                type="checkbox"
                                checked={selectedIds.includes(company.id)}
                                onChange={() => toggleCompany(company.id)}
                                className="h-4 w-4 rounded border-(--line) text-(--brand) focus:ring-(--brand)"
                            />
                            <span className="truncate">{company.name}</span>
                        </label>
                    ))}
                </div>
            ) : null}
        </div>
    );
}
