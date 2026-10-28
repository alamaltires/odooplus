import { NextResponse } from "next/server";
import { getCustomerTags } from "@/lib/server/odoo-client";
import { getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";
import { getCustomerTagScope } from "@/lib/server/salesperson-scope";

/** Customer tags a user can pick in reports: every tag, or only those allowed in their permissions. */
export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const [tags, scope] = await Promise.all([getCustomerTags(credentials), getCustomerTagScope(request)]);
        const allowed = scope && "ids" in scope ? scope.ids : null;
        return NextResponse.json({ tags: allowed ? tags.filter((tag) => allowed.includes(tag.id)) : tags });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to load customer tags" },
            { status: 400 }
        );
    }
}
