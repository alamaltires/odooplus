import { NextResponse } from "next/server";
import { getProductsPerformanceReport } from "@/lib/server/odoo-client";
import { getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const body = (await request.json()) as {
            purchaseOrderId?: number | null;
            productId?: number | null;
            brandId?: number | null;
            categoryId?: number | null;
            startDate: string;
            endDate: string;
        };

        const report = await getProductsPerformanceReport(credentials, body);
        return NextResponse.json(report);
    } catch (error) {
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to generate products performance report",
            },
            { status: 400 }
        );
    }
}
