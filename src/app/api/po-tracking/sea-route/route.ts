import { NextResponse } from "next/server";
import marnet from "searoute-js/data/marnet_densified.json";
import { createSeaRouter } from "@/lib/server/sea-router";
import { getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";

type LatLng = [number, number];

// Built once per server process (it indexes the whole lane network).
let router: ReturnType<typeof createSeaRouter> | null = null;

// A sea route between two ports never changes, so each leg is computed once.
const legCache = new Map<string, LatLng[]>();

function seaLeg(from: LatLng, to: LatLng): LatLng[] {
    const key = `${from.join(",")}>${to.join(",")}`;
    const cached = legCache.get(key);
    if (cached) return cached;

    router ??= createSeaRouter(marnet as never);
    const { path } = router.leg(from, to);
    legCache.set(key, path);
    return path;
}

export async function POST(request: Request) {
    try {
        await getOdooCredentialsFromRequest(request);
        const body = (await request.json()) as { routes?: Array<{ id: string; stops: LatLng[] }> };

        // One path per leg (port to port), so the page can place the ship on the right leg.
        const paths: Record<string, LatLng[][]> = {};
        for (const route of (body.routes ?? []).slice(0, 200)) {
            const stops = (route.stops ?? []).filter(
                (stop) => Array.isArray(stop) && Number.isFinite(stop[0]) && Number.isFinite(stop[1])
            );
            if (stops.length < 2) continue;

            const legs: LatLng[][] = [];
            for (let index = 0; index < stops.length - 1; index += 1) {
                legs.push(seaLeg(stops[index], stops[index + 1]));
            }
            paths[route.id] = legs;
        }

        return NextResponse.json({ paths });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to compute sea routes" },
            { status: 400 }
        );
    }
}
