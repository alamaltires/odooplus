import { NextResponse } from "next/server";
import { getAgedStockExplanation, runWithCompanyIds } from "@/lib/server/odoo-client";
import { getCompanyIdsFromRequest, getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";

export const maxDuration = 60;

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const companyIds = await getCompanyIdsFromRequest(request);
        const body = (await request.json().catch(() => ({}))) as { productId?: number; lotName?: string; warehouse?: string; minAgeDays?: number };
        const productId = Number(body.productId);
        if (!Number.isFinite(productId) || productId <= 0) throw new Error("Choose a product.");
        const result = await runWithCompanyIds(companyIds, () =>
            getAgedStockExplanation(credentials, {
                productId,
                lotName: String(body.lotName ?? ""),
                warehouse: String(body.warehouse ?? ""),
                minAgeDays: Number(body.minAgeDays ?? 180),
            })
        );
        return NextResponse.json(result);
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to explain the aged stock row" },
            { status: 400 }
        );
    }
}
