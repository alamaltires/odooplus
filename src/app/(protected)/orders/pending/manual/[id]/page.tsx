"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { CheckCircle2, Mail, MessageCircle, Pencil, Search, ShoppingCart } from "lucide-react";
import { getProducts } from "@/lib/client-odoo";
import { useAuth } from "@/lib/auth-context";
import { OdooProductOption, SavedBackorder } from "@/types/odoo";

// ─── helpers ────────────────────────────────────────────────────────────────

type EditLine = {
    id: string;
    productId: string;
    productName: string; // tracks free-text name if product_id absent
    orderedQty: string;
    availableQty: string;
    shortageQty: string;
    unitPrice: string;
};

function createEmptyEditLine(): EditLine {
    return {
        id: `line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        productId: "",
        productName: "",
        orderedQty: "",
        availableQty: "",
        shortageQty: "",
        unitPrice: "",
    };
}

function normalizeNumber(value: string) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function calculateLineShortage(orderedQty: string, availableQty: string) {
    return Math.max(0, normalizeNumber(orderedQty) - normalizeNumber(availableQty));
}

function formatDate(value: string | undefined) {
    if (!value) return "-";
    return value.slice(0, 10);
}

function formatDateTime(value: string | undefined) {
    if (!value) return "-";
    return value.replace("T", " ").slice(0, 16);
}

// ─── SearchableListBox ───────────────────────────────────────────────────────

type ListBoxOption = { id: number; name: string };

function SearchableListBox({
    label,
    selectedId,
    selectedLabel,
    options,
    placeholder,
    disabled,
    loading,
    hasMore,
    onOpen,
    onQueryChange,
    onLoadMore,
    onSelect,
}: {
    label: string;
    selectedId: string;
    selectedLabel?: string;
    options: ListBoxOption[];
    placeholder: string;
    disabled?: boolean;
    loading?: boolean;
    hasMore?: boolean;
    onOpen?: () => void;
    onQueryChange?: (value: string) => void;
    onLoadMore?: () => void;
    onSelect: (value: string, name: string) => void;
}) {
    const [query, setQuery] = useState("");
    const [menuOpen, setMenuOpen] = useState(false);

    const selectedOption = options.find((o) => String(o.id) === selectedId);
    const inputValue =
        selectedId && !menuOpen && !query ? selectedOption?.name ?? selectedLabel ?? "" : query;

    const filteredOptions = onQueryChange
        ? options
        : options.filter((o) => o.name.toLowerCase().includes(query.trim().toLowerCase()));

    return (
        <label className="relative block text-sm">
            <span className="mb-2 block font-medium">{label}</span>
            <div className="relative">
                <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--ink-soft)"
                    aria-hidden="true"
                />
                <input
                    value={inputValue}
                    onChange={(event) => {
                        setQuery(event.target.value);
                        onSelect("", event.target.value);
                        setMenuOpen(true);
                        onQueryChange?.(event.target.value);
                    }}
                    onFocus={() => {
                        setMenuOpen(true);
                        onOpen?.();
                    }}
                    onBlur={() => {
                        window.setTimeout(() => {
                            setMenuOpen(false);
                            if (!selectedId) setQuery("");
                        }, 120);
                    }}
                    placeholder={placeholder}
                    disabled={disabled}
                    className="w-full rounded-xl border border-(--line) bg-white py-2 pl-10 pr-3"
                />
            </div>

            {menuOpen ? (
                <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-xl border border-(--line) bg-white shadow-lg">
                    <ul className="max-h-64 overflow-auto p-1">
                        {filteredOptions.map((option) => (
                            <li key={option.id}>
                                <button
                                    type="button"
                                    onMouseDown={() => {
                                        onSelect(String(option.id), option.name);
                                        setQuery(option.name);
                                        setMenuOpen(false);
                                    }}
                                    className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-(--chip)"
                                >
                                    {option.name}
                                </button>
                            </li>
                        ))}
                        {loading ? (
                            <li className="px-3 py-2 text-xs text-(--ink-soft)">Loading…</li>
                        ) : null}
                        {!loading && filteredOptions.length === 0 ? (
                            <li className="px-3 py-2 text-xs text-(--ink-soft)">No results found.</li>
                        ) : null}
                    </ul>
                    {hasMore && onLoadMore ? (
                        <div className="border-t border-(--line) p-1">
                            <button
                                type="button"
                                onMouseDown={onLoadMore}
                                className="w-full rounded-lg px-3 py-2 text-left text-sm text-(--brand) hover:bg-(--chip)"
                            >
                                Load more
                            </button>
                        </div>
                    ) : null}
                </div>
            ) : null}
        </label>
    );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ManualBackorderDetailsPage() {
    const PRODUCT_PAGE_SIZE = 10;
    const params = useParams<{ id: string }>();
    const { user } = useAuth();

    // view state
    const [backorder, setBackorder] = useState<SavedBackorder | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [sendingEmail, setSendingEmail] = useState(false);
    const [sendingWhatsApp, setSendingWhatsApp] = useState(false);
    const [converting, setConverting] = useState(false);
    const [proceeding, setProceeding] = useState(false);

    // edit state
    const [editing, setEditing] = useState(false);
    const [editOrderNumber, setEditOrderNumber] = useState("");
    const [editCustomerName, setEditCustomerName] = useState("");
    const [editSalespersonName, setEditSalespersonName] = useState("");
    const [editOrderDate, setEditOrderDate] = useState("");
    const [editLines, setEditLines] = useState<EditLine[]>([createEmptyEditLine()]);
    const [saving, setSaving] = useState(false);

    // product lookup
    const [products, setProducts] = useState<OdooProductOption[]>([]);
    const [productNameById, setProductNameById] = useState<Record<number, string>>({});
    const [loadingProducts, setLoadingProducts] = useState(false);
    const [productQuery, setProductQuery] = useState("");
    const [productOffset, setProductOffset] = useState(0);
    const [hasMoreProducts, setHasMoreProducts] = useState(false);
    const [productListActivated, setProductListActivated] = useState(false);
    const productListActivatedRef = useRef(false);

    const backorderLines = backorder?.products ?? [];
    const totalOrderedQty = backorderLines.reduce((sum, line) => sum + Number(line.ordered_quantity ?? 0), 0);
    const totalAvailableQty = backorderLines.reduce((sum, line) => sum + Number(line.available_quantity ?? 0), 0);
    const isReadyStatus =
        (backorder?.status === "ready") ||
        (backorderLines.length === 0) ||
        backorderLines.every(
            (line) => Number(line.available_quantity ?? 0) >= Number(line.ordered_quantity ?? 0)
        );

    // ── load backorder ───────────────────────────────────────────────────────
    async function loadBackorder() {
        if (!user) {
            return;
        }

        try {
            const idToken = await user.getIdToken();
            const response = await fetch(`/api/backorders/${params.id}`, {
                cache: "no-store",
                headers: {
                    Authorization: `Bearer ${idToken}`,
                },
            });
            const result = (await response.json()) as { item?: SavedBackorder; error?: string };
            if (!response.ok || result.error || !result.item) {
                throw new Error(result.error ?? "Failed to load backorder.");
            }
            setBackorder(result.item);
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : "Failed to load backorder.");
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        if (!user) {
            return;
        }

        void loadBackorder();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [params.id, user]);

    // ── product search ───────────────────────────────────────────────────────
    const loadProducts = useCallback(
        async ({ query, offset, append }: { query: string; offset: number; append: boolean }) => {
            setLoadingProducts(true);
            try {
                const response = await getProducts({ query, limit: PRODUCT_PAGE_SIZE, offset });
                setProducts((current) => {
                    if (!append) return response.products;
                    const existingIds = new Set(current.map((p) => p.id));
                    return [...current, ...response.products.filter((p) => !existingIds.has(p.id))];
                });
                setProductNameById((current) => {
                    const next = { ...current };
                    for (const p of response.products) next[p.id] = p.name;
                    return next;
                });
                setHasMoreProducts(response.hasMore);
                setProductOffset(offset + response.products.length);
            } catch {
                // silently fail; user can retry by searching again
            } finally {
                setLoadingProducts(false);
            }
        },
        []
    );

    useEffect(() => {
        if (!productListActivated) return;
        const id = window.setTimeout(() => {
            void loadProducts({ query: productQuery, offset: 0, append: false });
        }, 250);
        return () => window.clearTimeout(id);
    }, [loadProducts, productListActivated, productQuery]);

    const loadMoreProducts = useCallback(() => {
        if (loadingProducts || !hasMoreProducts) return;
        void loadProducts({ query: productQuery, offset: productOffset, append: true });
    }, [hasMoreProducts, loadProducts, loadingProducts, productOffset, productQuery]);

    // ── edit helpers ─────────────────────────────────────────────────────────
    function enterEditMode() {
        if (!backorder) return;

        // Seed product name map from saved products
        const nameMap: Record<number, string> = { ...productNameById };
        for (const p of backorder.products) {
            if (p.product_id) nameMap[p.product_id] = p.name;
        }
        setProductNameById(nameMap);

        setEditOrderNumber(backorder.order_number);
        setEditCustomerName(backorder.customer_name);
        setEditSalespersonName(backorder.salesperson_name);
        setEditOrderDate(backorder.order_date?.slice(0, 10) ?? "");
        setEditLines(
            backorder.products.length > 0
                ? backorder.products.map((p, i) => ({
                    id: `line-edit-${i}`,
                    productId: p.product_id ? String(p.product_id) : "",
                    productName: p.name,
                    orderedQty: String(p.ordered_quantity),
                    availableQty: String(p.available_quantity),
                    shortageQty: String(calculateLineShortage(String(p.ordered_quantity), String(p.available_quantity))),
                    unitPrice: String(p.price),
                }))
                : [createEmptyEditLine()]
        );
        setError(null);
        setMessage(null);
        setEditing(true);
    }

    function updateLine(id: string, field: keyof EditLine, value: string) {
        setEditLines((current) =>
            current.map((line) => {
                if (line.id !== id) {
                    return line;
                }

                const next = { ...line, [field]: value };
                if (field === "orderedQty" || field === "availableQty") {
                    next.shortageQty = String(calculateLineShortage(next.orderedQty, next.availableQty));
                }

                return next;
            })
        );
    }

    function addLine() {
        setEditLines((current) => [...current, createEmptyEditLine()]);
    }

    function removeLine(id: string) {
        setEditLines((current) => (current.length <= 1 ? current : current.filter((l) => l.id !== id)));
    }

    async function handleUpdate(event: FormEvent) {
        event.preventDefault();

        if (!user) {
            setError("You must be signed in to update this backorder.");
            return;
        }

        const validLines = editLines.filter((line) => {
            const name = line.productId
                ? (productNameById[Number(line.productId)] ?? line.productName)
                : line.productName;
            return name.trim().length > 0;
        });

        if (!editCustomerName.trim()) { setError("Customer name is required."); return; }
        if (!editSalespersonName.trim()) { setError("Salesperson name is required."); return; }
        if (validLines.length === 0) { setError("Add at least one product line."); return; }

        setSaving(true);
        setError(null);
        setMessage(null);

        try {
            const idToken = await user.getIdToken();
            const products = validLines.map((line) => {
                const productId = Number(line.productId) || null;
                const name = productId
                    ? (productNameById[productId] ?? line.productName)
                    : line.productName.trim() || "-";
                return {
                    product_id: productId,
                    name,
                    ordered_quantity: normalizeNumber(line.orderedQty),
                    available_quantity: normalizeNumber(line.availableQty),
                    shortage: calculateLineShortage(line.orderedQty, line.availableQty),
                    price: normalizeNumber(line.unitPrice),
                };
            });

            const response = await fetch(`/api/backorders/${params.id}`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${idToken}`,
                },
                body: JSON.stringify({
                    order_number: editOrderNumber.trim(),
                    customer_name: editCustomerName.trim(),
                    salesperson_name: editSalespersonName.trim(),
                    order_date: editOrderDate,
                    products,
                }),
            });

            const result = (await response.json()) as { item?: SavedBackorder; error?: string };
            if (!response.ok || result.error || !result.item) {
                throw new Error(result.error ?? "Failed to update backorder.");
            }

            setBackorder(result.item);
            setEditing(false);
            setMessage("Backorder updated successfully.");
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : "Failed to update backorder.");
        } finally {
            setSaving(false);
        }
    }

    async function handleSendEmail() {
        if (!backorder || !user) {
            return;
        }

        setSendingEmail(true);
        setError(null);
        setMessage(null);

        try {
            const idToken = await user.getIdToken();
            const response = await fetch("/api/backorder-email", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${idToken}`,
                },
                body: JSON.stringify({
                    orderId: backorder.order_id,
                    orderName: backorder.order_number,
                    customerName: backorder.customer_name,
                    salespersonName: backorder.salesperson_name,
                    products: backorder.products.map((line) => ({
                        name: line.name || "-",
                        orderedQty: Number(line.ordered_quantity ?? 0),
                        availableQty: Number(line.available_quantity ?? 0),
                    })),
                }),
            });

            const result = (await response.json()) as { error?: string };
            if (!response.ok || result.error) {
                throw new Error(result.error ?? "Failed to send email.");
            }

            setMessage("Email sent to salesperson successfully.");
        } catch (sendError) {
            setError(sendError instanceof Error ? sendError.message : "Failed to send email.");
        } finally {
            setSendingEmail(false);
        }
    }

    async function handleSendWhatsApp() {
        if (!backorder || !user) {
            return;
        }

        setSendingWhatsApp(true);
        setError(null);
        setMessage(null);

        try {
            const idToken = await user.getIdToken();
            const response = await fetch("/api/backorder-whatsapp", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${idToken}`,
                },
                body: JSON.stringify({
                    orderId: backorder.order_id,
                    orderName: backorder.order_number,
                    customerName: backorder.customer_name,
                    salespersonName: backorder.salesperson_name,
                    products: backorder.products.map((line) => ({
                        name: line.name || "-",
                        orderedQty: Number(line.ordered_quantity ?? 0),
                        availableQty: Number(line.available_quantity ?? 0),
                    })),
                }),
            });

            const result = (await response.json()) as { error?: string };
            if (!response.ok || result.error) {
                throw new Error(result.error ?? "Failed to send WhatsApp message.");
            }

            setMessage("WhatsApp message sent to salesperson successfully.");
        } catch (sendError) {
            setError(sendError instanceof Error ? sendError.message : "Failed to send WhatsApp message.");
        } finally {
            setSendingWhatsApp(false);
        }
    }

    async function handleConvertToSalesOrder() {
        if (!backorder || !user) {
            return;
        }

        if (backorder.status === "procced") {
            setMessage("This backorder is already marked as procced.");
            return;
        }

        setConverting(true);
        setError(null);
        setMessage(null);

        try {
            const idToken = await user.getIdToken();
            const response = await fetch("/api/backorder-to-order", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${idToken}`,
                },
                body: JSON.stringify({
                    orderId: backorder.order_id,
                    orderName: backorder.order_number,
                    customerId: backorder.customer_name,
                    salespersonName: backorder.salesperson_name,
                    lines: backorder.products.map((line) => ({
                        productId: Number(line.product_variant_id ?? line.product_id ?? 0) || undefined,
                        quantity: Number(line.ordered_quantity ?? 0),
                        unitPrice: Number(line.price ?? 0),
                    })),
                }),
            });

            const result = (await response.json()) as { error?: string; salesOrderId?: number };
            if (!response.ok || result.error) {
                throw new Error(result.error ?? "Failed to convert to sales order.");
            }

            setBackorder((current) =>
                current
                    ? {
                        ...current,
                        status: "procced",
                    }
                    : current
            );
            setMessage(`Sales order created successfully in Odoo. Order ID: ${result.salesOrderId}`);
        } catch (convertError) {
            setError(convertError instanceof Error ? convertError.message : "Failed to convert to sales order.");
        } finally {
            setConverting(false);
        }
    }

    async function handleMarkAsProcced() {
        if (!backorder || !user) {
            return;
        }

        if (backorder.status === "procced") {
            setMessage("This backorder is already marked as procced.");
            return;
        }

        setProceeding(true);
        setError(null);
        setMessage(null);

        try {
            const idToken = await user.getIdToken();
            const response = await fetch(`/api/backorders/${params.id}/proceed`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${idToken}`,
                },
            });

            const result = (await response.json()) as { item?: SavedBackorder; error?: string };
            if (!response.ok || result.error || !result.item) {
                throw new Error(result.error ?? "Failed to mark backorder as procced.");
            }

            setBackorder(result.item);
            setMessage("Backorder marked as procced.");
        } catch (proceedError) {
            setError(proceedError instanceof Error ? proceedError.message : "Failed to mark backorder as procced.");
        } finally {
            setProceeding(false);
        }
    }

    // ── render ───────────────────────────────────────────────────────────────
    return (
        <section className="max-w-6xl">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h1 className="font-display text-3xl">
                        Saved Backorder{backorder ? ` — ${backorder.order_number}` : ""}
                    </h1>
                    <p className="mt-1 text-sm text-(--ink-soft)">
                        {editing
                            ? "Edit the backorder details below and save."
                            : "Review the backorder snapshot saved in Firestore."}
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    {backorder && !editing && backorder.source === "manual" ? (
                        <button
                            type="button"
                            onClick={enterEditMode}
                            className="inline-flex items-center gap-2 rounded-xl border border-(--line) bg-white px-4 py-2 text-sm font-medium text-(--ink) hover:bg-(--chip)"
                        >
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                            Edit
                        </button>
                    ) : null}
                    <Link
                        href="/orders/pending"
                        className="inline-flex items-center justify-center rounded-xl border border-(--line) bg-white px-4 py-2 text-sm font-medium text-(--ink)"
                    >
                        Back to Pending Orders
                    </Link>
                </div>
            </div>

            {loading ? <p className="mt-6 text-sm">Loading backorder…</p> : null}
            {error ? <p className="mt-6 text-sm text-red-600">{error}</p> : null}
            {message ? <p className="mt-6 text-sm text-(--accent)">{message}</p> : null}

            {/* ── View mode ── */}
            {backorder && !editing ? (
                <>
                    <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                        {isReadyStatus ? (
                            <>
                                {backorder.status !== "procced" ? (
                                    <button
                                        type="button"
                                        onClick={handleMarkAsProcced}
                                        disabled={proceeding || converting || loading}
                                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 disabled:cursor-not-allowed disabled:opacity-70 hover:bg-emerald-100"
                                    >
                                        <CheckCircle2 className="h-4 w-4" />
                                        {proceeding ? "Marking..." : "Mark as Procced"}
                                    </button>
                                ) : null}

                                <button
                                    type="button"
                                    onClick={handleSendEmail}
                                    disabled={sendingEmail || loading || !user || proceeding}
                                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-(--line) bg-white px-4 py-2 text-sm font-medium text-(--brand) disabled:cursor-not-allowed disabled:opacity-70 hover:bg-(--chip)"
                                >
                                    <Mail className="h-4 w-4" />
                                    {sendingEmail ? "Sending..." : "Email Salesperson"}
                                </button>

                                <button
                                    type="button"
                                    onClick={handleSendWhatsApp}
                                    disabled={sendingWhatsApp || loading || !user || proceeding}
                                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-(--line) bg-white px-4 py-2 text-sm font-medium text-(--brand) disabled:cursor-not-allowed disabled:opacity-70 hover:bg-(--chip)"
                                >
                                    <MessageCircle className="h-4 w-4" />
                                    {sendingWhatsApp ? "Sending..." : "WhatsApp Salesperson"}
                                </button>

                                <button
                                    type="button"
                                    onClick={handleConvertToSalesOrder}
                                    disabled={converting || loading || !user || proceeding || backorder.status === "procced"}
                                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-(--accent) px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-70 hover:opacity-90"
                                >
                                    <ShoppingCart className="h-4 w-4" />
                                    {backorder.status === "procced"
                                        ? "Already Procced"
                                        : converting
                                            ? "Converting..."
                                            : "Convert to Sales Order"}
                                </button>
                            </>
                        ) : (
                            <p className="rounded-xl bg-yellow-50 px-4 py-3 text-sm text-(--ink-soft)">
                                Actions are enabled once this backorder is ready. Currently: {totalAvailableQty} available, {totalOrderedQty} ordered.
                            </p>
                        )}
                    </div>

                    <div className="mt-6 rounded-2xl border border-(--line) bg-(--card) p-5">
                        <h2 className="font-display text-xl">Sales Order Information</h2>
                        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-3">
                            <p><span className="text-(--ink-soft)">Order Number:</span> {backorder.order_number}</p>
                            <p><span className="text-(--ink-soft)">Customer:</span> {backorder.customer_name}</p>
                            <p><span className="text-(--ink-soft)">Salesperson:</span> {backorder.salesperson_name}</p>
                            <p><span className="text-(--ink-soft)">Order Date:</span> {formatDate(backorder.order_date)}</p>
                            <p><span className="text-(--ink-soft)">Saved At:</span> {formatDateTime(backorder.saved_at)}</p>
                            <p><span className="text-(--ink-soft)">Source:</span> {backorder.source ?? "manual"}</p>
                        </div>
                    </div>

                    <div className="mt-6 rounded-2xl border border-(--line) bg-(--card) p-5">
                        <h2 className="font-display text-xl">Out of Stock Products</h2>
                        {backorder.products.length === 0 ? (
                            <p className="mt-4 text-sm text-(--ink-soft)">No products were saved on this backorder.</p>
                        ) : (
                            <div className="mt-4 overflow-hidden rounded-xl border border-(--line)">
                                <table className="w-full border-collapse text-left text-sm">
                                    <thead className="bg-(--chip) text-(--ink-soft)">
                                        <tr>
                                            <th className="px-4 py-3 font-medium">Product</th>
                                            <th className="px-4 py-3 font-medium">Ordered Qty</th>
                                            <th className="px-4 py-3 font-medium">Available Qty</th>
                                            <th className="px-4 py-3 font-medium">Shortage</th>
                                            <th className="px-4 py-3 font-medium">Price</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {backorder.products.map((product, index) => (
                                            <tr key={`${product.name}-${index}`} className="border-t border-(--line)">
                                                <td className="px-4 py-3">{product.name}</td>
                                                <td className="px-4 py-3">{product.ordered_quantity}</td>
                                                <td className="px-4 py-3">{product.available_quantity}</td>
                                                <td className="px-4 py-3">{product.shortage}</td>
                                                <td className="px-4 py-3">{Number(product.price).toFixed(2)} AED</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </>
            ) : null}

            {/* ── Edit mode ── */}
            {backorder && editing ? (
                <form onSubmit={(e) => void handleUpdate(e)} className="mt-6 space-y-6">
                    <div className="rounded-2xl border border-(--line) bg-(--card) p-5">
                        <h2 className="font-display text-xl">Sales Order Information</h2>
                        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                            <label className="block text-sm">
                                <span className="mb-2 block font-medium">Order Number</span>
                                <input
                                    value={editOrderNumber}
                                    onChange={(e) => setEditOrderNumber(e.target.value)}
                                    required
                                    className="w-full rounded-xl border border-(--line) bg-white px-3 py-2"
                                />
                            </label>
                            <label className="block text-sm">
                                <span className="mb-2 block font-medium">Customer Name</span>
                                <input
                                    value={editCustomerName}
                                    onChange={(e) => setEditCustomerName(e.target.value)}
                                    required
                                    className="w-full rounded-xl border border-(--line) bg-white px-3 py-2"
                                />
                            </label>
                            <label className="block text-sm">
                                <span className="mb-2 block font-medium">Salesperson Name</span>
                                <input
                                    value={editSalespersonName}
                                    onChange={(e) => setEditSalespersonName(e.target.value)}
                                    required
                                    className="w-full rounded-xl border border-(--line) bg-white px-3 py-2"
                                />
                            </label>
                            <label className="block text-sm">
                                <span className="mb-2 block font-medium">Order Date</span>
                                <input
                                    type="date"
                                    value={editOrderDate}
                                    onChange={(e) => setEditOrderDate(e.target.value)}
                                    required
                                    className="w-full rounded-xl border border-(--line) bg-white px-3 py-2"
                                />
                            </label>
                        </div>
                    </div>

                    <div className="rounded-2xl border border-(--line) bg-(--card) p-5">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <h2 className="font-display text-xl">Out of Stock Products</h2>
                                <p className="mt-1 text-sm text-(--ink-soft)">
                                    Edit product lines. Use the search to pick an Odoo product, or type a name freely.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={addLine}
                                className="inline-flex items-center justify-center rounded-xl border border-(--line) bg-white px-4 py-2 text-sm font-medium text-(--ink)"
                            >
                                Add Product Line
                            </button>
                        </div>

                        <div className="mt-4 space-y-4">
                            {editLines.map((line, index) => (
                                <div key={line.id} className="rounded-2xl border border-(--line) bg-white p-4">
                                    <div className="flex items-center justify-between gap-3">
                                        <p className="text-sm font-semibold text-(--ink)">Product Line {index + 1}</p>
                                        <button
                                            type="button"
                                            onClick={() => removeLine(line.id)}
                                            disabled={editLines.length === 1}
                                            className="text-sm font-medium text-(--brand) disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            Remove
                                        </button>
                                    </div>
                                    <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                                        <div className="xl:col-span-2">
                                            {line.productName ? (
                                                <p className="mb-1 text-xs text-(--ink-soft)">
                                                    Saved: <span className="font-medium text-(--ink)">{line.productName}</span>
                                                </p>
                                            ) : null}
                                            <SearchableListBox
                                                label="Product Name"
                                                selectedId={line.productId}
                                                selectedLabel={line.productName || undefined}
                                                options={products.map((p) => ({ id: p.id, name: p.name }))}
                                                placeholder="Search Odoo products"
                                                loading={loadingProducts}
                                                hasMore={hasMoreProducts}
                                                onOpen={() => {
                                                    if (!productListActivatedRef.current) {
                                                        productListActivatedRef.current = true;
                                                        setProductListActivated(true);
                                                    }
                                                }}
                                                onQueryChange={(value) => {
                                                    if (!productListActivatedRef.current) {
                                                        productListActivatedRef.current = true;
                                                        setProductListActivated(true);
                                                    }
                                                    setProductQuery(value);
                                                }}
                                                onLoadMore={loadMoreProducts}
                                                onSelect={(id, name) => {
                                                    updateLine(line.id, "productId", id);
                                                    updateLine(line.id, "productName", name);
                                                }}
                                            />
                                        </div>
                                        <label className="block text-sm">
                                            <span className="mb-2 block font-medium">Ordered Qty</span>
                                            <input
                                                type="number"
                                                min="0"
                                                step="0.01"
                                                value={line.orderedQty}
                                                onChange={(e) => updateLine(line.id, "orderedQty", e.target.value)}
                                                className="w-full rounded-xl border border-(--line) bg-(--card) px-3 py-2"
                                            />
                                        </label>
                                        <label className="block text-sm">
                                            <span className="mb-2 block font-medium">Available Qty</span>
                                            <input
                                                type="number"
                                                min="0"
                                                step="0.01"
                                                value={line.availableQty}
                                                onChange={(e) => updateLine(line.id, "availableQty", e.target.value)}
                                                className="w-full rounded-xl border border-(--line) bg-(--card) px-3 py-2"
                                            />
                                        </label>
                                        <label className="block text-sm">
                                            <span className="mb-2 block font-medium">Shortage</span>
                                            <input
                                                type="number"
                                                min="0"
                                                step="0.01"
                                                value={line.shortageQty}
                                                readOnly
                                                className="w-full rounded-xl border border-(--line) bg-slate-50 px-3 py-2"
                                            />
                                        </label>
                                        <label className="block text-sm">
                                            <span className="mb-2 block font-medium">Price (AED)</span>
                                            <input
                                                type="number"
                                                min="0"
                                                step="0.01"
                                                value={line.unitPrice}
                                                onChange={(e) => updateLine(line.id, "unitPrice", e.target.value)}
                                                className="w-full rounded-xl border border-(--line) bg-(--card) px-3 py-2"
                                            />
                                        </label>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                        <button
                            type="submit"
                            disabled={saving}
                            className="inline-flex items-center justify-center rounded-xl bg-(--brand) px-5 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-70"
                        >
                            {saving ? "Saving…" : "Save Changes"}
                        </button>
                        <button
                            type="button"
                            disabled={saving}
                            onClick={() => { setEditing(false); setError(null); }}
                            className="inline-flex items-center justify-center rounded-xl border border-(--line) bg-white px-5 py-2.5 text-sm font-medium text-(--ink) disabled:opacity-70"
                        >
                            Cancel
                        </button>
                        {error ? <p className="text-sm text-red-600">{error}</p> : null}
                    </div>
                </form>
            ) : null}
        </section>
    );
}