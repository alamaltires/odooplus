import { NextResponse } from "next/server";
import searoute from "searoute-js";
import { getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";

type LatLng = [number, number];

// A sea route between two ports never changes, so each leg is computed once.
const legCache = new Map<string, LatLng[]>();

const point = ([lat, lng]: LatLng) => ({
    type: "Feature" as const,
    properties: {},
    geometry: { type: "Point" as const, coordinates: [lng, lat] as [number, number] },
});

function seaLeg(from: LatLng, to: LatLng): LatLng[] {
    const key = `${from.join(",")}>${to.join(",")}`;
    const cached = legCache.get(key);
    if (cached) return cached;

    let leg: LatLng[] = [from, to];
    // The library logs on every snap; keep the server log clean.
    const originalLog = console.log;
    console.log = () => undefined;
    try {
        const line = searoute(point(from), point(to));
        if (line && line.geometry.coordinates.length > 1) {
            leg = [from, ...line.geometry.coordinates.map(([lng, lat]): LatLng => [lat, lng]), to];
        }
    } catch {
        // No sea route found — fall back to a straight line for this leg.
    } finally {
        console.log = originalLog;
    }
    legCache.set(key, leg);
    return leg;
}

export async function POST(request: Request) {
    try {
        await getOdooCredentialsFromRequest(request);
        const body = (await request.json()) as { routes?: Array<{ id: string; stops: LatLng[] }> };

        const paths: Record<string, LatLng[]> = {};
        for (const route of (body.routes ?? []).slice(0, 200)) {
            const stops = (route.stops ?? []).filter(
                (stop) => Array.isArray(stop) && Number.isFinite(stop[0]) && Number.isFinite(stop[1])
            );
            if (stops.length < 2) continue;

            const path: LatLng[] = [];
            for (let index = 0; index < stops.length - 1; index += 1) {
                const leg = seaLeg(stops[index], stops[index + 1]);
                path.push(...(index === 0 ? leg : leg.slice(1)));
            }
            paths[route.id] = path;
        }

        return NextResponse.json({ paths });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to compute sea routes" },
            { status: 400 }
        );
    }
}
