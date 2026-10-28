import { NextResponse } from "next/server";
import { getPaymentFollowupForTag, runWithCompanyIds } from "@/lib/server/odoo-client";
import { getCompanyIdsFromRequest, getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";
import { getCustomerTagScope, getOwnSalespersonScope } from "@/lib/server/salesperson-scope";

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const ownUserId = await getOwnSalespersonScope(request, credentials);
        const companyIds = await getCompanyIdsFromRequest(request);
        const { tagId, asOfDate, dateBasis, agingSystem } = (await request.json()) as {
            tagId: number;
            asOfDate?: string;
            dateBasis?: "due" | "invoice";
            agingSystem?: "day" | "month";
        };

        const scope = await getCustomerTagScope(request);
        if (scope && "ids" in scope && !scope.ids.includes(Number(tagId))) {
            throw new Error("This customer tag is not part of your permissions.");
        }

        const report = await runWithCompanyIds(companyIds, () =>
            getPaymentFollowupForTag(credentials, { tagId, asOfDate, dateBasis, agingSystem, ownUserId })
        );

        return NextResponse.json(report);
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to load payment followup report" },
            { status: 400 }
        );
    }
}
