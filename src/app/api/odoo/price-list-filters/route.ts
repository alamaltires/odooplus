import { NextResponse } from "next/server";
import { getPriceListFilterOptions, runWithCompanyIds } from "@/lib/server/odoo-client";
import { getCompanyIdsFromRequest, getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const companyIds = await getCompanyIdsFromRequest(request);
        const options = await runWithCompanyIds(companyIds, () => getPriceListFilterOptions(credentials));
        return NextResponse.json(options);
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to load the filter options" },
            { status: 400 }
        );
    }
}
