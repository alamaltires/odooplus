import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/server/firebase-admin";
import { getUserIdFromRequest } from "@/lib/server/auth-helpers";
import { normalizeRetailerUrl } from "@/lib/market-price";

const COLLECTION = "msrp-retailers";
const MAX_RETAILERS = 30;

export async function GET(request: Request) {
    try {
        const userId = await getUserIdFromRequest(request);
        const snapshot = await getAdminDb().collection(COLLECTION).doc(userId).get();
        const urls = snapshot.data()?.urls;
        return NextResponse.json({ urls: Array.isArray(urls) ? urls.map(String) : [] });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to load retailers" },
            { status: 400 }
        );
    }
}

export async function PUT(request: Request) {
    try {
        const userId = await getUserIdFromRequest(request);
        const body = (await request.json()) as { urls?: unknown };
        if (!Array.isArray(body.urls)) {
            throw new Error("urls must be a list");
        }
        if (body.urls.length > MAX_RETAILERS) {
            throw new Error(`At most ${MAX_RETAILERS} retailers are allowed.`);
        }

        const urls = Array.from(new Set(body.urls.map((value) => normalizeRetailerUrl(String(value)))));
        await getAdminDb().collection(COLLECTION).doc(userId).set({ urls, updatedAt: new Date().toISOString() });
        return NextResponse.json({ urls });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to save retailers" },
            { status: 400 }
        );
    }
}
