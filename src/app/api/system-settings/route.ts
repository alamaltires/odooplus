import { NextResponse } from "next/server";
import { getOdooSystemSettings, getUserIdFromRequest, getUserRoleFromRequest, saveOdooSystemSettings } from "@/lib/server/auth-helpers";

export async function GET(request: Request) {
    try {
        const role = await getUserRoleFromRequest(request);
        if (role !== "admin") {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const settings = await getOdooSystemSettings();
        return NextResponse.json({ settings });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to load system settings" },
            { status: 400 }
        );
    }
}

export async function POST(request: Request) {
    try {
        const role = await getUserRoleFromRequest(request);
        if (role !== "admin") {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const actorId = await getUserIdFromRequest(request);
        const body = (await request.json()) as { url?: string; db?: string };

        const url = String(body.url ?? "").trim();
        const dbName = String(body.db ?? "").trim();

        if (!url) {
            throw new Error("Odoo URL is required.");
        }
        if (!dbName) {
            throw new Error("Database is required.");
        }

        await saveOdooSystemSettings({ url, db: dbName, updatedBy: actorId });

        return NextResponse.json({ settings: { url, db: dbName } });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to save system settings" },
            { status: 400 }
        );
    }
}
