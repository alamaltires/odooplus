import { NextResponse } from "next/server";
import { getCustomerFollowupReport, getCustomers, runWithCompanyIds } from "@/lib/server/odoo-client";
import { getCompanyIdsFromRequest, getOdooCredentialsFromRequest, getUserRoleFromRequest } from "@/lib/server/auth-helpers";
import { getCustomerTagScope, getOwnSalespersonScope } from "@/lib/server/salesperson-scope";

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const role = await getUserRoleFromRequest(request);
        const ownUserId = await getOwnSalespersonScope(request, credentials);
        const tagFilter = await getCustomerTagScope(request);
        const companyIds = await getCompanyIdsFromRequest(request);
        const { customerIds, onlyWithOrders, onlyInactive, startDate, endDate } = (await request.json()) as {
            customerIds: number[];
            onlyWithOrders?: boolean;
            onlyInactive?: boolean;
            startDate: string;
            endDate: string;
        };

        const report = await runWithCompanyIds(companyIds, async () => {
            // Only customers this user may see are ever reported, whatever ids were sent.
            const allowed = new Set((await getCustomers(credentials, ownUserId, tagFilter)).map((customer) => customer.id));
            const allowedIds = (Array.isArray(customerIds) ? customerIds : []).map(Number).filter((id) => allowed.has(id));
            return getCustomerFollowupReport(credentials, {
                customerIds: allowedIds,
                onlyWithOrders: onlyWithOrders === true,
                onlyInactive: onlyInactive === true,
                startDate,
                endDate,
                includeCost: role !== "salesperson",
            });
        });
        return NextResponse.json(report);
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to load the customer followup report" },
            { status: 400 }
        );
    }
}
