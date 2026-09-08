import { getAdminDb } from "@/lib/server/firebase-admin";

const COLLECTION = "product-requests";

export type ProductRequestType = "new_product" | "missing_size" | "missing_pattern";

export type ProductRequestRecord = {
    id: string;
    requestType: ProductRequestType;
    brand: string;
    size: string;
    pattern: string;
    notes: string;
    searchQuery: string;
    /**
     * The existing catalogue product the requester picked as "closest to
     * what I need" (from a card's quick-request button, or the in-panel
     * picker) — lets brand/pattern auto-fill from a real product instead of
     * being retyped, and gives the admin a concrete point of comparison.
     */
    referenceProductId: number | null;
    referenceProductName: string;
    /** Set by an admin once they've reviewed the request — see markProductRequestSeen. */
    seen: boolean;
    seenAt: string | null;
    seenByEmail: string;
    requestedByUserId: string;
    requestedByEmail: string;
    requestedByName: string;
    createdAt: string;
};

function normalizeRequestType(value: unknown): ProductRequestType {
    if (value === "missing_size" || value === "missing_pattern") {
        return value;
    }
    return "new_product";
}

export async function createProductRequest(input: {
    requestType?: unknown;
    brand?: unknown;
    size?: unknown;
    pattern?: unknown;
    notes?: unknown;
    searchQuery?: unknown;
    referenceProductId?: unknown;
    referenceProductName?: unknown;
    requestedByUserId: string;
    requestedByEmail: string;
    requestedByName: string;
}): Promise<ProductRequestRecord> {
    const notes = String(input.notes ?? "").trim();
    const brand = String(input.brand ?? "").trim();
    const size = String(input.size ?? "").trim();
    const pattern = String(input.pattern ?? "").trim();
    const requestType = normalizeRequestType(input.requestType);
    const referenceProductIdNum = Number(input.referenceProductId);
    const referenceProductId = Number.isFinite(referenceProductIdNum) && referenceProductIdNum > 0 ? referenceProductIdNum : null;
    const referenceProductName = String(input.referenceProductName ?? "").trim();

    if (requestType === "missing_size" && !size) {
        throw new Error("Enter the size that's missing.");
    }
    if (requestType === "missing_pattern" && !pattern && !notes) {
        throw new Error("Enter the pattern that's missing (or describe it in notes).");
    }
    if (!notes && !brand && !size && !pattern && !referenceProductId) {
        throw new Error("Add at least a brand, size, pattern, or note describing what you're looking for.");
    }

    const db = getAdminDb();
    const ref = db.collection(COLLECTION).doc();
    const record: ProductRequestRecord = {
        id: ref.id,
        requestType,
        brand,
        size,
        pattern,
        notes,
        searchQuery: String(input.searchQuery ?? "").trim(),
        referenceProductId,
        referenceProductName,
        seen: false,
        seenAt: null,
        seenByEmail: "",
        requestedByUserId: input.requestedByUserId,
        requestedByEmail: input.requestedByEmail,
        requestedByName: input.requestedByName || input.requestedByEmail,
        createdAt: new Date().toISOString(),
    };

    await ref.set(record);
    return record;
}

/**
 * Lists requests. Pass `userId` to scope to one user's own requests (what a
 * non-admin sees in "My Requests"); omit it to list every request across
 * every user (what an admin sees).
 */
export async function listProductRequests(input: { userId?: string } = {}): Promise<ProductRequestRecord[]> {
    const db = getAdminDb();
    const collectionRef = db.collection(COLLECTION);

    // Sorted in JS rather than via `.orderBy()` server-side to avoid needing
    // a composite Firestore index for the (requestedByUserId ==, createdAt
    // desc) combination — request volume here is low enough that this is
    // cheap.
    const snapshot = input.userId
        ? await collectionRef.where("requestedByUserId", "==", input.userId).limit(1000).get()
        : await collectionRef.limit(1000).get();

    const records = snapshot.docs.map((doc) => backfillDefaults(doc.data() as ProductRequestRecord));
    records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return records;
}

// Requests created before `seen` existed won't have that field in
// Firestore — fill in a safe default so older rows still render.
function backfillDefaults(record: Partial<ProductRequestRecord>): ProductRequestRecord {
    return {
        seen: false,
        seenAt: null,
        seenByEmail: "",
        ...record,
    } as ProductRequestRecord;
}

/** Admin-only: permanently removes a request. */
export async function deleteProductRequest(id: string): Promise<void> {
    await getAdminDb().collection(COLLECTION).doc(id).delete();
}

/** Admin-only: toggles whether a request has been reviewed. */
export async function setProductRequestSeen(
    id: string,
    input: { seen: boolean; seenByEmail: string }
): Promise<ProductRequestRecord> {
    const ref = getAdminDb().collection(COLLECTION).doc(id);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
        throw new Error("Request not found.");
    }

    const update = {
        seen: input.seen,
        seenAt: input.seen ? new Date().toISOString() : null,
        seenByEmail: input.seen ? input.seenByEmail : "",
    };
    await ref.set(update, { merge: true });

    return backfillDefaults({ ...(snapshot.data() as ProductRequestRecord), ...update });
}
