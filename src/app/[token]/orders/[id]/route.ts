import { NextResponse } from "next/server";
import { getOrderBackorderDetails } from "@/lib/server/odoo-client";
import { saveBackorderSnapshot } from "@/lib/server/backorders-store";
import { OdooCredentials } from "@/types/odoo";

type WebhookPayload = {
    id?: number;
    _id?: number;
    _model?: string;
};

function getWebhookCredentialsFromEnv(): OdooCredentials {
    const url = process.env.ODOO_URL;
    const db = process.env.ODOO_DB;
    const username = process.env.ODOO_USERNAME;
    const password = process.env.ODOO_PASSWORD;

    if (!url || !db || !username || !password) {
        throw new Error("Webhook Odoo credentials are missing in environment variables.");
    }

    return { url, db, username, password };
}

export async function POST(
    request: Request,
    context: { params: Promise<{ token: string; id: string }> }
) {
    try {
        const { token, id } = await context.params;
        const expectedToken = process.env.ODOOPLUS_WEBHOOK_TOKEN;

        if (!expectedToken) {
            return NextResponse.json({ error: "Webhook token is not configured." }, { status: 500 });
        }

        if (token !== expectedToken) {
            return NextResponse.json({ error: "Unauthorized webhook token." }, { status: 401 });
        }

        const payload = (await request.json()) as WebhookPayload;
        const orderIdFromPath = Number(id);

        if (!Number.isFinite(orderIdFromPath)) {
            return NextResponse.json({ error: "Invalid order id in URL." }, { status: 400 });
        }

        if (payload._model && payload._model !== "sale.order") {
            return NextResponse.json({ error: "Unsupported model." }, { status: 400 });
        }

        const payloadOrderId = Number(payload.id ?? payload._id ?? orderIdFromPath);
        if (payloadOrderId !== orderIdFromPath) {
            return NextResponse.json(
                { error: "Payload order id does not match URL order id." },
                { status: 400 }
            );
        }

        const credentials = getWebhookCredentialsFromEnv();
        const details = await getOrderBackorderDetails(credentials, orderIdFromPath);
        const saved = await saveBackorderSnapshot(details, "webhook", credentials);

        return NextResponse.json({ success: true, saved });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Webhook processing failed." },
            { status: 400 }
        );
    }
}
