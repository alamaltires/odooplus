import { NextResponse } from "next/server";
import { getCustomers } from "@/lib/server/odoo-client";
import { getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const customers = await getCustomers(credentials);
        return NextResponse.json({ customers });
    } catch (error) {
        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : "Failed to load customers",
            },
            { status: 400 }
        );
    }
}