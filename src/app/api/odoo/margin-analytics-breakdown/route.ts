import { NextResponse } from "next/server";
import { getMarginAnalyticsBreakdown, runWithCompanyIds } from "@/lib/server/odoo-client";
import { getCompanyIdsFromRequest, getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const companyIds = await getCompanyIdsFromRequest(request);
        const body = (await request.json()) as {
            productId: number;
            unifiedLotId?: number | null;
            startDate: string;
            endDate: string;
            dateBasis?: "order" | "transaction" | null;
        };

        const breakdown = await runWithCompanyIds(companyIds, () =>
            getMarginAnalyticsBreakdown(credentials, body)
        );
        return NextResponse.json(breakdown);
    } catch (error) {
        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : "Failed to load product breakdown",
            },
            { status: 400 }
        );
    }
}
