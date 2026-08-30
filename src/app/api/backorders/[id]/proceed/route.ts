import { NextResponse } from "next/server";
import { markBackorderAsProccedIfReady } from "@/lib/server/backorders-store";
import { guardAuthenticatedRequest } from "@/lib/server/request-guard";

export async function POST(
    request: Request,
    context: { params: Promise<{ id: string }> }
) {
    try {
        const guard = await guardAuthenticatedRequest(request, {
            rateLimit: {
                key: "api:backorders:id:proceed",
                maxRequests: 20,
                windowMs: 60_000,
            },
        });

        if (!guard.ok) {
            return guard.response;
        }

        const { id } = await context.params;
        const item = await markBackorderAsProccedIfReady(id);
        return NextResponse.json({ item }, { headers: guard.headers });
    } catch (error) {
        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : "Failed to update backorder status.",
            },
            { status: 400 }
        );
    }
}
