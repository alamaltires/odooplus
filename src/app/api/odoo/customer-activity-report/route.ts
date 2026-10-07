import { NextResponse } from "next/server";
import { getCustomerActivityReport, runWithCompanyIds } from "@/lib/server/odoo-client";
import { getCompanyIdsFromRequest, getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const companyIds = await getCompanyIdsFromRequest(request);
        const { customerId, startDate, endDate } = (await request.json()) as {
            customerId: number;
            startDate: string;
            endDate: string;
        };

        const report = await runWithCompanyIds(companyIds, () =>
            getCustomerActivityReport(credentials, { customerId, startDate, endDate })
        );
        return NextResponse.json(report);
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to load customer activity" },
            { status: 400 }
        );
    }
}
