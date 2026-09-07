import { NextResponse } from "next/server";
import { getSalespersonMonthlyInvoices, runWithCompanyIds } from "@/lib/server/odoo-client";
import { getCompanyIdsFromRequest, getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const companyIds = await getCompanyIdsFromRequest(request);
        const { salespersonId, year, month, includeCreditNotes } = (await request.json()) as {
            salespersonId: number;
            year: number;
            month: number;
            includeCreditNotes?: boolean;
        };

        const report = await runWithCompanyIds(companyIds, () =>
            getSalespersonMonthlyInvoices(credentials, {
                salespersonId,
                year,
                month,
                includeCreditNotes,
            })
        );

        return NextResponse.json(report);
    } catch (error) {
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to load salesperson monthly invoices",
            },
            { status: 400 }
        );
    }
}
