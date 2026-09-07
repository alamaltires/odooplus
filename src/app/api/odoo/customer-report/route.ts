import { NextResponse } from "next/server";
import { getCustomerReport, runWithCompanyIds } from "@/lib/server/odoo-client";
import { getCompanyIdsFromRequest, getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const companyIds = await getCompanyIdsFromRequest(request);
        const { customerId } = (await request.json()) as { customerId: number };

        const report = await runWithCompanyIds(companyIds, () => getCustomerReport(credentials, customerId));
        return NextResponse.json(report);
    } catch (error) {
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to load customer report",
            },
            { status: 400 }
        );
    }
}
