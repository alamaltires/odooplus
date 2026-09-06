import { NextResponse } from "next/server";
import { getRimDiameters } from "@/lib/server/odoo-client";
import { getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const rimDiameters = await getRimDiameters(credentials);
        return NextResponse.json({ rimDiameters });
    } catch (error) {
        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : "Failed to load rim diameters",
            },
            { status: 400 }
        );
    }
}
