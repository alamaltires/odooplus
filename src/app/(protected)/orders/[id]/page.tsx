"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Mail, MessageCircle, ShoppingCart } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { getOrderDetails } from "@/lib/client-odoo";
import { BackorderDetails } from "@/types/odoo";

export default function SingleOrderPage() {
    const params = useParams<{ id: string }>();
    const orderId = Number(params.id);
    const { user } = useAuth();

    const [data, setData] = useState<BackorderDetails | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [sendingEmail, setSendingEmail] = useState(false);
    const [sendingWhatsApp, setSendingWhatsApp] = useState(false);
    const [converting, setConverting] = useState(false);

    useEffect(() => {
        async function load() {
            if (!user) {
                return;
            }

            try {
                const orderDetails = await getOrderDetails(orderId);
                setData(orderDetails);
            } catch (loadError) {
                setError(loadError instanceof Error ? loadError.message : "Failed to load order.");
            } finally {
                setLoading(false);
            }
        }

        void load();
    }, [user, orderId]);

    const order = data?.order;
    const lines = data?.lines ?? [];

    const totalOrderedQty = lines.reduce((sum, line) => sum + line.ordered_qty, 0);
    const totalAvailableQty = lines.reduce((sum, line) => sum + line.available_qty, 0);
    const isReadyStatus =
        lines.length === 0 ||
        lines.every((line) => Number(line.available_qty ?? 0) >= Number(line.ordered_qty ?? 0));

    async function handleSaveBackorder() {
        if (!user || !data) {
            return;
        }

        setSaving(true);
        setError(null);
        setMessage(null);

        try {
            const idToken = await user.getIdToken();
            const response = await fetch("/api/backorders", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${idToken}`,
                },
                body: JSON.stringify({ details: data, source: "odoo" }),
            });

            const result = (await response.json()) as { error?: string };
            if (!response.ok || result.error) {
                throw new Error(result.error ?? "Failed to save backorder.");
            }

            setMessage("Backorder saved to Firestore.");
        } catch (saveError) {
            setError(
                saveError instanceof Error
                    ? saveError.message
                    : "Failed to save backorder details."
            );
        } finally {
            setSaving(false);
        }
    }

    async function handleSendEmail() {
        if (!data || !order) {
            return;
        }

        setSendingEmail(true);
        setError(null);
        setMessage(null);

        try {
            const response = await fetch("/api/backorder-email", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    orderId: order.id,
                    orderName: order.name,
                    customerName: order.customer_name,
                    salespersonName: order.salesperson_name,
                    products: lines.map((line) => ({
                        name: line.name || line.product_id?.[1] || "-",
                        orderedQty: line.ordered_qty,
                        availableQty: line.available_qty,
                    })),
                }),
            });

            const result = (await response.json()) as { error?: string };
            if (!response.ok || result.error) {
                throw new Error(result.error ?? "Failed to send email.");
            }

            setMessage("Email sent to salesperson successfully.");
        } catch (emailError) {
            setError(emailError instanceof Error ? emailError.message : "Failed to send email.");
        } finally {
            setSendingEmail(false);
        }
    }

    async function handleSendWhatsApp() {
        if (!data || !order) {
            return;
        }

        setSendingWhatsApp(true);
        setError(null);
        setMessage(null);

        try {
            const response = await fetch("/api/backorder-whatsapp", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    orderId: order.id,
                    orderName: order.name,
                    customerName: order.customer_name,
                    salespersonName: order.salesperson_name,
                    products: lines.map((line) => ({
                        name: line.name || line.product_id?.[1] || "-",
                        orderedQty: line.ordered_qty,
                        availableQty: line.available_qty,
                    })),
                }),
            });

            const result = (await response.json()) as { error?: string };
            if (!response.ok || result.error) {
                throw new Error(result.error ?? "Failed to send WhatsApp message.");
            }

            setMessage("WhatsApp message sent to salesperson successfully.");
        } catch (whatsAppError) {
            setError(
                whatsAppError instanceof Error
                    ? whatsAppError.message
                    : "Failed to send WhatsApp message."
            );
        } finally {
            setSendingWhatsApp(false);
        }
    }

    async function handleConvertToSalesOrder() {
        if (!data || !order) {
            return;
        }

        setConverting(true);
        setError(null);
        setMessage(null);

        try {
            const response = await fetch("/api/backorder-to-order", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    orderId: order.id,
                    orderName: order.name,
                    customerId: order.customer_name,
                    salespersonName: order.salesperson_name,
                    lines: lines.map((line) => ({
                        productId: line.product_id?.[0],
                        quantity: line.ordered_qty,
                        unitPrice: line.price_unit,
                    })),
                }),
            });

            const result = (await response.json()) as { error?: string; salesOrderId?: number };
            if (!response.ok || result.error) {
                throw new Error(result.error ?? "Failed to convert to sales order.");
            }

            setMessage(
                `Sales order created successfully in Odoo. Order ID: ${result.salesOrderId}`
            );
        } catch (convertError) {
            setError(
                convertError instanceof Error
                    ? convertError.message
                    : "Failed to convert to sales order."
            );
        } finally {
            setConverting(false);
        }
    }

    return (
        <section>
            <h1 className="font-display text-3xl">Backorder Details - {order?.name ?? `#${orderId}`}</h1>
            <p className="mt-1 text-sm text-(--ink-soft)">
                Showing only out of stock products for this sales order.
            </p>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                <button
                    type="button"
                    onClick={handleSaveBackorder}
                    disabled={saving || loading || !data}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-(--brand) px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-70 hover:opacity-90"
                >
                    {saving ? "Saving..." : "Save Backorder"}
                </button>

                {isReadyStatus && (
                    <>
                        <button
                            type="button"
                            onClick={handleSendEmail}
                            disabled={sendingEmail || loading || !data}
                            className="inline-flex items-center justify-center gap-2 rounded-xl border border-(--line) bg-white px-4 py-2 text-sm font-medium text-(--brand) disabled:cursor-not-allowed disabled:opacity-70 hover:bg-(--chip)"
                        >
                            <Mail className="h-4 w-4" />
                            {sendingEmail ? "Sending..." : "Email Salesperson"}
                        </button>

                        <button
                            type="button"
                            onClick={handleSendWhatsApp}
                            disabled={sendingWhatsApp || loading || !data}
                            className="inline-flex items-center justify-center gap-2 rounded-xl border border-(--line) bg-white px-4 py-2 text-sm font-medium text-(--brand) disabled:cursor-not-allowed disabled:opacity-70 hover:bg-(--chip)"
                        >
                            <MessageCircle className="h-4 w-4" />
                            {sendingWhatsApp ? "Sending..." : "WhatsApp Salesperson"}
                        </button>

                        <button
                            type="button"
                            onClick={handleConvertToSalesOrder}
                            disabled={converting || loading || !data}
                            className="inline-flex items-center justify-center gap-2 rounded-xl bg-(--accent) px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-70 hover:opacity-90"
                        >
                            <ShoppingCart className="h-4 w-4" />
                            {converting ? "Converting..." : "Convert to Sales Order"}
                        </button>
                    </>
                )}
            </div>

            {!isReadyStatus && (
                <p className="mt-4 rounded-xl bg-yellow-50 px-4 py-3 text-sm text-(--ink-soft)">
                    ⓘ Action buttons will be enabled once this backorder reaches Ready status.
                    Currently: {totalAvailableQty} available, {totalOrderedQty} ordered.
                </p>
            )}

            {error ? <p className="mt-4 text-red-600">{error}</p> : null}
            {message ? <p className="mt-4 text-sm text-(--accent)">{message}</p> : null}

            <div className="mt-6 rounded-2xl border border-(--line) bg-(--card) p-5">
                <h2 className="font-display text-xl">Sales Order Information</h2>

                {loading ? <p className="mt-4 text-sm">Loading order...</p> : null}

                {!loading && order ? (
                    <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                        <p>
                            <span className="text-(--ink-soft)">Customer:</span> {order.customer_name}
                        </p>
                        <p>
                            <span className="text-(--ink-soft)">Salesperson:</span> {order.salesperson_name}
                        </p>
                        <p>
                            <span className="text-(--ink-soft)">Order Date:</span>{" "}
                            {order.order_date ? order.order_date.slice(0, 10) : "-"}
                        </p>
                        <p>
                            <span className="text-(--ink-soft)">Payment Terms:</span> {order.payment_terms}
                        </p>
                    </div>
                ) : null}
            </div>

            <div className="mt-6 rounded-2xl border border-(--line) bg-(--card) p-5">
                <h2 className="font-display text-xl">Out of Stock Products</h2>

                {!loading && lines.length === 0 ? (
                    <p className="mt-4 text-sm text-(--ink-soft)">
                        No out of stock products for this order.
                    </p>
                ) : null}

                {lines.length > 0 ? (
                    <div className="mt-4 overflow-hidden rounded-xl border border-(--line)">
                        <table className="w-full border-collapse text-left text-sm">
                            <thead className="bg-(--chip) text-(--ink-soft)">
                                <tr>
                                    <th className="px-4 py-3 font-medium">Product</th>
                                    <th className="px-4 py-3 font-medium">Ordered Quantity</th>
                                    <th className="px-4 py-3 font-medium">Available Quantity</th>
                                    <th className="px-4 py-3 font-medium">Shortage</th>
                                    <th className="px-4 py-3 font-medium">Price</th>
                                </tr>
                            </thead>
                            <tbody>
                                {lines.map((line) => (
                                    <tr key={line.id} className="border-t border-(--line)">
                                        <td className="px-4 py-3">{line.name || line.product_id?.[1] || "-"}</td>
                                        <td className="px-4 py-3">{line.ordered_qty}</td>
                                        <td className="px-4 py-3">{line.available_qty}</td>
                                        <td className="px-4 py-3">{line.shortage_qty}</td>
                                        <td className="px-4 py-3">{Number(line.price_unit).toFixed(2)} AED</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : null}
            </div>
        </section>
    );
}
