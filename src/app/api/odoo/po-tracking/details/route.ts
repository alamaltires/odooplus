import { NextResponse } from "next/server";
import { getPoDetails, runWithCompanyIds } from "@/lib/server/odoo-client";
import { getCompanyIdsFromRequest, getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const companyIds = await getCompanyIdsFromRequest(request);
        const body = (await request.json().catch(() => ({}))) as { orderId?: number };
        const orderId = Number(body.orderId);
        if (!Number.isFinite(orderId) || orderId <= 0) {
            throw new Error("Missing purchase order.");
        }

        const order = await runWithCompanyIds(companyIds, () => getPoDetails(credentials, orderId));
        return NextResponse.json({ order });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to load the purchase order" },
            { status: 400 }
        );
    }
}
