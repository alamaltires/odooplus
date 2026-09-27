import { NextResponse } from "next/server";
import { getSaleOrderTypes, runWithCompanyIds } from "@/lib/server/odoo-client";
import { getCompanyIdsFromRequest, getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const companyIds = await getCompanyIdsFromRequest(request);
        const data = await runWithCompanyIds(companyIds, () => getSaleOrderTypes(credentials));
        return NextResponse.json(data);
    } catch (error) {
        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : "Failed to load sale order types",
            },
            { status: 400 }
        );
    }
}
