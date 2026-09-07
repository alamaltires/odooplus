import { NextResponse } from "next/server";
import { getBrands, runWithCompanyIds } from "@/lib/server/odoo-client";
import { getCompanyIdsFromRequest, getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const companyIds = await getCompanyIdsFromRequest(request);
        const brands = await runWithCompanyIds(companyIds, () => getBrands(credentials));
        return NextResponse.json({ brands });
    } catch (error) {
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to load product brands",
            },
            { status: 400 }
        );
    }
}
