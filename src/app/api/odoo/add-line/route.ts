import { NextResponse } from "next/server";
import { addProductToOrder } from "@/lib/server/odoo-client";
import { getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";
import { OdooOrderLineInput } from "@/types/odoo";

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const { orderId, line } = (await request.json()) as {
            orderId: number;
            line: OdooOrderLineInput;
        };

        const data = await addProductToOrder(credentials, Number(orderId), line);
        return NextResponse.json(data);
    } catch (error) {
        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : "Failed to add product",
            },
            { status: 400 }
        );
    }
}
