import { NextResponse } from "next/server";
import { getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";
import { getSavedPoTracking } from "@/lib/server/po-tracking-saved";

/** Last saved tracking result per B/L. Reads only our own database — never calls Qubictron. */
export async function POST(request: Request) {
    try {
        await getOdooCredentialsFromRequest(request);
        return NextResponse.json(await getSavedPoTracking());
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to load saved tracking" },
            { status: 400 }
        );
    }
}
