import { NextResponse } from "next/server";
import { getMarginAnalyticsReport } from "@/lib/server/odoo-client";
import { getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const body = (await request.json()) as {
            categoryId?: number | null;
            brandId?: number | null;
            originId?: number | null;
            rimDiameterId?: number | null;
            unifiedLotId?: number | null;
            startDate: string;
            endDate: string;
        };

        const report = await getMarginAnalyticsReport(credentials, body);
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
