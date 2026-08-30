import { NextResponse } from "next/server";
import { getProducts } from "@/lib/server/odoo-client";
import { getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";

export async function POST(request: Request) {
    try {
        const body = (await request.json().catch(() => ({}))) as {
            query?: string;
            limit?: number;
            offset?: number;
        };
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const limit = Number.isFinite(body.limit) ? Number(body.limit) : 10;
        const offset = Number.isFinite(body.offset) ? Number(body.offset) : 0;
        const query = typeof body.query === "string" ? body.query : "";
        const result = await getProducts(credentials, { query, limit, offset });
        return NextResponse.json({
            products: result.products,
            totalCount: result.totalCount,
            limit,
            offset,
            hasMore: offset + result.products.length < result.totalCount,
        });
    } catch (error) {
        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : "Failed to load products",
            },
            { status: 400 }
        );
    }
}