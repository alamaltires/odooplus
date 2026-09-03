import { NextResponse } from "next/server";
import { getSalesTargetDetails } from "@/lib/server/odoo-client";
import { getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const body = (await request.json()) as {
            salespersonId?: number;
            year?: number;
            month?: number;
            brandId?: number;
        };

        const data = await getSalesTargetDetails(credentials, {
            salespersonId: Number(body.salespersonId),
            year: Number(body.year),
            month: Number(body.month),
            brandId: Number(body.brandId),
        });

        return NextResponse.json(data);
    } catch (error) {
        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : "Failed to load sales target details",
            },
            { status: 400 }
        );
    }
}
