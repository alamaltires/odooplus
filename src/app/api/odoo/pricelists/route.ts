import { NextResponse } from "next/server";
import { getPricelistOptions, runWithCompanyIds } from "@/lib/server/odoo-client";
import { getCompanyIdsFromRequest, getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const companyIds = await getCompanyIdsFromRequest(request);
        const pricelists = await runWithCompanyIds(companyIds, () => getPricelistOptions(credentials));
        return NextResponse.json({ pricelists });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to load pricelists" },
            { status: 400 }
        );
    }
}
