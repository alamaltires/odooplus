import { NextResponse } from "next/server";
import { getNearExpiryProducts } from "@/lib/server/odoo-client";
import { getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const body = (await request.json()) as { thresholdDays?: number };
        const thresholdDays = Number(body.thresholdDays ?? 30);
        const safeThresholdDays = Number.isFinite(thresholdDays)
            ? Math.max(1, Math.min(365, Math.floor(thresholdDays)))
            : 30;

        const products = await getNearExpiryProducts(credentials, safeThresholdDays);
        return NextResponse.json({
            products,
            thresholdDays: safeThresholdDays,
            scannedAt: new Date().toISOString(),
        });
    } catch (error) {
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to scan near expiry products",
            },
            { status: 400 }
        );
    }
}