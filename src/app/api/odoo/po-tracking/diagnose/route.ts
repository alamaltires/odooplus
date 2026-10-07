import { NextResponse } from "next/server";
import { diagnosePoTracking, runWithCompanyIds } from "@/lib/server/odoo-client";
import { getCompanyIdsFromRequest, getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const companyIds = await getCompanyIdsFromRequest(request);
        const { poName } = (await request.json()) as { poName?: string };

        const data = await runWithCompanyIds(companyIds, () => diagnosePoTracking(credentials, poName ?? ""));
        return NextResponse.json(data);
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to check the purchase order" },
            { status: 400 }
        );
    }
}
