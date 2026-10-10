import { NextResponse } from "next/server";
import { getCustomers, runWithCompanyIds } from "@/lib/server/odoo-client";
import { getCompanyIdsFromRequest, getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";
import { getOwnSalespersonScope } from "@/lib/server/salesperson-scope";

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const ownUserId = await getOwnSalespersonScope(request, credentials);
        const companyIds = await getCompanyIdsFromRequest(request);
        const customers = await runWithCompanyIds(companyIds, () => getCustomers(credentials, ownUserId));
        return NextResponse.json({ customers });
    } catch (error) {
        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : "Failed to load customers",
            },
            { status: 400 }
        );
    }
}
