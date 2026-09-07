import { NextResponse } from "next/server";
import { getCompanies } from "@/lib/server/odoo-client";
import { getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const companies = await getCompanies(credentials);
        return NextResponse.json({ companies });
    } catch (error) {
        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : "Failed to load companies",
            },
            { status: 400 }
        );
    }
}
