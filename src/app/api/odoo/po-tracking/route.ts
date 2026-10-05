import { NextResponse } from "next/server";
import { getImportedPurchaseOrdersForTracking, runWithCompanyIds } from "@/lib/server/odoo-client";
import { getCompanyIdsFromRequest, getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const companyIds = await getCompanyIdsFromRequest(request);
        const body = (await request.json().catch(() => ({}))) as { includeReceived?: boolean };

        const data = await runWithCompanyIds(companyIds, () =>
            getImportedPurchaseOrdersForTracking(credentials, { includeReceived: Boolean(body.includeReceived) })
        );
        return NextResponse.json(data);
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to load imported purchase orders" },
            { status: 400 }
        );
    }
}
