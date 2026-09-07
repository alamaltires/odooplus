import { NextResponse } from "next/server";
import { getUnifiedLots, runWithCompanyIds } from "@/lib/server/odoo-client";
import { getCompanyIdsFromRequest, getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";

export async function POST(request: Request) {
    try {
        const body = (await request.json().catch(() => ({}))) as {
            query?: string;
            limit?: number;
            offset?: number;
        };
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const companyIds = await getCompanyIdsFromRequest(request);
        const limit = Number.isFinite(body.limit) ? Number(body.limit) : 20;
        const offset = Number.isFinite(body.offset) ? Number(body.offset) : 0;
        const query = typeof body.query === "string" ? body.query : "";
        const result = await runWithCompanyIds(companyIds, () =>
            getUnifiedLots(credentials, { query, limit, offset })
        );
        return NextResponse.json({
            unifiedLots: result.unifiedLots,
            totalCount: result.totalCount,
            limit,
            offset,
            hasMore: offset + result.unifiedLots.length < result.totalCount,
        });
    } catch (error) {
        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : "Failed to load unified lots",
            },
            { status: 400 }
        );
    }
}
