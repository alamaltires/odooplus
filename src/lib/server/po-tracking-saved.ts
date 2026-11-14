import { getAdminDb } from "@/lib/server/firebase-admin";

type Saved = { tracked: Record<string, unknown>; carriers: Record<string, string>; telex: Record<string, string> };

// Reading every saved B/L from Firestore is the slowest part of opening PO Tracking,
// and it only changes when someone tracks a shipment or sets a Telex date — so it is
// kept for ten minutes, dropped on those writes, and shared by concurrent requests.
const TTL_MS = 600_000;
let cache: { at: number; value: Saved } | null = null;
let inflight: Promise<Saved> | null = null;

async function load(): Promise<Saved> {
    const db = getAdminDb();
    const [snapshot, carrierSnapshot, telexSnapshot] = await Promise.all([
        db.collection("po-tracking").limit(2000).get(),
        db.collection("po-tracking-carriers").limit(2000).get(),
        db.collection("po-tracking-telex").limit(2000).get(),
    ]);

    const tracked: Record<string, unknown> = {};
    for (const doc of snapshot.docs) {
        const data = doc.data() as { blNumber?: string };
        if (data.blNumber) tracked[data.blNumber] = data;
    }
    const carriers: Record<string, string> = {};
    for (const doc of carrierSnapshot.docs) {
        const data = doc.data() as { blNumber?: string; carrierCode?: string };
        if (data.blNumber && data.carrierCode) carriers[data.blNumber] = data.carrierCode;
    }
    const telex: Record<string, string> = {};
    for (const doc of telexSnapshot.docs) {
        const data = doc.data() as { blNumber?: string; date?: string };
        if (data.blNumber && data.date) telex[data.blNumber] = data.date;
    }
    return { tracked, carriers, telex };
}

export async function getSavedPoTracking(): Promise<Saved> {
    if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
    inflight ??= load()
        .then((value) => {
            cache = { at: Date.now(), value };
            return value;
        })
        .finally(() => {
            inflight = null;
        });
    return inflight;
}

export function invalidateSavedPoTracking() {
    cache = null;
}
