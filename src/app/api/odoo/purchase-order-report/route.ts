import { NextResponse } from "next/server";
import { getPurchaseOrderReport, runWithCompanyIds } from "@/lib/server/odoo-client";
import { getCompanyIdsFromRequest, getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";
import { getPendingBackorderQuantitiesByVariantIds } from "@/lib/server/backorders-store";

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const companyIds = await getCompanyIdsFromRequest(request);
        const {
            categoryId,
            categoryModel,
            brandId,
            startDate,
            endDate,
            stockDurationMonths,
            excludeDropshipping,
            excludeInternalCompanies,
        } = (await request.json()) as {
            categoryId?: number | null;
            categoryModel?: "product.public.category" | "product.category";
            brandId?: number | null;
            startDate: string;
            endDate: string;
            stockDurationMonths: number;
            excludeDropshipping?: boolean | null;
            excludeInternalCompanies?: boolean | null;
        };

        const report = await runWithCompanyIds(companyIds, () =>
            getPurchaseOrderReport(credentials, {
                categoryId,
                categoryModel,
                brandId,
                startDate,
                endDate,
                stockDurationMonths,
                excludeDropshipping,
                excludeInternalCompanies,
            })
        );

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
