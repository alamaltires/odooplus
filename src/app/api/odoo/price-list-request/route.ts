import { NextResponse } from "next/server";
import { getPriceListRequest, runWithCompanyIds, type PriceListInput } from "@/lib/server/odoo-client";
import { getCompanyIdsFromRequest, getOdooCredentialsFromRequest, getUserRoleFromRequest } from "@/lib/server/auth-helpers";
import { getAllowedPricelistIds } from "@/lib/server/salesperson-scope";

export const maxDuration = 120;

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const companyIds = await getCompanyIdsFromRequest(request);
        const body = (await request.json().catch(() => ({}))) as Partial<PriceListInput>;
        // Only the pricelists this user is allowed (Settings -> App Permissions) can be priced.
        const allowedPricelists = await getAllowedPricelistIds(request);
        const pricelistIds = allowedPricelists ? (body.pricelistIds ?? []).filter((id) => allowedPricelists.includes(Number(id))) : body.pricelistIds ?? [];
        const role = await getUserRoleFromRequest(request);
        const includeCost = role === "purchase" || role === "sales_manager" || role === "admin";
        const result = await runWithCompanyIds(companyIds, () =>
            getPriceListRequest(credentials, {
                brandIds: body.brandIds ?? [],
                excludeBrandIds: body.excludeBrandIds ?? [],
                originIds: body.originIds ?? [],
                excludeOriginIds: body.excludeOriginIds ?? [],
                categoryIds: body.categoryIds ?? [],
                excludeCategoryIds: body.excludeCategoryIds ?? [],
                oeValues: body.oeValues ?? [],
                excludeOeValues: body.excludeOeValues ?? [],
                lotNames: body.lotNames ?? [],
                excludeLotNames: body.excludeLotNames ?? [],
                locationIds: body.locationIds ?? [],
                excludeLocationIds: body.excludeLocationIds ?? [],
                searchNames: body.searchNames ?? [],
                excludeSearchNames: body.excludeSearchNames ?? [],
                pricelistIds,
                includeCost,
                inStockOnly: Boolean(body.inStockOnly),
                onlyPriced: body.onlyPriced === true,
                onlyUnpriced: body.onlyUnpriced === true,
            })
        );
        return NextResponse.json(result);
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to build the price list" },
            { status: 400 }
        );
    }
}
