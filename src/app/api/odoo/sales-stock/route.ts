import { NextResponse } from "next/server";
import { searchSalesStock, runWithCompanyIds, type SalesStockFilters } from "@/lib/server/odoo-client";
import { getCompanyIdsFromRequest, getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const companyIds = await getCompanyIdsFromRequest(request);
        const body = (await request.json().catch(() => ({}))) as {
            query?: string;
            queries?: string[];
            limit?: number;
            offset?: number;
            filters?: SalesStockFilters;
        };
        const limit = Number.isFinite(body.limit) ? Number(body.limit) : 30;
        const offset = Number.isFinite(body.offset) ? Number(body.offset) : 0;
        const query = typeof body.query === "string" ? body.query : "";

        const result = await runWithCompanyIds(companyIds, () =>
            searchSalesStock(credentials, { query, queries: Array.isArray(body.queries) ? body.queries.filter((term): term is string => typeof term === "string") : undefined, limit, offset, filters: body.filters })
        );

        return NextResponse.json({
            rows: result.rows,
            totalCount: result.totalCount,
            unresolvedFields: result.unresolvedFields,
            limit,
            offset,
            hasMore: offset + result.rows.length < result.totalCount,
        });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to search stock" },
            { status: 400 }
        );
    }
}
