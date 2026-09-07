import { NextResponse } from "next/server";
import { getOrderBackorderDetails, runWithCompanyIds } from "@/lib/server/odoo-client";
import { getCompanyIdsFromRequest, getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const companyIds = await getCompanyIdsFromRequest(request);
        const { orderId } = (await request.json()) as {
            orderId: number;
        };

        const data = await runWithCompanyIds(companyIds, () =>
            getOrderBackorderDetails(credentials, Number(orderId))
        );
        return NextResponse.json(data);
    } catch (error) {
        return NextResponse.json(
            {
                error:
                    error instanceof Error ? error.message : "Failed to load order details",
            },
            { status: 400 }
        );
    }
}
