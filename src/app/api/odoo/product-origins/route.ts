import { NextResponse } from "next/server";
import { getProductOrigins } from "@/lib/server/odoo-client";
import { getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const origins = await getProductOrigins(credentials);
        return NextResponse.json({ origins });
    } catch (error) {
        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : "Failed to load product origins",
            },
            { status: 400 }
        );
    }
}
