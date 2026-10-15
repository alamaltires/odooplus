import { NextResponse } from "next/server";
import { getCustomerTags } from "@/lib/server/odoo-client";
import { getOdooCredentialsFromRequest, getUserRoleFromRequest } from "@/lib/server/auth-helpers";

export async function POST(request: Request) {
    try {
        const role = await getUserRoleFromRequest(request);
        if (role !== "admin") {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const { credentials } = await getOdooCredentialsFromRequest(request);
        const tags = await getCustomerTags(credentials);
        return NextResponse.json({ tags });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to load customer tags" },
            { status: 400 }
        );
    }
}
