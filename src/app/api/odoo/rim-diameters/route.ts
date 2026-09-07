import { NextResponse } from "next/server";
import { getRimDiameters, runWithCompanyIds } from "@/lib/server/odoo-client";
import { getCompanyIdsFromRequest, getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const companyIds = await getCompanyIdsFromRequest(request);
        const rimDiameters = await runWithCompanyIds(companyIds, () => getRimDiameters(credentials));
        return NextResponse.json({ rimDiameters });
    } catch (error) {
        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : "Failed to load rim diameters",
            },
            { status: 400 }
        );
    }
}
