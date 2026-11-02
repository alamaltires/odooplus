import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { getAdminAuth, getAdminDb } from "@/lib/server/firebase-admin";
import { recordActivity, type ActivityCategory } from "@/lib/server/activity-log";
import { OdooCredentials } from "@/types/odoo";

async function getUserIdFromAuthHeader(request: Request): Promise<string> {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
        throw new Error("Missing or invalid Authorization header");
    }

    const idToken = authHeader.slice(7);

    try {
        const auth = getAdminAuth();
        const decodedToken = await auth.verifyIdToken(idToken);
        return decodedToken.uid;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        throw new Error(`Authentication failed: ${errorMessage}`);
    }
}

export async function getUserIdFromRequest(request: Request): Promise<string> {
    return getUserIdFromAuthHeader(request);
}

export type AppUserRole = "admin" | "purchase" | "salesperson" | "sales_manager" | "accountant" | "manager" | "store" | "user";

export async function getUserRoleFromRequest(request: Request): Promise<AppUserRole> {
    const userId = await getUserIdFromAuthHeader(request);
    const userDoc = await getAdminDb().collection("users").doc(userId).get();
    const role = String(userDoc.data()?.role ?? "user").toLowerCase();

    if (
        role === "admin" ||
        role === "purchase" ||
        role === "salesperson" ||
        role === "sales_manager" ||
        role === "accountant" ||
        role === "manager" ||
        role === "store"
    ) {
        return role;
    }

    return "user";
}

/**
 * The Odoo URL + Database are a single system-wide setting (configured by an
 * admin under Settings), not duplicated per user — see `system/odoo` and
 * `/api/system-settings`. Every user still keeps their own username/password
 * under `users/{uid}/integrations/odoo`; the two are combined at request time
 * into the full `OdooCredentials` shape the rest of the app expects.
 */
export type OdooUserCredentials = { username: string; password: string };

export async function getOdooSystemSettings(): Promise<{ url: string; db: string } | null> {
    const snapshot = await getAdminDb().collection("system").doc("odoo").get();
    const data = snapshot.data() as { url?: string; db?: string } | undefined;

    if (!data?.url || !data?.db) {
        return null;
    }

    return { url: data.url, db: data.db };
}

export async function saveOdooSystemSettings(input: { url: string; db: string; updatedBy: string }): Promise<void> {
    await getAdminDb().collection("system").doc("odoo").set(
        {
            url: input.url,
            db: input.db,
            updatedBy: input.updatedBy,
            updatedAt: new Date().toISOString(),
        },
        { merge: true }
    );
}

/**
 * The PO Tracking "Update" password. Only a salted scrypt hash is stored
 * (`system/po-tracking`); when none is set, updating is unprotected.
 */
export async function hasPoTrackingPassword(): Promise<boolean> {
    const snapshot = await getAdminDb().collection("system").doc("po-tracking").get();
    return Boolean((snapshot.data() as { passwordHash?: string } | undefined)?.passwordHash);
}

export async function setPoTrackingPassword(password: string, updatedBy: string): Promise<void> {
    const ref = getAdminDb().collection("system").doc("po-tracking");
    if (!password) {
        await ref.set({ passwordHash: null, passwordSalt: null, updatedBy, updatedAt: new Date().toISOString() }, { merge: true });
        return;
    }
    const salt = randomBytes(16).toString("hex");
    const hash = scryptSync(password, salt, 64).toString("hex");
    await ref.set(
        { passwordHash: hash, passwordSalt: salt, updatedBy, updatedAt: new Date().toISOString() },
        { merge: true }
    );
}

/** True when no password is set, or the given one matches. */
export async function verifyPoTrackingPassword(password: string | undefined): Promise<boolean> {
    const snapshot = await getAdminDb().collection("system").doc("po-tracking").get();
    const data = snapshot.data() as { passwordHash?: string | null; passwordSalt?: string | null } | undefined;
    if (!data?.passwordHash || !data.passwordSalt) return true;
    if (!password) return false;
    const expected = Buffer.from(data.passwordHash, "hex");
    const actual = scryptSync(password, data.passwordSalt, 64);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * Find any stored Odoo credentials configured by a user (under
 * `users/{uid}/integrations/odoo`), combined with the system-wide URL +
 * Database. Used by background/system tasks (e.g. the inventory webhook and
 * data migrations) that have no logged-in session.
 */
export async function getStoredOdooCredentials(): Promise<OdooCredentials | null> {
    const systemSettings = await getOdooSystemSettings();
    if (!systemSettings) {
        return null;
    }

    const integrations = await getAdminDb().collectionGroup("integrations").get();

    for (const doc of integrations.docs) {
        if (doc.id !== "odoo") {
            continue;
        }
        const credentials = (doc.data() as { credentials?: Partial<OdooUserCredentials> } | undefined)?.credentials;
        if (credentials?.username && credentials?.password) {
            return { ...systemSettings, username: credentials.username, password: credentials.password };
        }
    }

    return null;
}

// The saved Odoo login is read from Firestore on every request; it hardly ever changes, so it is
// kept for a short while (a changed password in Settings takes effect within this time).
const CREDENTIALS_CACHE_TTL_MS = 30_000;
const credentialsCache = new Map<string, { at: number; credentials: OdooCredentials }>();

// Endpoints that count as "someone ran a report / sent an email": logged when they ask for Odoo access.
const LOGGED_ENDPOINTS: Record<string, { action: string; category: ActivityCategory }> = {
    "odoo/salesperson-activity-report": { action: "Ran Salesperson Activity report", category: "report" },
    "odoo/customer-activity-report": { action: "Ran Customer Activity report", category: "report" },
    "odoo/customer-report": { action: "Opened a Customer Report", category: "report" },
    "odoo/payment-followup-by-salesperson": { action: "Ran Payment Follow-up (by salesperson)", category: "report" },
    "odoo/payment-followup-by-customer": { action: "Ran Payment Follow-up (by customer)", category: "report" },
    "odoo/payment-followup-by-tag": { action: "Ran Payment Follow-up (by tag)", category: "report" },
    "odoo/partner-ledger": { action: "Opened a Partner Ledger", category: "report" },
    "odoo/margin-analytics": { action: "Ran Margin Analytics", category: "report" },
    "odoo/margin-analytics-breakdown": { action: "Opened a Margin Analytics breakdown", category: "report" },
    "odoo/products-performance": { action: "Ran Products Performance", category: "report" },
    "odoo/aged-stock": { action: "Ran Aged Stock", category: "report" },
    "odoo/purchase-order-report": { action: "Ran Purchase Order report", category: "report" },
    "odoo/sales-target-details": { action: "Opened Sales Target details", category: "report" },
    "odoo/salesperson-monthly-invoices": { action: "Loaded Sales Targets report", category: "report" },
    "odoo/price-list-request": { action: "Generated a Price List", category: "report" },
    "odoo/sales-target-email": { action: "Emailed a Sales Target report", category: "write" },
    "odoo/sales-target-category-email": { action: "Emailed a Sales Target category report", category: "write" },
    "odoo/pending-order-email": { action: "Sent a pending order email", category: "write" },
    "odoo/add-line": { action: "Added a product line to an order", category: "write" },
    "backorder-to-order": { action: "Created an order from a backorder", category: "write" },
    "backorder-email": { action: "Sent a backorder email", category: "write" },
    "backorder-whatsapp": { action: "Sent a backorder WhatsApp message", category: "write" },
    "po-tracking/telex": { action: "Updated PO Tracking telex date", category: "write" },
};
const LOGGED_BODY_KEYS = ["customerId", "salespersonId", "tagId", "startDate", "endDate", "asOfDate", "year", "month", "kind"];

async function logEndpointUse(userId: string, request: Request) {
    const endpoint = LOGGED_ENDPOINTS[new URL(request.url).pathname.replace(/^\/api\//, "")];
    if (!endpoint) return;
    let detail = "";
    try {
        const body = (await request.clone().json()) as Record<string, unknown>;
        detail = LOGGED_BODY_KEYS.filter((key) => body[key] !== undefined && body[key] !== null && body[key] !== "")
            .map((key) => `${key}: ${String(body[key])}`)
            .join(", ");
    } catch {
        // no JSON body
    }
    await recordActivity(userId, request, { action: endpoint.action, category: endpoint.category, detail });
}

export async function getOdooCredentialsFromRequest(
    request: Request
): Promise<{ userId: string; credentials: OdooCredentials }> {
    const userId = await getUserIdFromAuthHeader(request);
    await logEndpointUse(userId, request);
    const cached = credentialsCache.get(userId);
    if (cached && Date.now() - cached.at < CREDENTIALS_CACHE_TTL_MS) {
        return { userId, credentials: cached.credentials };
    }

    const [snapshot, systemSettings] = await Promise.all([
        getAdminDb().collection("users").doc(userId).collection("integrations").doc("odoo").get(),
        getOdooSystemSettings(),
    ]);

    if (!systemSettings) {
        throw new Error("Odoo URL and Database are not configured yet. Ask an admin to set them up in Settings.");
    }

    const data = snapshot.data() as { credentials?: Partial<OdooUserCredentials> } | undefined;
    const userCredentials = data?.credentials ?? null;

    if (!userCredentials?.username || !userCredentials?.password) {
        throw new Error("Odoo settings not configured. Please set up your Odoo username and password in settings.");
    }

    const credentials = {
        url: systemSettings.url,
        db: systemSettings.db,
        username: userCredentials.username,
        password: userCredentials.password,
    };
    credentialsCache.set(userId, { at: Date.now(), credentials });
    return { userId, credentials };
}

/**
 * Reads the `companyIds` the client-side sidebar company selector attached
 * to the request body (see `src/lib/company-filter.ts` and `post()` in
 * `client-odoo.ts`), without consuming the request body stream — route
 * handlers still call `request.json()` themselves afterwards. Returns an
 * empty array when absent (e.g. non-JSON or GET requests), which callers
 * should treat as "no company restriction".
 */
export async function getCompanyIdsFromRequest(request: Request): Promise<number[]> {
    try {
        const body = await request.clone().json();
        if (!body || typeof body !== "object" || !Array.isArray((body as { companyIds?: unknown }).companyIds)) {
            return [];
        }

        return (body as { companyIds: unknown[] }).companyIds.filter(
            (id): id is number => typeof id === "number" && id > 0
        );
    } catch {
        return [];
    }
}
