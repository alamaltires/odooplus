import { NextResponse } from "next/server";
import { getSalesTeams } from "@/lib/server/odoo-client";
import { getOdooCredentialsFromRequest, getUserRoleFromRequest } from "@/lib/server/auth-helpers";

export async function POST(request: Request) {
    try {
        const role = await getUserRoleFromRequest(request);
        if (role !== "admin") {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const { credentials } = await getOdooCredentialsFromRequest(request);
        const teams = await getSalesTeams(credentials);
        return NextResponse.json({ teams: teams.map(({ id, name }) => ({ id, name })) });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to load sales teams" },
            { status: 400 }
        );
    }
}
