"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
    Boxes,
    CheckCircle2,
    ClipboardList,
    Eye,
    Link2,
    Package,
    PackageSearch,
    Plus,
    Search,
    Tag,
    Trash2,
    X,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import {
    createProductRequest,
    deleteProductRequest,
    getProductBrands,
    listProductRequests,
    ProductRequest,
    ProductRequestType,
    searchProductCatalog,
    setProductRequestSeen,
} from "@/lib/client-odoo";

type ProductCard = {
    id: number;
    name: string;
    sku: string;
    brandName: string;
    categoryName: string;
    originName: string;
    rimDiameterName: string;
    currentStock: number;
    stockByLot: Array<{ lotName: string; companyName: string; quantity: number }>;
    pricelists: Array<{ pricelistName: string; currencyCode: string; price: number }>;
};

type ReferenceProduct = { id: number; name: string; brandName: string };

const MIN_SEARCH_QUERY_LENGTH = 2;
const SEARCH_PAGE_SIZE = 24;

const REQUEST_TYPE_OPTIONS: Array<{ value: ProductRequestType; label: string; hint: string }> = [
    { value: "new_product", label: "New Product", hint: "This product doesn't exist in the catalogue at all." },
    { value: "missing_size", label: "Missing Size", hint: "The brand/pattern exists, but not in this size." },
    { value: "missing_pattern", label: "Missing Pattern", hint: "The brand exists, but not this tread pattern." },
];

const REQUEST_TYPE_LABELS: Record<ProductRequestType, string> = {
    new_product: "New Product",
    missing_size: "Missing Size",
    missing_pattern: "Missing Pattern",
};

const REQUEST_TYPE_STYLES: Record<ProductRequestType, string> = {
    new_product: "bg-[rgba(32,98,176,0.12)] text-(--brand)",
    missing_size: "bg-amber-100 text-amber-800",
    missing_pattern: "bg-[rgba(109,40,217,0.1)] text-purple-700",
};

function formatDateTime(value: string) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

// The auto-drafted starting point for Notes, rebuilt from whatever's filled
// in above it (request type, brand, size, pattern, reference product). The
// user is expected to keep typing from here — see `notesTouched` below.
function composeAutoNotes(input: {
    requestType: ProductRequestType;
    brand: string;
    size: string;
    pattern: string;
    referenceProduct: ReferenceProduct | null;
    searchQuery: string;
}): string {
    const parts: string[] = [];
    if (input.referenceProduct) {
        parts.push(`Reference: ${input.referenceProduct.name}`);
    }
    if (input.requestType === "missing_size") {
        parts.push(`Missing size${input.brand ? ` for ${input.brand}` : ""}: ${input.size || "?"}`);
    } else if (input.requestType === "missing_pattern") {
        parts.push(`Missing pattern${input.brand ? ` for ${input.brand}` : ""}: ${input.pattern || "?"}`);
    } else {
        const bits = [input.brand, input.size, input.pattern].filter(Boolean);
        if (bits.length > 0) {
            parts.push(`New product: ${bits.join(" ")}`);
        } else if (input.searchQuery) {
            parts.push(`Looking for: ${input.searchQuery}`);
        }
    }
    return parts.join(". ");
}

export default function ProductRequestsPage() {
    const { user, role } = useAuth();
    const isAdmin = role === "admin";

    const [activeTab, setActiveTab] = useState<"search" | "requests">("search");

    // --- Search state ---
    const [query, setQuery] = useState("");
    const [activated, setActivated] = useState(false);
    const [results, setResults] = useState<ProductCard[]>([]);
    const [searchLoading, setSearchLoading] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [offset, setOffset] = useState(0);
    const [hasMore, setHasMore] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);

    // --- Request panel state ---
    const [panelOpen, setPanelOpen] = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);
    const [requestType, setRequestType] = useState<ProductRequestType>("new_product");
    const [brand, setBrand] = useState("");
    const [size, setSize] = useState("");
    const [pattern, setPattern] = useState("");
    const [notes, setNotes] = useState("");
    const [notesTouched, setNotesTouched] = useState(false);
    const autoNotesRef = useRef("");
    const [referenceProduct, setReferenceProduct] = useState<ReferenceProduct | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [submitSuccess, setSubmitSuccess] = useState(false);

    // Existing brands, offered as autocomplete suggestions on the Brand
    // field so requesters can pick from what's already in the catalogue
    // instead of retyping/misspelling a brand that already exists.
    const [brands, setBrands] = useState<Array<{ id: number; name: string }>>([]);
    useEffect(() => {
        getProductBrands()
            .then((data) => setBrands(data.brands))
            .catch(() => setBrands([]));
    }, []);

    // --- Requests list state ---
    const [requests, setRequests] = useState<ProductRequest[]>([]);
    const [requestsLoading, setRequestsLoading] = useState(false);
    const [requestsError, setRequestsError] = useState<string | null>(null);
    const [requestsLoaded, setRequestsLoaded] = useState(false);
    const [rowActionError, setRowActionError] = useState<string | null>(null);
    const [pendingRowId, setPendingRowId] = useState<string | null>(null);
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

    useEffect(() => {
        if (!activated) {
            return;
        }
        const trimmed = query.trim();
        if (trimmed.length < MIN_SEARCH_QUERY_LENGTH) {
            setResults([]);
            setHasMore(false);
            setOffset(0);
            setSearchError(null);
            return;
        }
        const debounceId = window.setTimeout(() => {
            setSearchLoading(true);
            setSearchError(null);
            searchProductCatalog({ query: trimmed, limit: SEARCH_PAGE_SIZE, offset: 0 })
                .then((data) => {
                    setResults(data.products);
                    setHasMore(data.hasMore);
                    setOffset(data.products.length);
                })
                .catch((error) => {
                    setSearchError(error instanceof Error ? error.message : "Failed to search products.");
                    setResults([]);
                    setHasMore(false);
                })
                .finally(() => setSearchLoading(false));
        }, 300);
        return () => window.clearTimeout(debounceId);
    }, [query, activated]);

    function loadMoreResults() {
        const trimmed = query.trim();
        if (searchLoading || loadingMore || !hasMore || trimmed.length < MIN_SEARCH_QUERY_LENGTH) {
            return;
        }
        setLoadingMore(true);
        searchProductCatalog({ query: trimmed, limit: SEARCH_PAGE_SIZE, offset })
            .then((data) => {
                setResults((current) => [...current, ...data.products]);
                setHasMore(data.hasMore);
                setOffset((current) => current + data.products.length);
            })
            .catch(() => setHasMore(false))
            .finally(() => setLoadingMore(false));
    }

    function loadMyRequests() {
        setRequestsLoading(true);
        setRequestsError(null);
        listProductRequests()
            .then((data) => {
                setRequests(data.requests);
                setRequestsLoaded(true);
            })
            .catch((error) => {
                setRequestsError(error instanceof Error ? error.message : "Failed to load requests.");
            })
            .finally(() => setRequestsLoading(false));
    }

    useEffect(() => {
        if (panelOpen) {
            panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    }, [panelOpen]);

    useEffect(() => {
        if (activeTab === "requests" && !requestsLoaded && user) {
            loadMyRequests();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab, user]);

    // Keeps Notes in sync with the fields above it until the user actually
    // types something of their own into it — at that point their edits win
    // and auto-updates stop, so we never clobber what they've continued.
    useEffect(() => {
        if (notesTouched) {
            return;
        }
        const draft = composeAutoNotes({ requestType, brand, size, pattern, referenceProduct, searchQuery: query });
        autoNotesRef.current = draft;
        setNotes(draft);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [requestType, brand, size, pattern, referenceProduct, notesTouched]);

    function openRequestPanel() {
        setSubmitSuccess(false);
        setPanelOpen(true);
    }

    // The fast path: click "Request" on a card that's close to what's
    // needed. Brand comes straight from the product, the product itself
    // becomes the Reference (so the admin sees exactly what it should look
    // like), and the only thing left to type is the one field that's
    // actually missing — usually just Size.
    function openRequestPanelFromCard(product: ProductCard) {
        setRequestType("missing_size");
        setBrand(product.brandName !== "No Brand" ? product.brandName : "");
        setPattern("");
        setSize("");
        setNotesTouched(false);
        setReferenceProduct({ id: product.id, name: product.name, brandName: product.brandName });
        setSubmitSuccess(false);
        setSubmitError(null);
        setPanelOpen(true);
    }

    function closeRequestPanel() {
        setPanelOpen(false);
    }

    function clearReference() {
        setReferenceProduct(null);
    }

    function resetForm() {
        setRequestType("new_product");
        setBrand("");
        setSize("");
        setPattern("");
        setNotes("");
        setNotesTouched(false);
        setReferenceProduct(null);
    }

    async function handleSubmitRequest(event: FormEvent) {
        event.preventDefault();

        setSubmitting(true);
        setSubmitError(null);

        try {
            await createProductRequest({
                requestType,
                brand: brand.trim(),
                size: size.trim(),
                pattern: pattern.trim(),
                notes: notes.trim(),
                searchQuery: query.trim(),
                referenceProductId: referenceProduct?.id ?? null,
                referenceProductName: referenceProduct?.name ?? "",
            });
            setSubmitSuccess(true);
            resetForm();
            setRequestsLoaded(false);
            if (activeTab === "requests") {
                loadMyRequests();
            }
        } catch (error) {
            setSubmitError(error instanceof Error ? error.message : "Failed to save your request.");
        } finally {
            setSubmitting(false);
        }
    }

    async function toggleSeen(item: ProductRequest) {
        setRowActionError(null);
        setPendingRowId(item.id);
        try {
            const data = await setProductRequestSeen(item.id, !item.seen);
            setRequests((current) => current.map((row) => (row.id === item.id ? data.request : row)));
        } catch (error) {
            setRowActionError(error instanceof Error ? error.message : "Failed to update request.");
        } finally {
            setPendingRowId(null);
        }
    }

    async function handleDelete(item: ProductRequest) {
        setRowActionError(null);
        setPendingRowId(item.id);
        try {
            await deleteProductRequest(item.id);
            setRequests((current) => current.filter((row) => row.id !== item.id));
        } catch (error) {
            setRowActionError(error instanceof Error ? error.message : "Failed to delete request.");
        } finally {
            setPendingRowId(null);
            setConfirmDeleteId(null);
        }
    }

    const activeTypeHint = useMemo(
        () => REQUEST_TYPE_OPTIONS.find((option) => option.value === requestType)?.hint ?? "",
        [requestType]
    );

    const showSizeField = requestType !== "missing_pattern";
    const showPatternField = true;

    return (
        <section>
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="font-display text-3xl">Product Requests</h1>
                    <p className="mt-1 text-sm text-(--ink-soft)">
                        Search the catalogue for a product. If it isn&rsquo;t there — wrong size, wrong pattern, or
                        entirely new — request it in a few clicks.
                    </p>
                </div>
                <PackageSearch className="h-8 w-8 text-(--brand)" aria-hidden="true" />
            </div>

            <div className="mt-6 flex gap-2 border-b border-(--line)">
                <button
                    type="button"
                    onClick={() => setActiveTab("search")}
                    className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition ${
                        activeTab === "search"
                            ? "border-(--brand) text-(--brand)"
                            : "border-transparent text-(--ink-soft) hover:text-(--ink)"
                    }`}
                >
                    <Search className="h-4 w-4" aria-hidden="true" />
                    Search &amp; Request
                </button>
                <button
                    type="button"
                    onClick={() => setActiveTab("requests")}
                    className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition ${
                        activeTab === "requests"
                            ? "border-(--brand) text-(--brand)"
                            : "border-transparent text-(--ink-soft) hover:text-(--ink)"
                    }`}
                >
                    <ClipboardList className="h-4 w-4" aria-hidden="true" />
                    {isAdmin ? "All Requests" : "My Requests"}
                </button>
            </div>

            {activeTab === "search" ? (
                <div className="mt-6 space-y-4">
                    <div className="flex flex-col gap-3 rounded-2xl border border-(--line) bg-(--card) p-5 sm:flex-row sm:items-center">
                        <div className="relative flex-1">
                            <Search
                                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--ink-soft)"
                                aria-hidden="true"
                            />
                            <input
                                value={query}
                                onChange={(event) => {
                                    setQuery(event.target.value);
                                    setActivated(true);
                                }}
                                onFocus={() => setActivated(true)}
                                placeholder="Search by size, brand, pattern, or SKU (e.g. 265/65R17 Michelin)"
                                className="w-full rounded-xl border border-(--line) bg-white py-2.5 pl-10 pr-3"
                            />
                        </div>
                        <button
                            type="button"
                            onClick={openRequestPanel}
                            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-(--brand) px-4 py-2.5 text-sm font-medium text-white"
                        >
                            <Plus className="h-4 w-4" aria-hidden="true" />
                            Request a Product
                        </button>
                    </div>

                    {panelOpen ? (
                        <div ref={panelRef} className="rounded-2xl border border-(--line) bg-(--card) p-5">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <h2 className="font-display text-xl">Request a Product</h2>
                                    <p className="mt-1 text-sm text-(--ink-soft)">
                                        Pick what best describes the gap, add whatever details you have — Notes drafts
                                        itself from what you fill in below, just keep typing from there.
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={closeRequestPanel}
                                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-(--ink-soft) hover:bg-(--chip)"
                                    aria-label="Close"
                                >
                                    <X className="h-4 w-4" aria-hidden="true" />
                                </button>
                            </div>

                            <form onSubmit={handleSubmitRequest} className="mt-4 space-y-4">
                                {referenceProduct ? (
                                    <div className="flex items-center gap-2 rounded-xl border border-(--brand) bg-[rgba(32,98,176,0.06)] px-3 py-2 text-sm">
                                        <Link2 className="h-4 w-4 shrink-0 text-(--brand)" aria-hidden="true" />
                                        <span className="min-w-0 flex-1 truncate">
                                            Reference: <span className="font-medium">{referenceProduct.name}</span>
                                        </span>
                                        <button
                                            type="button"
                                            onClick={clearReference}
                                            className="shrink-0 text-xs font-medium text-(--ink-soft) hover:text-(--ink)"
                                        >
                                            Remove
                                        </button>
                                    </div>
                                ) : null}

                                <div className="grid gap-2 sm:grid-cols-3">
                                    {REQUEST_TYPE_OPTIONS.map((option) => (
                                        <button
                                            key={option.value}
                                            type="button"
                                            onClick={() => setRequestType(option.value)}
                                            className={`rounded-xl border px-4 py-2.5 text-left text-sm font-medium transition ${
                                                requestType === option.value
                                                    ? "border-(--brand) bg-[rgba(32,98,176,0.08)] text-(--brand)"
                                                    : "border-(--line) bg-white text-(--ink) hover:bg-(--chip)"
                                            }`}
                                        >
                                            {option.label}
                                        </button>
                                    ))}
                                </div>
                                <p className="text-xs text-(--ink-soft)">{activeTypeHint}</p>

                                <div className="grid gap-4 sm:grid-cols-3">
                                    <label className="block">
                                        <span className="mb-1.5 block text-sm font-medium">Brand</span>
                                        <input
                                            value={brand}
                                            onChange={(event) => setBrand(event.target.value)}
                                            placeholder="e.g. Michelin"
                                            list="product-request-brand-options"
                                            className="w-full rounded-xl border border-(--line) bg-white px-3 py-2"
                                        />
                                        <datalist id="product-request-brand-options">
                                            {brands.map((option) => (
                                                <option key={option.id} value={option.name} />
                                            ))}
                                        </datalist>
                                    </label>
                                    {showSizeField ? (
                                        <label className="block">
                                            <span className="mb-1.5 block text-sm font-medium">Size</span>
                                            <input
                                                value={size}
                                                onChange={(event) => setSize(event.target.value)}
                                                placeholder="e.g. 265/65R17"
                                                className="w-full rounded-xl border border-(--line) bg-white px-3 py-2"
                                            />
                                        </label>
                                    ) : null}
                                    {showPatternField ? (
                                        <label className="block">
                                            <span className="mb-1.5 block text-sm font-medium">Pattern</span>
                                            <input
                                                value={pattern}
                                                onChange={(event) => setPattern(event.target.value)}
                                                placeholder="e.g. Primacy 4"
                                                className="w-full rounded-xl border border-(--line) bg-white px-3 py-2"
                                            />
                                        </label>
                                    ) : null}
                                </div>

                                <label className="block">
                                    <span className="mb-1.5 block text-sm font-medium">Notes</span>
                                    <textarea
                                        value={notes}
                                        onChange={(event) => {
                                            const value = event.target.value;
                                            setNotes(value);
                                            if (value !== autoNotesRef.current) {
                                                setNotesTouched(true);
                                            }
                                        }}
                                        rows={3}
                                        placeholder="Auto-fills from the fields above — keep typing to add customer, quantity, urgency…"
                                        className="w-full rounded-xl border border-(--line) bg-white px-3 py-2"
                                    />
                                </label>

                                {submitError ? <p className="text-sm text-red-600">{submitError}</p> : null}

                                <div className="flex items-center gap-3">
                                    <button
                                        type="submit"
                                        disabled={submitting}
                                        className="rounded-xl bg-(--brand) px-5 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-70"
                                    >
                                        {submitting ? "Submitting..." : "Submit Request"}
                                    </button>
                                    {submitSuccess ? (
                                        <span className="inline-flex items-center gap-1.5 text-sm text-(--accent)">
                                            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                                            Request saved.
                                        </span>
                                    ) : null}
                                </div>
                            </form>
                        </div>
                    ) : null}

                    {searchError ? <p className="text-sm text-red-600">{searchError}</p> : null}

                    {!activated || query.trim().length < MIN_SEARCH_QUERY_LENGTH ? (
                        <p className="rounded-2xl border border-dashed border-(--line) bg-(--card) p-8 text-center text-sm text-(--ink-soft)">
                            Type at least {MIN_SEARCH_QUERY_LENGTH} characters to search the catalogue.
                        </p>
                    ) : searchLoading ? (
                        <p className="rounded-2xl border border-dashed border-(--line) bg-(--card) p-8 text-center text-sm text-(--ink-soft)">
                            Searching...
                        </p>
                    ) : results.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-(--line) bg-(--card) p-8 text-center">
                            <Package className="mx-auto h-8 w-8 text-(--ink-soft)" aria-hidden="true" />
                            <p className="mt-3 text-sm font-medium">No products matched &ldquo;{query.trim()}&rdquo;.</p>
                            <p className="mt-1 text-sm text-(--ink-soft)">
                                Doesn&rsquo;t exist in the catalogue yet? Request it below.
                            </p>
                            <button
                                type="button"
                                onClick={openRequestPanel}
                                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-(--brand) px-4 py-2 text-sm font-medium text-white"
                            >
                                <Plus className="h-4 w-4" aria-hidden="true" />
                                Request a Product
                            </button>
                        </div>
                    ) : (
                        <>
                            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                                {results.map((product) => (
                                    <article
                                        key={product.id}
                                        className="rounded-2xl border border-(--line) bg-(--card) p-5 shadow-[0_8px_20px_rgba(8,23,41,0.05)]"
                                    >
                                        <div className="flex items-start justify-between gap-2">
                                            <h3 className="text-base font-bold leading-snug">{product.name}</h3>
                                            <Boxes className="h-5 w-5 shrink-0 text-(--ink-soft)" aria-hidden="true" />
                                        </div>
                                        {product.sku ? (
                                            <p className="mt-0.5 text-xs text-(--ink-soft)">SKU: {product.sku}</p>
                                        ) : null}

                                        <div className="mt-3 flex flex-wrap gap-1.5">
                                            <span className="rounded-full bg-(--chip) px-2.5 py-1 text-xs font-semibold text-(--ink)">
                                                {product.brandName}
                                            </span>
                                            <span className="rounded-full bg-(--chip) px-2.5 py-1 text-xs font-semibold text-(--ink)">
                                                {product.originName}
                                            </span>
                                            <span className="rounded-full bg-(--chip) px-2.5 py-1 text-xs font-semibold text-(--ink)">
                                                Rim {product.rimDiameterName}
                                            </span>
                                        </div>
                                        <p className="mt-2 text-sm text-(--ink-soft)">{product.categoryName}</p>

                                        <div className="mt-3 border-t border-(--line) pt-3">
                                            {product.stockByLot.length > 0 ? (
                                                <div className="space-y-1.5">
                                                    <p className="text-lg font-bold text-(--accent)">
                                                        In stock: {product.currentStock}
                                                    </p>
                                                    <div className="flex flex-wrap gap-2">
                                                        {product.stockByLot.slice(0, 4).map((lot) => (
                                                            <span
                                                                key={`${lot.lotName}-${lot.companyName}`}
                                                                className="rounded-full bg-[rgba(74,184,72,0.12)] px-3 py-1.5 text-sm font-semibold text-(--accent)"
                                                            >
                                                                {lot.lotName} · {lot.companyName}: {lot.quantity}
                                                            </span>
                                                        ))}
                                                        {product.stockByLot.length > 4 ? (
                                                            <span className="rounded-full bg-(--chip) px-3 py-1.5 text-sm font-medium text-(--ink-soft)">
                                                                +{product.stockByLot.length - 4} more
                                                            </span>
                                                        ) : null}
                                                    </div>
                                                </div>
                                            ) : (
                                                <span className="inline-flex items-center gap-1.5 rounded-full bg-(--chip) px-3 py-1.5 text-sm font-semibold text-(--ink-soft)">
                                                    Out of stock
                                                </span>
                                            )}
                                        </div>

                                        {product.pricelists.length > 0 ? (
                                            <div className="mt-3 border-t border-(--line) pt-3">
                                                <p className="mb-1.5 flex items-center gap-1 text-xs font-medium text-(--ink-soft)">
                                                    <Tag className="h-3.5 w-3.5" aria-hidden="true" />
                                                    Pricelists
                                                </p>
                                                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                                                    {product.pricelists.map((entry, index) => (
                                                        <div
                                                            key={`${entry.pricelistName}-${entry.currencyCode}-${index}`}
                                                            className="min-w-0"
                                                        >
                                                            <p className="truncate text-xs text-(--ink-soft)">{entry.pricelistName}</p>
                                                            <p className="text-sm font-semibold">
                                                                {entry.currencyCode} {entry.price.toFixed(2)}
                                                            </p>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        ) : null}

                                        <button
                                            type="button"
                                            onClick={() => openRequestPanelFromCard(product)}
                                            className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-(--line) py-1.5 text-xs font-medium text-(--ink-soft) hover:border-(--brand) hover:text-(--brand)"
                                        >
                                            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                                            Request a different size/pattern
                                        </button>
                                    </article>
                                ))}
                            </div>

                            {hasMore ? (
                                <div className="flex justify-center">
                                    <button
                                        type="button"
                                        onClick={loadMoreResults}
                                        disabled={loadingMore}
                                        className="rounded-xl border border-(--line) bg-white px-5 py-2 text-sm font-medium text-(--ink) disabled:cursor-not-allowed disabled:opacity-70"
                                    >
                                        {loadingMore ? "Loading..." : "Load more"}
                                    </button>
                                </div>
                            ) : null}
                        </>
                    )}
                </div>
            ) : (
                <div className="mt-6 rounded-2xl border border-(--line) bg-(--card) p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <h2 className="font-display text-xl">{isAdmin ? "All Requests" : "My Requests"}</h2>
                            <p className="mt-1 text-sm text-(--ink-soft)">
                                {isAdmin
                                    ? "Every product request submitted by your team, newest first."
                                    : "Products you've requested, newest first."}
                            </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <button
                                type="button"
                                onClick={() => {
                                    setActiveTab("search");
                                    openRequestPanel();
                                }}
                                className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-(--line) bg-white px-4 py-2 text-sm font-medium text-(--ink) hover:bg-(--chip)"
                            >
                                <Plus className="h-4 w-4" aria-hidden="true" />
                                New Request
                            </button>
                        </div>
                    </div>

                    {requestsError ? <p className="mt-4 text-sm text-red-600">{requestsError}</p> : null}
                    {rowActionError ? <p className="mt-4 text-sm text-red-600">{rowActionError}</p> : null}

                    {requestsLoading ? (
                        <p className="mt-4 text-sm text-(--ink-soft)">Loading...</p>
                    ) : requests.length === 0 ? (
                        <p className="mt-4 text-sm text-(--ink-soft)">
                            {isAdmin ? "No product requests yet." : "You haven't requested any products yet."}
                        </p>
                    ) : (
                        <div className="mt-4 overflow-x-auto rounded-xl border border-(--line)">
                            <table className="min-w-full border-collapse text-left text-sm">
                                <thead className="bg-(--chip) text-(--ink-soft)">
                                    <tr>
                                        <th className="border border-(--line) px-4 py-3 font-medium">Date</th>
                                        <th className="border border-(--line) px-4 py-3 font-medium">Type</th>
                                        <th className="border border-(--line) px-4 py-3 font-medium">Brand</th>
                                        <th className="border border-(--line) px-4 py-3 font-medium">Size</th>
                                        <th className="border border-(--line) px-4 py-3 font-medium">Pattern</th>
                                        <th className="border border-(--line) px-4 py-3 font-medium">Reference</th>
                                        <th className="border border-(--line) px-4 py-3 font-medium">Notes</th>
                                        {isAdmin ? (
                                            <th className="border border-(--line) px-4 py-3 font-medium">Requested By</th>
                                        ) : null}
                                        <th className="border border-(--line) px-4 py-3 font-medium">Status</th>
                                        {isAdmin ? (
                                            <th className="border border-(--line) px-4 py-3 font-medium" />
                                        ) : null}
                                    </tr>
                                </thead>
                                <tbody>
                                    {requests.map((item) => (
                                        <tr
                                            key={item.id}
                                            className={item.seen ? "bg-[rgba(74,184,72,0.08)]" : undefined}
                                        >
                                            <td className="border border-(--line) px-4 py-3 text-(--ink-soft)">
                                                {formatDateTime(item.createdAt)}
                                            </td>
                                            <td className="border border-(--line) px-4 py-3">
                                                <span
                                                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${REQUEST_TYPE_STYLES[item.requestType]}`}
                                                >
                                                    {REQUEST_TYPE_LABELS[item.requestType]}
                                                </span>
                                            </td>
                                            <td className="border border-(--line) px-4 py-3">{item.brand || "-"}</td>
                                            <td className="border border-(--line) px-4 py-3">{item.size || "-"}</td>
                                            <td className="border border-(--line) px-4 py-3">{item.pattern || "-"}</td>
                                            <td className="border border-(--line) px-4 py-3 text-(--ink-soft)">
                                                {item.referenceProductName || "-"}
                                            </td>
                                            <td className="border border-(--line) px-4 py-3 text-(--ink-soft)">
                                                {item.notes || "-"}
                                            </td>
                                            {isAdmin ? (
                                                <td className="border border-(--line) px-4 py-3 text-(--ink-soft)">
                                                    {item.requestedByEmail || "-"}
                                                </td>
                                            ) : null}
                                            <td className="border border-(--line) px-4 py-3">
                                                {isAdmin ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => toggleSeen(item)}
                                                        disabled={pendingRowId === item.id}
                                                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
                                                            item.seen
                                                                ? "bg-(--accent) text-white"
                                                                : "bg-(--chip) text-(--ink-soft) hover:bg-[rgba(74,184,72,0.15)]"
                                                        }`}
                                                        title={item.seen ? `Seen by ${item.seenByEmail || "admin"}` : "Mark as seen"}
                                                    >
                                                        <Eye className="h-3 w-3" aria-hidden="true" />
                                                        {item.seen ? "Seen" : "New"}
                                                    </button>
                                                ) : (
                                                    <span
                                                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
                                                            item.seen
                                                                ? "bg-(--accent) text-white"
                                                                : "bg-(--chip) text-(--ink-soft)"
                                                        }`}
                                                    >
                                                        {item.seen ? "Seen" : "New"}
                                                    </span>
                                                )}
                                            </td>
                                            {isAdmin ? (
                                                <td className="border border-(--line) px-4 py-3">
                                                    {confirmDeleteId === item.id ? (
                                                        <div className="flex items-center gap-1.5 whitespace-nowrap">
                                                            <span className="text-xs text-(--ink-soft)">Delete?</span>
                                                            <button
                                                                type="button"
                                                                onClick={() => handleDelete(item)}
                                                                disabled={pendingRowId === item.id}
                                                                className="rounded-lg bg-red-600 px-2 py-1 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
                                                            >
                                                                {pendingRowId === item.id ? "…" : "Yes"}
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => setConfirmDeleteId(null)}
                                                                disabled={pendingRowId === item.id}
                                                                className="rounded-lg border border-(--line) px-2 py-1 text-xs font-medium text-(--ink-soft) disabled:cursor-not-allowed disabled:opacity-60"
                                                            >
                                                                No
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <button
                                                            type="button"
                                                            onClick={() => setConfirmDeleteId(item.id)}
                                                            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-(--ink-soft) hover:bg-red-50 hover:text-red-600"
                                                            aria-label="Delete request"
                                                            title="Delete request"
                                                        >
                                                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                                                        </button>
                                                    )}
                                                </td>
                                            ) : null}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}
        </section>
    );
}
