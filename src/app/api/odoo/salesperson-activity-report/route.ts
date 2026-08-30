import { NextResponse } from "next/server";
import { getSalespersonActivityReport } from "@/lib/server/odoo-client";
import { getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const { salespersonId, startDate, endDate } = (await request.json()) as {
            salespersonId: number;
            startDate: string;
            endDate: string;
        };

        const report = await getSalespersonActivityReport(credentials, {
            salespersonId,
            startDate,
            endDate,
        });

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