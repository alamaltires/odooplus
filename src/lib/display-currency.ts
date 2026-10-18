"use client";

import { getSelectedCompanyIds } from "@/lib/company-filter";

const STORAGE_KEY = "odoopp:companyCurrencies";
const DEFAULT_CURRENCY = "AED";

/** Remembers each company's own currency (from Odoo) so pages can label amounts without another request. */
export function setCompanyCurrencies(currencies: Record<number, string>): void {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(currencies));
    } catch {
        // storage unavailable
    }
}

/**
 * Currency code to print next to amounts: the company's own currency when exactly one company is selected,
 * otherwise AED (several companies are shown together in the home currency).
 */
export function getDisplayCurrency(): string {
    if (typeof window === "undefined") return DEFAULT_CURRENCY;
    const selected = getSelectedCompanyIds();
    if (selected.length !== 1) return DEFAULT_CURRENCY;
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        const map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
        return map[String(selected[0])] || DEFAULT_CURRENCY;
    } catch {
        return DEFAULT_CURRENCY;
    }
}
