import { NextResponse } from "next/server";
import { getProductCategories } from "@/lib/server/odoo-client";
import { getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const categories = await getProductCategories(credentials);
        return NextResponse.json({ categories });
    } catch (error) {
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to load product categories",
            },
            { status: 400 }
        );
    }
}
