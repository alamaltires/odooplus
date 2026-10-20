import { NextResponse } from "next/server";
import { createSalesQuotations, isCustomerInTagScope, runWithCompanyIds } from "@/lib/server/odoo-client";
import type { SalesQuotationLine } from "@/lib/server/odoo-client";
import { getCompanyIdsFromRequest, getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";
import { assertCustomerInScope, getCustomerTagScope, getOwnSalespersonScope } from "@/lib/server/salesperson-scope";

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const ownUserId = await getOwnSalespersonScope(request, credentials);
        const companyIds = await getCompanyIdsFromRequest(request);
        const body = (await request.json()) as { customerId?: number; lines?: SalesQuotationLine[] };

        const customerId = Number(body.customerId);
        if (!Number.isFinite(customerId) || customerId <= 0) {
            throw new Error("Select a customer first.");
        }
        await assertCustomerInScope(ownUserId, credentials, customerId);
        if (!(await isCustomerInTagScope(credentials, customerId, await getCustomerTagScope(request)))) {
            throw new Error("This customer is outside your customer tag permission.");
        }

        const quotations = await runWithCompanyIds(companyIds, () =>
            createSalesQuotations(credentials, {
                customerId,
                lines: Array.isArray(body.lines)
                    ? body.lines.map((line) => ({
                          productId: Number(line.productId),
                          quantity: Number(line.quantity),
                          description: typeof line.description === "string" ? line.description : undefined,
                          companyId: line.companyId ? Number(line.companyId) : null,
                      }))
                    : [],
            })
        );

        return NextResponse.json({ quotations });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to create quotation" },
            { status: 400 }
        );
    }
}
