import { NextResponse } from "next/server";
import { getPartnerLedger, runWithCompanyIds } from "@/lib/server/odoo-client";
import { getCompanyIdsFromRequest, getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const companyIds = await getCompanyIdsFromRequest(request);
        const { customerId, asOfDate, unreconciledOnly } = (await request.json()) as {
            customerId: number;
            asOfDate: string;
            unreconciledOnly?: boolean;
        };

        const ledger = await runWithCompanyIds(companyIds, () =>
            getPartnerLedger(credentials, { customerId, asOfDate, unreconciledOnly })
        );
        return NextResponse.json(ledger);
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to load the partner ledger" },
            { status: 400 }
        );
    }
}
