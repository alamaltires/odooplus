import { NextResponse } from "next/server";
import { listPurchaseFromBackorderReportRows } from "@/lib/server/backorders-store";
import { guardAuthenticatedRequest } from "@/lib/server/request-guard";

export async function GET(request: Request) {
    try {
        const guard = await guardAuthenticatedRequest(request, {
            rateLimit: {
                key: "api:backorders:purchase-report:get",
                maxRequests: 20,
                windowMs: 60_000,
            },
        });

        if (!guard.ok) {
            return guard.response;
        }

        const rows = await listPurchaseFromBackorderReportRows();
        return NextResponse.json({ rows }, { headers: guard.headers });
    } catch (error) {
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to load purchase-from-backorder report.",
            },
            { status: 500 }
        );
    }
}
