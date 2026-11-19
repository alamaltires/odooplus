import { NextResponse } from "next/server";
import { getCustomers, getFollowupOrderDetails, runWithCompanyIds } from "@/lib/server/odoo-client";
import { getCompanyIdsFromRequest, getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";
import { getCustomerTagScope, getOwnSalespersonScope } from "@/lib/server/salesperson-scope";

/** Lines and details of one sales order opened from the Customer Followup Report. */
export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const ownUserId = await getOwnSalespersonScope(request, credentials);
        const tagFilter = await getCustomerTagScope(request);
        const companyIds = await getCompanyIdsFromRequest(request);
        const { orderId } = (await request.json().catch(() => ({}))) as { orderId?: number };

        const order = await runWithCompanyIds(companyIds, async () => {
            const allowed = new Set((await getCustomers(credentials, ownUserId, tagFilter)).map((customer) => customer.id));
            return getFollowupOrderDetails(credentials, Number(orderId), allowed);
        });
        return NextResponse.json({ order });
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to load the order" }, { status: 400 });
    }
}
