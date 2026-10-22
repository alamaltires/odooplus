"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronsUpDown, Loader2, Search, X } from "lucide-react";
import type { Select2Option } from "@/components/select2";

const MAX_VISIBLE_OPTIONS = 200;

/**
 * A searchable multi-select that lets the user pick up to `max` options.
 * Chosen options show as removable chips under the field; once the limit is
 * reached the remaining options are disabled until one is removed.
 */
export function LimitedMultiSelect({
    values,
    onChange,
    options,
    max,
    placeholder = "Select...",
    searchPlaceholder = "Type to search...",
    loading = false,
    loadingText = "Loading...",
    emptyText = "No options found.",
    disabled = false,
}: {
    values: string[];
    onChange: (values: string[]) => void;
    options: Select2Option[];
    max: number;
    placeholder?: string;
    searchPlaceholder?: string;
    loading?: boolean;
    loadingText?: string;
    emptyText?: string;
    disabled?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const labelByValue = useMemo(() => new Map(options.map((option) => [option.value, option.label])), [options]);
    const atLimit = values.length >= max;

    const filtered = useMemo(() => {
        const normalized = query.trim().toLowerCase();
        if (!normalized) return options;
        return options.filter(
            (option) => option.label.toLowerCase().includes(normalized) || (option.description ?? "").toLowerCase().includes(normalized)
        );
    }, [options, query]);
    const visible = filtered.slice(0, MAX_VISIBLE_OPTIONS);

    useEffect(() => {
        if (!open) return undefined;
        const onMouseDown = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
        };
        document.addEventListener("mousedown", onMouseDown);
        return () => document.removeEventListener("mousedown", onMouseDown);
    }, [open]);

    useEffect(() => {
        if (!open) return undefined;
        const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
        return () => window.clearTimeout(timer);
    }, [open]);

    function toggle(value: string) {
        if (values.includes(value)) onChange(values.filter((item) => item !== value));
        else if (!atLimit) onChange([...values, value]);
    }

    return (
        <div ref={containerRef} className="relative">
            <button
                type="button"
                onClick={() => setOpen((wasOpen) => !wasOpen)}
                disabled={disabled || loading}
                aria-haspopup="listbox"
                aria-expanded={open}
                className={`flex w-full items-center justify-between gap-2 rounded-xl border border-(--line) bg-white px-4 py-2.5 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${open ? "ring-2 ring-(--brand-soft)" : ""}`}
            >
                <span className={`truncate ${values.length > 0 ? "text-(--ink)" : "text-(--ink-soft)"}`}>
                    {loading ? loadingText : values.length > 0 ? `${values.length} of ${max} selected` : options.length === 0 ? emptyText : placeholder}
                </span>
                {loading ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-(--ink-soft)" aria-hidden="true" />
                ) : (
                    <ChevronsUpDown className="h-4 w-4 shrink-0 text-(--ink-soft)" aria-hidden="true" />
                )}
            </button>

            {open ? (
                <div className="absolute z-30 mt-2 w-full overflow-hidden rounded-xl border border-(--line) bg-white shadow-lg">
                    <div className="relative border-b border-(--line) p-2">
                        <Search className="pointer-events-none absolute left-5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-(--ink-soft)" aria-hidden="true" />
                        <input
                            ref={inputRef}
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            onKeyDown={(event) => event.key === "Escape" && setOpen(false)}
                            placeholder={searchPlaceholder}
                            className="w-full rounded-lg border border-(--line) bg-white py-1.5 pl-8 pr-3 text-sm focus:outline-none"
                        />
                    </div>
                    {atLimit ? <p className="bg-amber-50 px-3 py-1.5 text-xs text-amber-800">Maximum of {max} reached. Remove one to pick another.</p> : null}
                    <ul role="listbox" aria-multiselectable="true" className="max-h-64 overflow-x-hidden overflow-y-auto p-1">
                        {visible.length === 0 ? (
                            <li className="px-3 py-2 text-sm text-(--ink-soft)">{query ? "No matches found." : emptyText}</li>
                        ) : (
                            visible.map((option) => {
                                const picked = values.includes(option.value);
                                const blocked = !picked && atLimit;
                                return (
                                    <li key={option.value}>
                                        <button
                                            type="button"
                                            role="option"
                                            aria-selected={picked}
                                            disabled={blocked}
                                            onMouseDown={(event) => {
                                                event.preventDefault();
                                                toggle(option.value);
                                            }}
                                            className={`flex w-full min-w-0 items-start gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-(--chip) disabled:cursor-not-allowed disabled:opacity-40 ${picked ? "bg-(--chip) font-medium text-(--brand)" : ""}`}
                                        >
                                            <input type="checkbox" checked={picked} readOnly tabIndex={-1} className="mt-0.5 h-4 w-4 shrink-0 rounded border-(--line)" />
                                            <span className="min-w-0">
                                                <span className="block break-words">{option.label}</span>
                                                {option.description ? <span className="block break-words text-xs font-normal text-(--ink-soft)">{option.description}</span> : null}
                                            </span>
                                        </button>
                                    </li>
                                );
                            })
                        )}
                        {filtered.length > visible.length ? (
                            <li className="px-3 py-2 text-center text-xs text-(--ink-soft)">
                                Showing {visible.length} of {filtered.length}. Keep typing to narrow down.
                            </li>
                        ) : null}
                    </ul>
                </div>
            ) : null}

            {values.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                    {values.map((value) => (
                        <span key={value} className="inline-flex max-w-full items-center gap-1 rounded-full border border-(--line) bg-(--chip) py-0.5 pl-2.5 pr-1 text-xs font-medium">
                            <span className="truncate">{labelByValue.get(value) ?? value}</span>
                            <button
                                type="button"
                                onClick={() => onChange(values.filter((item) => item !== value))}
                                className="rounded-full p-0.5 text-(--ink-soft) hover:bg-white hover:text-(--brand)"
                                aria-label={`Remove ${labelByValue.get(value) ?? value}`}
                            >
                                <X className="h-3 w-3" aria-hidden="true" />
                            </button>
                        </span>
                    ))}
                </div>
            ) : null}
        </div>
    );
}
