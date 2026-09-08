import { NextResponse } from "next/server";
import { getMarginAnalyticsReport, runWithCompanyIds } from "@/lib/server/odoo-client";
import { getCompanyIdsFromRequest, getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const companyIds = await getCompanyIdsFromRequest(request);
        const body = (await request.json()) as {
            categoryId?: number | null;
            brandId?: number | null;
            originId?: number | null;
            rimDiameterId?: number | null;
            unifiedLotId?: number | null;
            productId?: number | null;
            startDate: string;
            endDate: string;
            dateBasis?: "order" | "transaction" | null;
        };

        const report = await runWithCompanyIds(companyIds, () => getMarginAnalyticsReport(credentials, body));
        return NextResponse.json(report);
    } catch (error) {
        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : "Failed to generate margin analytics report",
            },
            { status: 400 }
        );
    }
}
