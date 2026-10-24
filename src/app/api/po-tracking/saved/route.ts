import { NextResponse } from "next/server";
import { getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";
import { getAdminDb } from "@/lib/server/firebase-admin";

/** Last saved tracking result per B/L. Reads only our own database — never calls Qubictron. */
export async function POST(request: Request) {
    try {
        await getOdooCredentialsFromRequest(request);
        const snapshot = await getAdminDb().collection("po-tracking").limit(2000).get();

        const tracked: Record<string, unknown> = {};
        for (const doc of snapshot.docs) {
            const data = doc.data() as { blNumber?: string };
            if (data.blNumber) {
                tracked[data.blNumber] = data;
            }
        }

        const carrierSnapshot = await getAdminDb().collection("po-tracking-carriers").limit(2000).get();
        const carriers: Record<string, string> = {};
        for (const doc of carrierSnapshot.docs) {
            const data = doc.data() as { blNumber?: string; carrierCode?: string };
            if (data.blNumber && data.carrierCode) {
                carriers[data.blNumber] = data.carrierCode;
            }
        }

        const telexSnapshot = await getAdminDb().collection("po-tracking-telex").limit(2000).get();
        const telex: Record<string, string> = {};
        for (const doc of telexSnapshot.docs) {
            const data = doc.data() as { blNumber?: string; date?: string };
            if (data.blNumber && data.date) {
                telex[data.blNumber] = data.date;
            }
        }
        return NextResponse.json({ tracked, carriers, telex });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to load saved tracking" },
            { status: 400 }
        );
    }
}
