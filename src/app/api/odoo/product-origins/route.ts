import { NextResponse } from "next/server";
import { getProductOrigins, runWithCompanyIds } from "@/lib/server/odoo-client";
import { getCompanyIdsFromRequest, getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const companyIds = await getCompanyIdsFromRequest(request);
        const origins = await runWithCompanyIds(companyIds, () => getProductOrigins(credentials));
        return NextResponse.json({ origins });
    } catch (error) {
        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : "Failed to load product origins",
            },
            { status: 400 }
        );
    }
}
