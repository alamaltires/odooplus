import { NextResponse } from "next/server";
import { getSalespersonActivityReport, runWithCompanyIds } from "@/lib/server/odoo-client";
import { getCompanyIdsFromRequest, getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";
import { resolveSalespersonId } from "@/lib/server/salesperson-scope";

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const companyIds = await getCompanyIdsFromRequest(request);
        const { salespersonId, startDate, endDate } = (await request.json()) as {
            salespersonId: number;
            startDate: string;
            endDate: string;
        };

        const scopedSalespersonId = await resolveSalespersonId(request, credentials, salespersonId);
        const report = await runWithCompanyIds(companyIds, () =>
            getSalespersonActivityReport(credentials, {
                salespersonId: scopedSalespersonId,
                startDate,
                endDate,
            })
        );

        return NextResponse.json(report);
    } catch (error) {
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to generate salesperson activity report",
            },
            { status: 400 }
        );
    }
}
