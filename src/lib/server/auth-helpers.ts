import { getAdminAuth, getAdminDb } from "@/lib/server/firebase-admin";
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

export type AppUserRole = "admin" | "purchase" | "salesperson" | "sales_manager" | "store" | "user";

export async function getUserRoleFromRequest(request: Request): Promise<AppUserRole> {
    const userId = await getUserIdFromAuthHeader(request);
    const userDoc = await getAdminDb().collection("users").doc(userId).get();
    const role = String(userDoc.data()?.role ?? "user").toLowerCase();

    if (
        role === "admin" ||
        role === "purchase" ||
        role === "salesperson" ||
        role === "sales_manager" ||
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

export async function getOdooCredentialsFromRequest(
    request: Request
): Promise<{ userId: string; credentials: OdooCredentials }> {
    const userId = await getUserIdFromAuthHeader(request);

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

    return {
        userId,
        credentials: {
            url: systemSettings.url,
            db: systemSettings.db,
            username: userCredentials.username,
            password: userCredentials.password,
        },
    };
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
