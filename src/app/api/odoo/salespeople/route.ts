import { NextResponse } from "next/server";
import { getSalespeople } from "@/lib/server/odoo-client";
import { getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const salespeople = await getSalespeople(credentials);
        return NextResponse.json({ salespeople });
    } catch (error) {
        return NextResponse.json(
            {
                error:
                    error instanceof Error ? error.message : "Failed to load salespeople",
            },
            { status: 400 }
        );
    }
}