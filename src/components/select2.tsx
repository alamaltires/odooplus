"use client";

import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { ChevronsUpDown, Loader2, Search } from "lucide-react";

export type Select2Option = {
    value: string;
    label: string;
    description?: string;
    disabled?: boolean;
};

// Rendering every option as a DOM node is what makes a native `<select>`
// slow to open once a list grows into the hundreds/thousands (e.g. the
// customer picker, which can hold up to 5000 rows) — capping how many
// filtered matches actually get rendered, with a hint to keep typing, is
// what keeps this fast regardless of how big `options` is.
const MAX_VISIBLE_OPTIONS = 200;

function normalize(value: string) {
    return value.trim().toLowerCase();
}

/**
 * A searchable, keyboard-navigable single-select — the app's own lightweight
 * "Select2" (a plain `<select>` is unsearchable and, for a list of any real
 * size, slow to render/scroll). Same controlled `value`/`onChange` shape as a
 * native select, so it's a drop-in replacement.
 */
export function Select2({
    value,
    onChange,
    options,
    placeholder = "Select...",
    searchPlaceholder = "Type to search...",
    loading = false,
    loadingText = "Loading...",
    emptyText = "No options found.",
    noMatchText = "No matches found.",
    disabled = false,
    className,
}: {
    value: string;
    onChange: (value: string) => void;
    options: Select2Option[];
    placeholder?: string;
    searchPlaceholder?: string;
    loading?: boolean;
    loadingText?: string;
    emptyText?: string;
    noMatchText?: string;
    disabled?: boolean;
    className?: string;
}) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [highlightedIndex, setHighlightedIndex] = useState(0);
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const selectedOption = useMemo(() => options.find((option) => option.value === value), [options, value]);

    const filteredOptions = useMemo(() => {
        const normalizedQuery = normalize(query);
        if (!normalizedQuery) {
            return options;
        }
        return options.filter(
            (option) =>
                normalize(option.label).includes(normalizedQuery) ||
                (option.description ? normalize(option.description).includes(normalizedQuery) : false)
        );
    }, [options, query]);

    const visibleOptions = filteredOptions.slice(0, MAX_VISIBLE_OPTIONS);
    const truncatedCount = filteredOptions.length - visibleOptions.length;

    useEffect(() => {
        if (!open) return undefined;

        function onMouseDown(event: MouseEvent) {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setOpen(false);
            }
        }

        document.addEventListener("mousedown", onMouseDown);
        return () => document.removeEventListener("mousedown", onMouseDown);
    }, [open]);

    useEffect(() => {
        if (!open) return undefined;

        setQuery("");
        setHighlightedIndex(Math.max(0, options.findIndex((option) => option.value === value)));
        const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
        return () => window.clearTimeout(timer);
        // Only re-run when the menu opens — re-focusing/resetting on every
        // `options`/`value` change would fight the user while typing.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    useEffect(() => {
        setHighlightedIndex(0);
    }, [query]);

    function selectOption(option: Select2Option) {
        if (option.disabled) return;
        onChange(option.value);
        setOpen(false);
    }

    function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
        if (event.key === "ArrowDown") {
            event.preventDefault();
            setHighlightedIndex((index) => Math.min(index + 1, visibleOptions.length - 1));
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setHighlightedIndex((index) => Math.max(index - 1, 0));
        } else if (event.key === "Enter") {
            event.preventDefault();
            const option = visibleOptions[highlightedIndex];
            if (option) selectOption(option);
        } else if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
        }
    }

    const closedLabel = loading
        ? loadingText
        : (selectedOption?.label ?? (options.length === 0 ? emptyText : placeholder));

    return (
        <div ref={containerRef} className={`relative ${className ?? ""}`}>
            <button
                type="button"
                onClick={() => setOpen((wasOpen) => !wasOpen)}
                disabled={disabled || loading}
                aria-haspopup="listbox"
                aria-expanded={open}
                className={`flex w-full items-center justify-between gap-2 rounded-xl border border-(--line) bg-white px-4 py-2.5 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${open ? "ring-2 ring-(--brand-soft)" : ""
                    }`}
            >
                <span className={`truncate ${selectedOption ? "text-(--ink)" : "text-(--ink-soft)"}`}>{closedLabel}</span>
                {loading ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-(--ink-soft)" aria-hidden="true" />
                ) : (
                    <ChevronsUpDown className="h-4 w-4 shrink-0 text-(--ink-soft)" aria-hidden="true" />
                )}
            </button>

            {open ? (
                <div className="absolute z-30 mt-2 w-full overflow-hidden rounded-xl border border-(--line) bg-white shadow-lg">
                    <div className="relative border-b border-(--line) p-2">
                        <Search
                            className="pointer-events-none absolute left-5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-(--ink-soft)"
                            aria-hidden="true"
                        />
                        <input
                            ref={inputRef}
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            onKeyDown={onKeyDown}
                            placeholder={searchPlaceholder}
                            className="w-full rounded-lg border border-(--line) bg-white py-1.5 pl-8 pr-3 text-sm focus:outline-none"
                        />
                    </div>
                    <ul role="listbox" className="max-h-64 overflow-auto p-1">
                        {visibleOptions.length === 0 ? (
                            <li className="px-3 py-2 text-sm text-(--ink-soft)">{query ? noMatchText : emptyText}</li>
                        ) : (
                            visibleOptions.map((option, index) => (
                                <li key={option.value}>
                                    <button
                                        type="button"
                                        role="option"
                                        aria-selected={option.value === value}
                                        disabled={option.disabled}
                                        onMouseEnter={() => setHighlightedIndex(index)}
                                        onMouseDown={(event) => {
                                            event.preventDefault();
                                            selectOption(option);
                                        }}
                                        className={`flex w-full flex-col items-start rounded-lg px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-40 ${index === highlightedIndex ? "bg-(--chip)" : ""
                                            } ${option.value === value ? "font-medium text-(--brand)" : ""}`}
                                    >
                                        <span className="truncate">{option.label}</span>
                                        {option.description ? (
                                            <span className="truncate text-xs text-(--ink-soft)">{option.description}</span>
                                        ) : null}
                                    </button>
                                </li>
                            ))
                        )}
                        {truncatedCount > 0 ? (
                            <li className="px-3 py-2 text-center text-xs text-(--ink-soft)">
                                Showing {visibleOptions.length} of {filteredOptions.length} — keep typing to narrow down.
                            </li>
                        ) : null}
                    </ul>
                </div>
            ) : null}
        </div>
    );
}
