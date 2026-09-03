import { NextResponse } from "next/server";
import { searchPurchaseOrders } from "@/lib/server/odoo-client";
import { getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const body = (await request.json().catch(() => ({}))) as {
            query?: string;
            limit?: number;
            offset?: number;
        };
        const limit = Number.isFinite(body.limit) ? Number(body.limit) : 20;
        const offset = Number.isFinite(body.offset) ? Number(body.offset) : 0;
        const result = await searchPurchaseOrders(credentials, body.query ?? "", { limit, offset });

        return NextResponse.json({
            purchaseOrders: result.purchaseOrders,
            totalCount: result.totalCount,
            limit,
            offset,
            hasMore: offset + result.purchaseOrders.length < result.totalCount,
        });
    } catch (error) {
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to search purchase orders",
            },
            { status: 400 }
        );
    }
}
