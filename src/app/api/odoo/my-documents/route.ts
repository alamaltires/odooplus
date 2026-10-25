import { NextResponse } from "next/server";
import { getMyDocuments, runWithCompanyIds } from "@/lib/server/odoo-client";
import { getCompanyIdsFromRequest, getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";

/** The signed-in user's own sales orders or invoices. */
export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const companyIds = await getCompanyIdsFromRequest(request);
        const body = (await request.json().catch(() => ({}))) as { kind?: string; status?: string; search?: string; limit?: number; offset?: number };
        const kind = body.kind === "invoices" ? "invoices" : body.kind === "quotations" ? "quotations" : "orders";

        const result = await runWithCompanyIds(companyIds, () =>
            getMyDocuments(credentials, { kind, status: body.status === "quotation" || body.status === "confirmed" || body.status === "cancelled" ? body.status : "all", search: body.search, limit: body.limit, offset: body.offset })
        );
        return NextResponse.json(result);
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to load your documents" }, { status: 400 });
    }
}
