import { NextResponse } from "next/server";
import { getTirePatterns } from "@/lib/server/odoo-client";
import { getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const patterns = await getTirePatterns(credentials);
        return NextResponse.json({ patterns });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to load patterns" },
            { status: 400 }
        );
    }
}
