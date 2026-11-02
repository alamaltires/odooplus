import { Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/server/firebase-admin";

/** Admin-only audit trail (`activity_log` in Firestore). Written only by the server; entries older than the retention are deleted. */
export const ACTIVITY_RETENTION_DAYS = 60;
const COLLECTION = "activity_log";
const CLEANUP_INTERVAL_MS = 6 * 60 * 60_000;
const DELETE_BATCH = 400;

export type ActivityCategory = "account" | "navigation" | "report" | "write" | "export" | "settings";
export const ACTIVITY_CATEGORIES: ActivityCategory[] = ["account", "navigation", "report", "write", "export", "settings"];

export type ActivityEntry = {
    action: string;
    category: ActivityCategory;
    /** What it was done to (a customer, an order, a user...). */
    target?: string;
    /** Short human-readable extra info. Never put passwords or tokens here. */
    detail?: string;
};

function clip(value: string | undefined, max: number) {
    return (value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

const userCache = new Map<string, { at: number; email: string; role: string }>();

async function describeUser(userId: string) {
    const cached = userCache.get(userId);
    if (cached && Date.now() - cached.at < 5 * 60_000) return cached;
    const data = (await getAdminDb().collection("users").doc(userId).get()).data();
    const value = { at: Date.now(), email: String(data?.email ?? ""), role: String(data?.role ?? "user") };
    userCache.set(userId, value);
    return value;
}

/** Records one activity for a signed-in user. Never throws: logging must not break the action being logged. */
export async function recordActivity(userId: string, request: Request, entry: ActivityEntry): Promise<void> {
    try {
        const user = await describeUser(userId);
        const now = new Date();
        await getAdminDb().collection(COLLECTION).add({
            createdAt: Timestamp.fromDate(now),
            // Lets a Firestore TTL policy on `expireAt` do the same cleanup if one is ever enabled.
            expireAt: Timestamp.fromDate(new Date(now.getTime() + ACTIVITY_RETENTION_DAYS * 86_400_000)),
            userId,
            email: user.email,
            role: user.role,
            action: clip(entry.action, 120),
            category: entry.category,
            target: clip(entry.target, 200),
            detail: clip(entry.detail, 400),
            ip: clip((request.headers.get("x-forwarded-for") ?? "").split(",")[0] || request.headers.get("x-real-ip") || "", 60),
            userAgent: clip(request.headers.get("user-agent") ?? "", 160),
        });
        void cleanupOldActivity(false);
    } catch (error) {
        console.error("Failed to write the activity log", error);
    }
}

let lastCleanupAt = 0;
let cleanupRunning = false;

/**
 * FIFO cleanup: deletes the oldest entries once they are past the retention. Runs at most every few hours
 * after writes (`force` skips that wait, used when the admin opens the log).
 */
export async function cleanupOldActivity(force: boolean): Promise<number> {
    if (cleanupRunning || (!force && Date.now() - lastCleanupAt < CLEANUP_INTERVAL_MS)) return 0;
    cleanupRunning = true;
    let deleted = 0;
    try {
        const db = getAdminDb();
        const cutoff = Timestamp.fromDate(new Date(Date.now() - ACTIVITY_RETENTION_DAYS * 86_400_000));
        // A bounded number of batches per run keeps one request short; the next run continues.
        for (let round = 0; round < 25; round += 1) {
            const snapshot = await db.collection(COLLECTION).where("createdAt", "<", cutoff).orderBy("createdAt", "asc").limit(DELETE_BATCH).get();
            if (snapshot.empty) break;
            const batch = db.batch();
            snapshot.docs.forEach((doc) => batch.delete(doc.ref));
            await batch.commit();
            deleted += snapshot.size;
            if (snapshot.size < DELETE_BATCH) break;
        }
        lastCleanupAt = Date.now();
    } catch (error) {
        console.error("Failed to clean the activity log", error);
    } finally {
        cleanupRunning = false;
    }
    return deleted;
}

export type ActivityRow = {
    id: string;
    createdAt: string;
    userId: string;
    email: string;
    role: string;
    action: string;
    category: string;
    target: string;
    detail: string;
    ip: string;
    userAgent: string;
};

export type ActivityQuery = {
    limit: number;
    /** ISO time of the last row already shown; returns older entries. */
    before?: string;
    from?: string;
    to?: string;
    userId?: string;
    category?: string;
    search?: string;
};

/** Newest first. Filters run in memory over the scanned entries, so no composite index is needed. */
export async function queryActivity(query: ActivityQuery): Promise<{ rows: ActivityRow[]; nextBefore: string | null }> {
    const db = getAdminDb();
    const search = (query.search ?? "").trim().toLowerCase();
    const rows: ActivityRow[] = [];
    // `from`/`to` are full instants (the browser's local day boundaries); a bare date is read as UTC.
    const toInstant = (value: string, endOfDay: boolean) =>
        new Date(value.length === 10 ? `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z` : value);
    let cursor = query.before ? new Date(query.before) : query.to ? toInstant(query.to, true) : null;
    const lowerBound = query.from ? toInstant(query.from, false) : null;
    let scanned = 0;
    let exhausted = false;

    while (rows.length < query.limit && scanned < 6000) {
        let ref = db.collection(COLLECTION).orderBy("createdAt", "desc");
        if (cursor) ref = ref.where("createdAt", "<", Timestamp.fromDate(cursor));
        if (lowerBound) ref = ref.where("createdAt", ">=", Timestamp.fromDate(lowerBound));
        const snapshot = await ref.limit(500).get();
        if (snapshot.empty) {
            exhausted = true;
            break;
        }
        scanned += snapshot.size;
        for (const doc of snapshot.docs) {
            const data = doc.data();
            const createdAt = (data.createdAt as Timestamp).toDate();
            cursor = createdAt;
            if (query.userId && data.userId !== query.userId) continue;
            if (query.category && data.category !== query.category) continue;
            if (search && !`${data.email} ${data.action} ${data.target} ${data.detail}`.toLowerCase().includes(search)) continue;
            rows.push({
                id: doc.id,
                createdAt: createdAt.toISOString(),
                userId: String(data.userId ?? ""),
                email: String(data.email ?? ""),
                role: String(data.role ?? ""),
                action: String(data.action ?? ""),
                category: String(data.category ?? ""),
                target: String(data.target ?? ""),
                detail: String(data.detail ?? ""),
                ip: String(data.ip ?? ""),
                userAgent: String(data.userAgent ?? ""),
            });
            if (rows.length >= query.limit) break;
        }
        if (snapshot.size < 500) {
            exhausted = true;
            break;
        }
    }

    return { rows, nextBefore: exhausted || rows.length === 0 ? null : rows[rows.length - 1].createdAt };
}
