import { NextResponse } from "next/server";
import { getPendingOrders, runWithCompanyIds } from "@/lib/server/odoo-client";
import { getCompanyIdsFromRequest, getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const companyIds = await getCompanyIdsFromRequest(request);
        const orders = await runWithCompanyIds(companyIds, () => getPendingOrders(credentials));
        return NextResponse.json({ orders });
    } catch (error) {
        return NextResponse.json(
            {
                error:
                    error instanceof Error ? error.message : "Failed to load pending orders",
            },
            { status: 400 }
        );
    }
}
