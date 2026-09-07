import { NextResponse } from "next/server";
import { getSalespeople, runWithCompanyIds } from "@/lib/server/odoo-client";
import { getCompanyIdsFromRequest, getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const companyIds = await getCompanyIdsFromRequest(request);
        const salespeople = await runWithCompanyIds(companyIds, () => getSalespeople(credentials));
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
