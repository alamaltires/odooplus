import { NextResponse } from "next/server";
import { getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";
import { getAdminDb } from "@/lib/server/firebase-admin";

/** Sets or clears the Telex Release date of a B/L. Stored in our own database only. */
export async function POST(request: Request) {
    try {
        await getOdooCredentialsFromRequest(request);
        const { blNumber, date } = (await request.json()) as { blNumber?: string; date?: string | null };
        if (!blNumber?.trim()) {
            return NextResponse.json({ error: "B/L number is required." }, { status: 400 });
        }
        if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return NextResponse.json({ error: "Invalid date." }, { status: 400 });
        }

        const doc = getAdminDb().collection("po-tracking-telex").doc(blNumber.replace(/[^A-Za-z0-9_-]/g, "_"));
        if (date) {
            await doc.set({ blNumber, date });
        } else {
            await doc.delete();
        }
        return NextResponse.json({ ok: true });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to save Telex Release date" },
            { status: 400 }
        );
    }
}
