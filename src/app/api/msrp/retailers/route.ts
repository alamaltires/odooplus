import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/server/firebase-admin";
import { getUserIdFromRequest } from "@/lib/server/auth-helpers";
import { normalizeRetailerUrl } from "@/lib/market-price";

// One list shared by every user (not per user). Stored as a single document;
// adds/removes use arrayUnion/arrayRemove so concurrent edits don't overwrite each other.
const COLLECTION = "msrp-retailers";
const SHARED_DOC = "shared";
const MAX_RETAILERS = 30;

async function readSharedUrls(): Promise<string[]> {
    const db = getAdminDb();
    const ref = db.collection(COLLECTION).doc(SHARED_DOC);
    const snapshot = await ref.get();
    if (snapshot.exists) {
        const urls = snapshot.data()?.urls;
        return Array.isArray(urls) ? urls.map(String) : [];
    }

    // First load after switching from per-user lists: merge everyone's existing list.
    const all = await db.collection(COLLECTION).get();
    const merged = Array.from(
        new Set(all.docs.flatMap((doc) => (Array.isArray(doc.data().urls) ? (doc.data().urls as unknown[]).map(String) : [])))
    ).slice(0, MAX_RETAILERS);
    await ref.set({ urls: merged, updatedAt: new Date().toISOString() });
    return merged;
}

export async function GET(request: Request) {
    try {
        await getUserIdFromRequest(request);
        return NextResponse.json({ urls: await readSharedUrls() });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to load retailers" },
            { status: 400 }
        );
    }
}

export async function POST(request: Request) {
    try {
        await getUserIdFromRequest(request);
        const body = (await request.json()) as { add?: unknown; remove?: unknown };
        const ref = getAdminDb().collection(COLLECTION).doc(SHARED_DOC);
        const current = await readSharedUrls();

        if (typeof body.add === "string") {
            const url = normalizeRetailerUrl(body.add);
            if (!current.includes(url)) {
                if (current.length >= MAX_RETAILERS) {
                    throw new Error(`At most ${MAX_RETAILERS} retailers are allowed.`);
                }
                await ref.set({ urls: FieldValue.arrayUnion(url), updatedAt: new Date().toISOString() }, { merge: true });
            }
        } else if (typeof body.remove === "string") {
            await ref.set({ urls: FieldValue.arrayRemove(body.remove), updatedAt: new Date().toISOString() }, { merge: true });
        } else {
            throw new Error("Nothing to do.");
        }

        return NextResponse.json({ urls: await readSharedUrls() });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to save retailers" },
            { status: 400 }
        );
    }
}
