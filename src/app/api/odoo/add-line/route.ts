import { NextResponse } from "next/server";
import { addProductToOrder, runWithCompanyIds } from "@/lib/server/odoo-client";
import { getCompanyIdsFromRequest, getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";
import { OdooOrderLineInput } from "@/types/odoo";

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const companyIds = await getCompanyIdsFromRequest(request);
        const { orderId, line } = (await request.json()) as {
            orderId: number;
            line: OdooOrderLineInput;
        };

        const data = await runWithCompanyIds(companyIds, () =>
            addProductToOrder(credentials, Number(orderId), line)
        );
        return NextResponse.json(data);
    } catch (error) {
        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : "Failed to add product",
            },
            { status: 400 }
        );
    }
}
