import { NextResponse } from "next/server";
import { getMyOrderDetails, runWithCompanyIds } from "@/lib/server/odoo-client";
import { getCompanyIdsFromRequest, getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";

/** Full details of one of the signed-in user's own quotations / sales orders. */
export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const companyIds = await getCompanyIdsFromRequest(request);
        const { orderId } = (await request.json().catch(() => ({}))) as { orderId?: number };
        const order = await runWithCompanyIds(companyIds, () => getMyOrderDetails(credentials, Number(orderId)));
        return NextResponse.json({ order });
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to load the order" }, { status: 400 });
    }
}
