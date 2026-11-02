import { NextResponse } from "next/server";
import { getMyProductHistory, runWithCompanyIds } from "@/lib/server/odoo-client";
import { getCompanyIdsFromRequest, getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";

/** What the signed-in user sold of one product before. */
export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const companyIds = await getCompanyIdsFromRequest(request);
        const { productId } = (await request.json()) as { productId: number };
        const rows = await runWithCompanyIds(companyIds, () => getMyProductHistory(credentials, Number(productId)));
        return NextResponse.json({ rows });
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to load the product history" }, { status: 400 });
    }
}
