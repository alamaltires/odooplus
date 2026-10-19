import { NextResponse } from "next/server";
import { getPriceListFacets, runWithCompanyIds } from "@/lib/server/odoo-client";
import { getCompanyIdsFromRequest, getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";

export const maxDuration = 60;

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const companyIds = await getCompanyIdsFromRequest(request);
        const body = (await request.json().catch(() => ({}))) as {
            brandIds?: number[];
            originIds?: number[];
            categoryIds?: number[];
            oeValues?: Array<number | string>;
            lotNames?: string[];
            searchNames?: string[];
        };
        const facets = await runWithCompanyIds(companyIds, () =>
            getPriceListFacets(credentials, {
                brandIds: body.brandIds ?? [],
                originIds: body.originIds ?? [],
                categoryIds: body.categoryIds ?? [],
                oeValues: body.oeValues ?? [],
                lotNames: body.lotNames ?? [],
                searchNames: body.searchNames ?? [],
            })
        );
        return NextResponse.json(facets);
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to load the exclude options" },
            { status: 400 }
        );
    }
}
