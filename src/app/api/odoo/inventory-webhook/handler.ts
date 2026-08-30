import { NextResponse } from "next/server";
import {
    applyInventoryWebhookToBackorders,
    getRecentInventoryWebhookEvents,
    recordInventoryWebhookEvent,
} from "@/lib/server/backorders-store";
import { getEquivalentProductIds } from "@/lib/server/odoo-client";
import { getStoredOdooCredentials } from "@/lib/server/auth-helpers";
import { OdooCredentials } from "@/types/odoo";

type InventoryWebhookPayload = {
    _action?: string;
    _id?: number;
    _model?: string;
    id?: number;
    qty_available?: number;
};

function getWebhookCredentialsFromEnv(): OdooCredentials | null {
    const url = process.env.ODOO_URL;
    const db = process.env.ODOO_DB;
    const username = process.env.ODOO_USERNAME;
    const password = process.env.ODOO_PASSWORD;

    if (!url || !db || !username || !password) {
        return null;
    }

    return { url, db, username, password };
}

/**
 * Odoo's inventory webhook fires on `product.template` and sends the template id,
 * but backorders may store the variant id (`product.product`). Resolve the incoming
 * id into every equivalent id (template + variant) so matching works regardless of
 * which id Odoo sends. Best-effort: on any failure we fall back to the raw id.
 */
async function resolveRelatedProductIds(
    productId: number
): Promise<{ ids: number[]; resolveError?: string }> {
    // Prefer env credentials; fall back to Odoo credentials stored in Firestore
    // (configured via app settings) so resolution works without env vars.
    const credentials = getWebhookCredentialsFromEnv() ?? (await getStoredOdooCredentials());
    if (!credentials) {
        return { ids: [productId], resolveError: "No Odoo credentials available (env or stored)." };
    }

    try {
        const equivalentIds = await getEquivalentProductIds(credentials, productId);
        const ids = Array.from(new Set([productId, ...equivalentIds]));
        return { ids };
    } catch (error) {
        // best-effort enrichment; fall back to the raw id but surface why
        return {
            ids: [productId],
            resolveError: error instanceof Error ? error.message : "Failed to resolve related product ids.",
        };
    }
}

function validateWebhookToken(pathToken?: string) {
    const expectedToken = process.env.WEBHOOK_TOKEN ?? process.env.ODOOPLUS_WEBHOOK_TOKEN;
    if (!expectedToken) {
        throw new Error("Webhook token is not configured.");
    }

    const normalizedPathToken = String(pathToken ?? "").trim();

    if (normalizedPathToken && normalizedPathToken === expectedToken) {
        return;
    }

    throw new Error("Unauthorized webhook token.");
}

export async function handleInventoryWebhookHealthCheck(pathToken?: string) {
    try {
        validateWebhookToken(pathToken);
        const recentEvents = await getRecentInventoryWebhookEvents();
        return NextResponse.json({
            ok: true,
            status: "live",
            message: "Inventory webhook endpoint is live. Send inventory updates with HTTP POST.",
            recentEvents,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to validate inventory webhook.";
        const status = message.includes("Unauthorized") ? 401 : message.includes("not configured") ? 500 : 400;
        return NextResponse.json({ ok: false, error: message }, { status });
    }
}

export async function handleInventoryWebhook(request: Request, pathToken?: string) {
    const receivedAt = new Date().toISOString();
    let payload: InventoryWebhookPayload | undefined;

    try {
        validateWebhookToken(pathToken);

        payload = (await request.json()) as InventoryWebhookPayload;

        const SUPPORTED_MODELS = ["product.template", "product.product"];
        if (payload._model && !SUPPORTED_MODELS.includes(payload._model)) {
            const body = { error: "Unsupported model." };
            await recordInventoryWebhookEvent({ receivedAt, status: 400, payload, error: body.error });
            return NextResponse.json(body, { status: 400 });
        }

        const productId = Number(payload.id ?? payload._id ?? 0);
        const qtyAvailable = Number(payload.qty_available ?? NaN);

        if (!Number.isFinite(productId) || productId <= 0) {
            const body = { error: "Invalid product id." };
            await recordInventoryWebhookEvent({ receivedAt, status: 400, payload, error: body.error });
            return NextResponse.json(body, { status: 400 });
        }

        if (!Number.isFinite(qtyAvailable)) {
            const body = { error: "Invalid qty_available." };
            await recordInventoryWebhookEvent({ receivedAt, status: 400, payload, error: body.error });
            return NextResponse.json(body, { status: 400 });
        }

        const { ids: relatedProductIds, resolveError } = await resolveRelatedProductIds(productId);

        const result = await applyInventoryWebhookToBackorders({
            productId,
            qtyAvailable,
            relatedProductIds,
        });

        const responseBody = {
            success: true,
            productId,
            relatedProductIds,
            ...(resolveError ? { resolveError } : {}),
            qtyAvailable,
            ...result,
        };

        await recordInventoryWebhookEvent({ receivedAt, status: 200, payload, result: responseBody });

        return NextResponse.json(responseBody);
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to process inventory webhook.";
        const status = message.includes("Unauthorized") ? 401 : message.includes("not configured") ? 500 : 400;
        if (status !== 401) {
            await recordInventoryWebhookEvent({ receivedAt, status, payload, error: message });
        }
        return NextResponse.json({ error: message }, { status });
    }
}
