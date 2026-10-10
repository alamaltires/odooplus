import { getAdminDb } from "@/lib/server/firebase-admin";
import { getUserIdFromRequest, getUserRoleFromRequest } from "@/lib/server/auth-helpers";
import { getOdooUserId, getSalesTeams, isCustomerAssignedToUser } from "@/lib/server/odoo-client";
import { OdooCredentials } from "@/types/odoo";

/**
 * For users with the "salesperson" role, returns the Odoo user id of the
 * account saved in their profile — the only salesperson they may see.
 * Returns null for every other role (no restriction).
 */
export async function getOwnSalespersonScope(
    request: Request,
    credentials: OdooCredentials
): Promise<number | null> {
    const role = await getUserRoleFromRequest(request);
    if (role !== "salesperson") {
        return null;
    }
    return getOdooUserId(credentials);
}

/**
 * The Odoo user ids whose data this request may see, or null for no
 * restriction. A salesperson gets only themself; a sales manager with a
 * Sales Team assigned (Settings -> App Permissions) gets that team's members.
 */
export async function getAllowedSalespersonIds(
    request: Request,
    credentials: OdooCredentials
): Promise<{ ids: number[] | null; restrictedToSelf: boolean }> {
    const role = await getUserRoleFromRequest(request);

    if (role === "salesperson") {
        return { ids: [await getOdooUserId(credentials)], restrictedToSelf: true };
    }

    if (role === "sales_manager") {
        const userId = await getUserIdFromRequest(request);
        const snapshot = await getAdminDb().collection("users").doc(userId).get();
        const salesTeamId = Number(snapshot.data()?.salesTeamId);
        if (Number.isFinite(salesTeamId) && salesTeamId > 0) {
            const teams = await getSalesTeams(credentials);
            const team = teams.find((item) => item.id === salesTeamId);
            return { ids: team ? team.memberIds : [], restrictedToSelf: false };
        }
    }

    return { ids: null, restrictedToSelf: false };
}

/**
 * Resolves the salesperson a report should run for: a salesperson is always
 * pinned to their own account; a team-scoped sales manager may only request
 * members of their team.
 */
export async function resolveSalespersonId(
    request: Request,
    credentials: OdooCredentials,
    requestedId: number
): Promise<number> {
    const { ids, restrictedToSelf } = await getAllowedSalespersonIds(request, credentials);
    if (ids === null) {
        return requestedId;
    }
    if (restrictedToSelf) {
        return ids[0];
    }
    if (!ids.includes(Number(requestedId))) {
        throw new Error("This salesperson is not part of your sales team.");
    }
    return requestedId;
}

/**
 * Throws when a salesperson-role user asks for a customer that is not
 * assigned to their Odoo account. No-op for other roles.
 */
export async function assertCustomerInScope(
    ownUserId: number | null,
    credentials: OdooCredentials,
    customerId: number
): Promise<void> {
    if (ownUserId === null) {
        return;
    }
    if (!(await isCustomerAssignedToUser(credentials, Number(customerId), ownUserId))) {
        throw new Error("This customer is not assigned to your account.");
    }
}
