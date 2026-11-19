import { NextResponse } from "next/server";
import { getCustomers, runWithCompanyIds, type CustomerTagFilter } from "@/lib/server/odoo-client";
import { getCompanyIdsFromRequest, getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";
import { getCustomerTagScope, getOwnSalespersonScope } from "@/lib/server/salesperson-scope";

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const ownUserId = await getOwnSalespersonScope(request, credentials);
        const permissionTags = await getCustomerTagScope(request);
        const companyIds = await getCompanyIdsFromRequest(request);
        const { list } = (await request.json().catch(() => ({}))) as { list?: "act" | "all" | "assigned" };

        // The choice only ever narrows what the user's tag permission allows, never widens it:
        // "Customer ACT" means the default tag (null) when the permission is "every customer";
        // for a user limited to other tags, every choice stays inside those tags.
        const tagFilter: CustomerTagFilter = list === "act" && permissionTags && "all" in permissionTags ? null : permissionTags;

        const customers = await runWithCompanyIds(companyIds, () =>
            getCustomers(credentials, ownUserId, tagFilter, { onlyAssigned: list === "assigned" })
        );
        return NextResponse.json({ customers });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to load customers" },
            { status: 400 }
        );
    }
}
