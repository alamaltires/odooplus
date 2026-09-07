import { NextResponse } from "next/server";
import { getCustomers, runWithCompanyIds } from "@/lib/server/odoo-client";
import { getCompanyIdsFromRequest, getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const companyIds = await getCompanyIdsFromRequest(request);
        const customers = await runWithCompanyIds(companyIds, () => getCustomers(credentials));
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
