import { NextRequest, NextResponse } from "next/server";
import { handleInventoryWebhook, handleInventoryWebhookHealthCheck } from "./handler";

function resolveToken(request: NextRequest) {
    const tokenFromQuery = request.nextUrl.searchParams.get("token") ?? undefined;
    const tokenFromHeader = request.headers.get("x-webhook-token") ?? undefined;
    return tokenFromQuery || tokenFromHeader;
}

export async function POST(request: NextRequest) {
    const token = resolveToken(request);

    if (!token) {
        return NextResponse.json(
            {
                error: "Webhook token is required in URL path, query (?token=...), or x-webhook-token header.",
            },
            { status: 401 }
        );
    }

    return handleInventoryWebhook(request, token);
}

export async function GET(request: NextRequest) {
    const token = resolveToken(request);

    if (!token) {
        return NextResponse.json(
            {
                error: "Webhook token is required in URL path, query (?token=...), or x-webhook-token header.",
            },
            { status: 401 }
        );
    }

    return handleInventoryWebhookHealthCheck(token);
}
