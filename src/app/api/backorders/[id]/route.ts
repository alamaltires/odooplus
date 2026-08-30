import { NextResponse } from "next/server";
import { getBackorderSnapshot, updateBackorderSnapshot } from "@/lib/server/backorders-store";
import { SavedBackorder } from "@/types/odoo";
import { guardAuthenticatedRequest } from "@/lib/server/request-guard";

export async function GET(
    request: Request,
    context: { params: Promise<{ id: string }> }
) {
    try {
        const guard = await guardAuthenticatedRequest(request, {
            rateLimit: {
                key: "api:backorders:id:get",
                maxRequests: 90,
                windowMs: 60_000,
            },
        });

        if (!guard.ok) {
            return guard.response;
        }

        const { id } = await context.params;
        const item = await getBackorderSnapshot(id);

        if (!item) {
            return NextResponse.json({ error: "Backorder not found." }, { status: 404 });
        }

        return NextResponse.json({ item }, { headers: guard.headers });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to load backorder." },
            { status: 500 }
        );
    }
}

export async function PATCH(
    request: Request,
    context: { params: Promise<{ id: string }> }
) {
    try {
        const guard = await guardAuthenticatedRequest(request, {
            rateLimit: {
                key: "api:backorders:id:patch",
                maxRequests: 25,
                windowMs: 60_000,
            },
        });

        if (!guard.ok) {
            return guard.response;
        }

        const { id } = await context.params;
        const body = (await request.json()) as {
            order_number?: string;
            customer_name?: string;
            salesperson_name?: string;
            order_date?: string;
            products?: SavedBackorder["products"];
        };

        if (
            typeof body.order_number !== "string" ||
            typeof body.customer_name !== "string" ||
            typeof body.salesperson_name !== "string" ||
            typeof body.order_date !== "string" ||
            !Array.isArray(body.products)
        ) {
            return NextResponse.json({ error: "Invalid update payload." }, { status: 400 });
        }

        const updated = await updateBackorderSnapshot(id, {
            order_number: body.order_number.trim(),
            customer_name: body.customer_name.trim(),
            salesperson_name: body.salesperson_name.trim(),
            order_date: body.order_date,
            products: body.products,
        });

        return NextResponse.json({ item: updated }, { headers: guard.headers });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to update backorder." },
            { status: 500 }
        );
    }
}