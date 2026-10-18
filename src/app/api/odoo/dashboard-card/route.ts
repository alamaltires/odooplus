import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/server/firebase-admin";
import {
    getCompanyIdsFromRequest,
    getOdooCredentialsFromRequest,
    getUserIdFromRequest,
    getUserRoleFromRequest,
} from "@/lib/server/auth-helpers";
import { computeDashboardCard, runWithCompanyIds } from "@/lib/server/odoo-client";
import { getAllowedSalespersonIds, getCustomerTagScope } from "@/lib/server/salesperson-scope";
import { visibleDashboardCards } from "@/lib/dashboard-cards";

export const maxDuration = 60;

const cacheKey = (userId: string, companyIds: number[]) => `v9_${userId}_${[...companyIds].sort((a, b) => a - b).join("-") || "all"}`;

// Bump the `v9_` prefix below whenever a card's data shape changes, so old saved figures are ignored.

/**
 * Dashboard figures. Saved per user (and company selection, since the numbers depend on the
 * user's scope). `cachedOnly` returns what was saved; a `card` request always recalculates
 * that card from Odoo and saves it — it is only sent when someone presses Refresh.
 */
export async function POST(request: Request) {
    try {
        const body = (await request.json().catch(() => ({}))) as { card?: string; refresh?: boolean; cachedOnly?: boolean };
        const cardId = String(body.card ?? "");
        const userId = await getUserIdFromRequest(request);
        const role = await getUserRoleFromRequest(request);
        const profile = (await getAdminDb().collection("users").doc(userId).get()).data();
        const enabledApps = Array.isArray(profile?.enabledApps) ? (profile.enabledApps as string[]) : null;

        // Opening the dashboard only reads what was saved last time; it never queries Odoo.
        if (body.cachedOnly) {
            const companyIds = await getCompanyIdsFromRequest(request);
            const saved = (await getAdminDb().collection("dashboardCache").doc(cacheKey(userId, companyIds)).get()).data()?.cards ?? {};
            const allowed = new Set(visibleDashboardCards(role, enabledApps).map((card) => card.id));
            return NextResponse.json({ cards: Object.fromEntries(Object.entries(saved).filter(([id]) => allowed.has(id as never))) });
        }

        if (!visibleDashboardCards(role, enabledApps).some((card) => card.id === cardId)) {
            return NextResponse.json({ error: "You do not have access to this dashboard card." }, { status: 403 });
        }

        const companyIds = await getCompanyIdsFromRequest(request);
        const cacheRef = getAdminDb().collection("dashboardCache").doc(cacheKey(userId, companyIds));

        const { credentials } = await getOdooCredentialsFromRequest(request);
        const { ids: salespersonIds } = await getAllowedSalespersonIds(request, credentials);
        const tags = await getCustomerTagScope(request);
        const data = await runWithCompanyIds(companyIds, () =>
            computeDashboardCard(credentials, cardId, { salespersonIds, tags })
        );

        const fetchedAt = new Date().toISOString();
        await cacheRef.set({ cards: { [cardId]: { data, fetchedAt } }, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        return NextResponse.json({ data, fetchedAt, cached: false });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to load dashboard card" },
            { status: 400 }
        );
    }
}
