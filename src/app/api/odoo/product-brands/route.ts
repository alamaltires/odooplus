import { NextResponse } from "next/server";
import { getBrands } from "@/lib/server/odoo-client";
import { getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const brands = await getBrands(credentials);
        return NextResponse.json({ brands });
    } catch (error) {
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to load product brands",
            },
            { status: 400 }
        );
    }
}
