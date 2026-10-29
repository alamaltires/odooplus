import { NextResponse } from "next/server";
import { getMyContacts, runWithCompanyIds } from "@/lib/server/odoo-client";
import { getCompanyIdsFromRequest, getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";
import { getCustomerTagScope, getOwnSalespersonScope } from "@/lib/server/salesperson-scope";

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const ownUserId = await getOwnSalespersonScope(request, credentials);
        const tagFilter = await getCustomerTagScope(request);
        const companyIds = await getCompanyIdsFromRequest(request);
        const contacts = await runWithCompanyIds(companyIds, () => getMyContacts(credentials, ownUserId, tagFilter));
        return NextResponse.json({ contacts });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to load contacts" },
            { status: 400 }
        );
    }
}
