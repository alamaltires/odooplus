import { NextResponse } from "next/server";
import { findSalesOrderByNumber } from "@/lib/server/odoo-client";
import { getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const { salesOrderNumber } = (await request.json()) as {
            salesOrderNumber: string;
        };

        const order = await findSalesOrderByNumber(credentials, salesOrderNumber);
        return NextResponse.json({ order });
    } catch (error) {
        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : "Failed to search sales order",
            },
            { status: 400 }
        );
    }
}
