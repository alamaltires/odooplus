import { NextResponse } from "next/server";
import { getPaymentFollowupForCustomer, runWithCompanyIds } from "@/lib/server/odoo-client";
import { getCompanyIdsFromRequest, getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";
import { assertCustomerInScope, getOwnSalespersonScope } from "@/lib/server/salesperson-scope";

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const ownUserId = await getOwnSalespersonScope(request, credentials);
        const companyIds = await getCompanyIdsFromRequest(request);
        const { customerId, asOfDate, dateBasis, agingSystem } = (await request.json()) as {
            customerId: number;
            asOfDate?: string;
            dateBasis?: "due" | "invoice";
            agingSystem?: "day" | "month";
        };
        await assertCustomerInScope(ownUserId, credentials, customerId);

        const report = await runWithCompanyIds(companyIds, () =>
            getPaymentFollowupForCustomer(credentials, { customerId, asOfDate, dateBasis, agingSystem })
        );

        return NextResponse.json(report);
    } catch (error) {
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to load payment followup report",
            },
            { status: 400 }
        );
    }
}
