import { NextResponse } from "next/server";
import { getAgedStock, runWithCompanyIds } from "@/lib/server/odoo-client";
import { getCompanyIdsFromRequest, getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";

export const maxDuration = 120;

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const companyIds = await getCompanyIdsFromRequest(request);
        const body = (await request.json().catch(() => ({}))) as { minAgeDays?: number };
        const result = await runWithCompanyIds(companyIds, () => getAgedStock(credentials, Number(body.minAgeDays ?? 180)));
        return NextResponse.json({ ...result, scannedAt: new Date().toISOString() });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to scan aged stock" },
            { status: 400 }
        );
    }
}
