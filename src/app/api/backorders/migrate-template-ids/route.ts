import { NextRequest, NextResponse } from "next/server";
import { getStoredOdooCredentials } from "@/lib/server/auth-helpers";
import { migrateBackordersToTemplateIds } from "@/lib/server/backorders-store";

/**
 * One-time migration endpoint: rewrites every backorder so `product_id` holds
 * the Odoo product.template id (matching what the inventory webhook sends).
 *
 * Protected by the shared webhook token (same token as the inventory webhook),
 * passed as `?token=` or the `x-webhook-token` header. Uses Odoo credentials
 * stored in Firestore, so it needs no logged-in session and no env credentials.
 */
export async function POST(request: NextRequest) {
    try {
        const expectedToken = process.env.WEBHOOK_TOKEN ?? process.env.ODOOPLUS_WEBHOOK_TOKEN;
        if (!expectedToken) {
            return NextResponse.json({ error: "Webhook token is not configured." }, { status: 500 });
        }

        const token =
            request.nextUrl.searchParams.get("token") ?? request.headers.get("x-webhook-token") ?? "";
        if (token.trim() !== expectedToken) {
            return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
        }

        const credentials = await getStoredOdooCredentials();
        if (!credentials) {
            return NextResponse.json(
                { error: "No stored Odoo credentials found. Configure Odoo in app settings first." },
                { status: 400 }
            );
        }

        const result = await migrateBackordersToTemplateIds(credentials);
        return NextResponse.json({ success: true, ...result });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Migration failed." },
            { status: 500 }
        );
    }
}
