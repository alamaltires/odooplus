import { NextResponse } from "next/server";
import { getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";

type Carrier = { code: string; name: string };

// The carrier list rarely changes; keep it for a day so the page doesn't spend requests on it.
let cached: { at: number; carriers: Carrier[] } | null = null;
const TTL_MS = 24 * 60 * 60 * 1000;

export async function POST(request: Request) {
    try {
        await getOdooCredentialsFromRequest(request);

        if (cached && Date.now() - cached.at < TTL_MS) {
            return NextResponse.json({ carriers: cached.carriers });
        }

        const apiKey = process.env.QUBICTRON_API_KEY;
        if (!apiKey) {
            return NextResponse.json({ error: "QUBICTRON_API_KEY is not configured on the server." }, { status: 500 });
        }

        const response = await fetch("https://api.qubictron.com/tracking/v1/ocean/carriers", {
            headers: { "x-api-key": apiKey },
            cache: "no-store",
        });
        const body = (await response.json().catch(() => ({}))) as {
            carriers?: Array<{ code?: string; name?: string; status?: { is_active?: boolean }; tracking_support?: { bl?: boolean } }>;
        };
        if (!response.ok || !Array.isArray(body.carriers)) {
            return NextResponse.json({ error: "Could not load the carrier list." }, { status: 400 });
        }

        const carriers = body.carriers
            .filter((carrier) => carrier.code && carrier.name && carrier.status?.is_active !== false && carrier.tracking_support?.bl !== false)
            .map((carrier) => ({ code: String(carrier.code), name: String(carrier.name) }))
            .sort((a, b) => a.name.localeCompare(b.name));

        cached = { at: Date.now(), carriers };
        return NextResponse.json({ carriers });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to load carriers" },
            { status: 400 }
        );
    }
}
