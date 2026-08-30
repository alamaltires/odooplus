import { NextResponse } from "next/server";
import { getPurchaseOrderReport } from "@/lib/server/odoo-client";
import { getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";
import { getPendingBackorderQuantitiesByVariantIds } from "@/lib/server/backorders-store";

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const {
            categoryId,
            categoryModel,
            startDate,
            endDate,
            stockDurationMonths,
        } = (await request.json()) as {
            categoryId: number;
            categoryModel?: "product.public.category" | "product.category";
            startDate: string;
            endDate: string;
            stockDurationMonths: number;
        };

        const report = await getPurchaseOrderReport(credentials, {
            categoryId,
            categoryModel,
            startDate,
            endDate,
            stockDurationMonths,
        });

        const variantIds = report.rows.map((row) => row.productId);
        const pendingByVariantId = await getPendingBackorderQuantitiesByVariantIds(variantIds);

        const rows = report.rows.map((row) => ({
            ...row,
            pendingFromBackorders: pendingByVariantId.get(row.productId) ?? 0,
        }));

        return NextResponse.json({ ...report, rows });
    } catch (error) {
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to generate purchase order report",
            },
            { status: 400 }
        );
    }
}
