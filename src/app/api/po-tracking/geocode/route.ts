import { NextResponse } from "next/server";
import { getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";
import { getAdminDb } from "@/lib/server/firebase-admin";

type LatLng = [number, number];

const COLLECTION = "port-coordinates";
// Per-process cache in front of Firestore (a port's position never changes).
const memory = new Map<string, LatLng | null>();
const MAX_LOOKUPS_PER_CALL = 8;

const docId = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 120);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function nominatim(query: string): Promise<LatLng | null> {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");
    url.searchParams.set("q", query);
    const response = await fetch(url, {
        // Nominatim's usage policy requires an identifying User-Agent.
        headers: { "User-Agent": "OdooPlus-PoTracking/1.0 (internal shipment map)" },
        cache: "no-store",
    });
    if (!response.ok) return null;
    const results = (await response.json()) as Array<{ lat?: string; lon?: string }>;
    const lat = Number(results[0]?.lat);
    const lng = Number(results[0]?.lon);
    return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
}

/** Port names ("Iskenderun, Türkiye") -> coordinates, geocoded once and then remembered in Firestore. */
export async function POST(request: Request) {
    try {
        await getOdooCredentialsFromRequest(request);
        const body = (await request.json()) as { names?: string[] };
        const names = Array.from(new Set((body.names ?? []).map((name) => String(name).trim()).filter(Boolean))).slice(0, 40);

        const points: Record<string, LatLng | null> = {};
        let lookups = 0;
        const db = getAdminDb();

        for (const name of names) {
            if (memory.has(name)) {
                points[name] = memory.get(name) ?? null;
                continue;
            }
            const saved = await db.collection(COLLECTION).doc(docId(name)).get();
            if (saved.exists) {
                const data = saved.data() as { lat?: number; lng?: number; found?: boolean };
                const value: LatLng | null = data.found && typeof data.lat === "number" && typeof data.lng === "number" ? [data.lat, data.lng] : null;
                memory.set(name, value);
                points[name] = value;
                continue;
            }
            if (lookups >= MAX_LOOKUPS_PER_CALL) continue; // the client asks again for the rest

            lookups += 1;
            const [place, ...rest] = name.split(",").map((part) => part.trim());
            const country = rest.join(", ");
            let found = await nominatim(`${place} port${country ? `, ${country}` : ""}`);
            if (!found) {
                await sleep(1100);
                found = await nominatim(name);
            }
            await sleep(1100); // 1 request/second at most
            memory.set(name, found);
            points[name] = found;
            await db.collection(COLLECTION).doc(docId(name)).set({ name, found: Boolean(found), lat: found?.[0] ?? null, lng: found?.[1] ?? null });
        }

        return NextResponse.json({ points });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to look up ports" },
            { status: 400 }
        );
    }
}
