import { NextResponse } from "next/server";
import { getPatternImages } from "@/lib/server/odoo-client";
import { getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const body = (await request.json().catch(() => ({}))) as { ids?: number[] };
        const images = await getPatternImages(credentials, Array.isArray(body.ids) ? body.ids : []);
        return NextResponse.json({ images });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to load pattern images" },
            { status: 400 }
        );
    }
}
