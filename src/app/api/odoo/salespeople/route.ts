import { NextResponse } from "next/server";
import { getSalespeople, runWithCompanyIds } from "@/lib/server/odoo-client";
import { getCompanyIdsFromRequest, getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";
import { getAllowedSalespersonIds } from "@/lib/server/salesperson-scope";

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const { ids } = await getAllowedSalespersonIds(request, credentials);
        const companyIds = await getCompanyIdsFromRequest(request);
        const salespeople = await runWithCompanyIds(companyIds, () => getSalespeople(credentials, ids));
        return NextResponse.json({ salespeople });
    } catch (error) {
        return NextResponse.json(
            {
                error:
                    error instanceof Error ? error.message : "Failed to load salespeople",
            },
            { status: 400 }
        );
    }
}
