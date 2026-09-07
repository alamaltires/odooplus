"use client";

const STORAGE_KEY = "odoopp:selectedCompanyIds";

type Listener = () => void;

const listeners = new Set<Listener>();
let cached: number[] | null = null;

function readFromStorage(): number[] {
    if (typeof window === "undefined") {
        return [];
    }

    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            return [];
        }

        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) {
            return [];
        }

        return parsed.filter((value): value is number => typeof value === "number" && value > 0);
    } catch {
        return [];
    }
}

/**
 * Company IDs selected in the sidebar company selector. An empty array means
 * no explicit selection has been made yet (the selector defaults every
 * company to "checked" once the company list loads) — `post()` only injects
 * this into requests when it's non-empty, so behavior before the selector
 * has ever been touched is unchanged.
 */
export function getSelectedCompanyIds(): number[] {
    if (cached === null) {
        cached = readFromStorage();
    }

    return cached;
}

export function setSelectedCompanyIds(ids: number[]): void {
    cached = ids;

    if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
    }

    for (const listener of listeners) {
        listener();
    }
}

export function subscribeSelectedCompanyIds(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/**
 * True only once a selection has actually been persisted to storage —
 * distinguishes "never chosen yet" from "user explicitly picked nothing"
 * (which the UI does not allow, but keeps the check meaningful).
 */
export function hasStoredCompanySelection(): boolean {
    if (typeof window === "undefined") {
        return false;
    }

    return window.localStorage.getItem(STORAGE_KEY) !== null;
}
