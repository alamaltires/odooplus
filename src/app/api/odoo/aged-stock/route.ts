import { NextResponse } from "next/server";
import { getAgedStockBase, refineAgedStock, runWithCompanyIds, type AgedCandidate } from "@/lib/server/odoo-client";
import { getCompanyIdsFromRequest, getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";

export const maxDuration = 120;

/** `stage: "base"` returns totals plus the candidates; `stage: "refine"` replays a small batch of them. */
export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const companyIds = await getCompanyIdsFromRequest(request);
        const body = (await request.json().catch(() => ({}))) as { stage?: string; minAgeDays?: number; candidates?: AgedCandidate[] };
        const minAgeDays = Number(body.minAgeDays ?? 180);

        if (body.stage === "refine") {
            const candidates = Array.isArray(body.candidates) ? body.candidates.slice(0, 500) : [];
            const result = await runWithCompanyIds(companyIds, () => refineAgedStock(credentials, minAgeDays, candidates));
            return NextResponse.json(result);
        }

        const result = await runWithCompanyIds(companyIds, () => getAgedStockBase(credentials, minAgeDays));
        return NextResponse.json(result);
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to scan aged stock" },
            { status: 400 }
        );
    }
}
