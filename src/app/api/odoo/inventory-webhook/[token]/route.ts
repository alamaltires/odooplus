import { NextRequest } from "next/server";
import { handleInventoryWebhook, handleInventoryWebhookHealthCheck } from "../handler";

type RouteContext = {
    params: Promise<{
        token: string;
    }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
    const { token } = await context.params;
    return handleInventoryWebhook(request, token);
}

export async function GET(_request: NextRequest, context: RouteContext) {
    const { token } = await context.params;
    return handleInventoryWebhookHealthCheck(token);
}

export async function HEAD(_request: NextRequest, context: RouteContext) {
    const { token } = await context.params;
    return handleInventoryWebhookHealthCheck(token);
}
