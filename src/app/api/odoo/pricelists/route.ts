import { NextResponse } from "next/server";
import { getPricelistOptions, runWithCompanyIds } from "@/lib/server/odoo-client";
import { getCompanyIdsFromRequest, getOdooCredentialsFromRequest, getUserRoleFromRequest } from "@/lib/server/auth-helpers";
import { getAllowedPricelistIds } from "@/lib/server/salesperson-scope";

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const companyIds = await getCompanyIdsFromRequest(request);
        // The Settings page asks for the full list (admins only) so the limit itself can be edited.
        const wantsEverything = (await request.clone().json().catch(() => ({})) as { all?: boolean }).all === true && (await getUserRoleFromRequest(request)) === "admin";
        const allowed = wantsEverything ? null : await getAllowedPricelistIds(request);
        const pricelists = await runWithCompanyIds(companyIds, () => getPricelistOptions(credentials, allowed));
        return NextResponse.json({ pricelists, restricted: Boolean(allowed) });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to load pricelists" },
            { status: 400 }
        );
    }
}
