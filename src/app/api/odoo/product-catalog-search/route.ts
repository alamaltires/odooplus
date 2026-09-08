import { NextResponse } from "next/server";
import { searchProductCatalog, runWithCompanyIds } from "@/lib/server/odoo-client";
import { getCompanyIdsFromRequest, getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const companyIds = await getCompanyIdsFromRequest(request);
        const body = (await request.json().catch(() => ({}))) as {
            query?: string;
            limit?: number;
            offset?: number;
        };
        const limit = Number.isFinite(body.limit) ? Number(body.limit) : 24;
        const offset = Number.isFinite(body.offset) ? Number(body.offset) : 0;
        const query = typeof body.query === "string" ? body.query : "";

        const result = await runWithCompanyIds(companyIds, () =>
            searchProductCatalog(credentials, { query, limit, offset })
        );

        return NextResponse.json({
            products: result.products,
            totalCount: result.totalCount,
            limit,
            offset,
            hasMore: offset + result.products.length < result.totalCount,
        });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to search products" },
            { status: 400 }
        );
    }
}
