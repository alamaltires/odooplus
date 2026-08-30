import { NextResponse } from "next/server";
import { getDashboardStats } from "@/lib/server/odoo-client";
import { getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";
import { OdooDashboardActivityType } from "@/types/odoo";

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);

        let activityType: OdooDashboardActivityType = "crmVisits";
        let includeSummaryCounts = true;
        try {
            const body = (await request.json()) as {
                activityType?: string;
                includeSummaryCounts?: boolean;
            };
            if (
                body?.activityType === "crmVisits" ||
                body?.activityType === "quotations" ||
                body?.activityType === "salesOrders" ||
                body?.activityType === "invoices"
            ) {
                activityType = body.activityType;
            }
            if (typeof body?.includeSummaryCounts === "boolean") {
                includeSummaryCounts = body.includeSummaryCounts;
            }
        } catch {
            activityType = "crmVisits";
            includeSummaryCounts = true;
        }

        const data = await getDashboardStats(credentials, activityType, includeSummaryCounts);
        return NextResponse.json(data);
    } catch (error) {
        return NextResponse.json(
            {
                error:
                    error instanceof Error ? error.message : "Failed to load dashboard stats",
            },
            { status: 400 }
        );
    }
}
