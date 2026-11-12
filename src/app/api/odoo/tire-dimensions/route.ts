import { NextResponse } from "next/server";
import { getTireDimensionOptions, runWithCompanyIds } from "@/lib/server/odoo-client";
import { getCompanyIdsFromRequest, getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const companyIds = await getCompanyIdsFromRequest(request);
        const body = (await request.json()) as { key?: string };
        const key = body.key === "ratio" ? "ratio" : "width";
        const options = await runWithCompanyIds(companyIds, () => getTireDimensionOptions(credentials, key));
        return NextResponse.json({ options });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to load tire sizes" },
            { status: 400 }
        );
    }
}
