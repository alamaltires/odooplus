import { NextResponse } from "next/server";
import { getOrderBackorderDetails } from "@/lib/server/odoo-client";
import { getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const { orderId } = (await request.json()) as {
            orderId: number;
        };

        const data = await getOrderBackorderDetails(credentials, Number(orderId));
        return NextResponse.json(data);
    } catch (error) {
        return NextResponse.json(
            {
                error:
                    error instanceof Error ? error.message : "Failed to load order details",
            },
            { status: 400 }
        );
    }
}
