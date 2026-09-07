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

export type AppUserRole = "admin" | "purchase" | "salesperson" | "store" | "user";

export async function getUserRoleFromRequest(request: Request): Promise<AppUserRole> {
    const userId = await getUserIdFromAuthHeader(request);
    const userDoc = await getAdminDb().collection("users").doc(userId).get();
    const role = String(userDoc.data()?.role ?? "user").toLowerCase();

    if (role === "admin" || role === "purchase" || role === "salesperson" || role === "store") {
        return role;
    }

    return "user";
}

/**
 * Find any stored Odoo credentials configured by a user (under
 * `users/{uid}/integrations/odoo`). Used by background/system tasks (e.g. the
 * inventory webhook and data migrations) that have no logged-in session.
 */
export async function getStoredOdooCredentials(): Promise<OdooCredentials | null> {
    const integrations = await getAdminDb().collectionGroup("integrations").get();

    for (const doc of integrations.docs) {
        if (doc.id !== "odoo") {
            continue;
        }
        const credentials = (doc.data() as { credentials?: OdooCredentials } | undefined)?.credentials;
        if (credentials?.url && credentials?.db && credentials?.username && credentials?.password) {
            return credentials;
        }
    }

    return null;
}

export async function getOdooCredentialsFromRequest(
    request: Request
): Promise<{ userId: string; credentials: OdooCredentials }> {
    const userId = await getUserIdFromAuthHeader(request);
    const snapshot = await getAdminDb()
        .collection("users")
        .doc(userId)
        .collection("integrations")
        .doc("odoo")
        .get();

    const data = snapshot.data() as { credentials?: OdooCredentials } | undefined;
    const credentials = data?.credentials ?? null;

    if (!credentials) {
        throw new Error("Odoo settings not configured. Please set up your Odoo credentials in settings.");
    }

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
