import { NextResponse } from "next/server";
import { getPoBills, runWithCompanyIds } from "@/lib/server/odoo-client";
import { getCompanyIdsFromRequest, getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const companyIds = await getCompanyIdsFromRequest(request);
        const body = (await request.json().catch(() => ({}))) as { orderIds?: number[] };
        const orderIds = Array.isArray(body.orderIds) ? body.orderIds.slice(0, 2000) : [];

        const bills = await runWithCompanyIds(companyIds, () => getPoBills(credentials, orderIds));
        return NextResponse.json({ bills });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to load bills" },
            { status: 400 }
        );
    }
}
