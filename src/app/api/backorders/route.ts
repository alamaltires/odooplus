import { NextResponse } from "next/server";
import { BackorderDetails, BackorderSource } from "@/types/odoo";
import { getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";
import {
    listFilteredBackorderSnapshots,
    listBackorderSnapshotsPaginated,
    searchBackorderSnapshots,
    saveBackorderSnapshot,
    findBackorderByOrderNumber,
} from "@/lib/server/backorders-store";
import { BackorderStatus } from "@/types/odoo";
import { guardAuthenticatedRequest } from "@/lib/server/request-guard";

export async function GET(request: Request) {
    try {
        const guard = await guardAuthenticatedRequest(request, {
            rateLimit: {
                key: "api:backorders:get",
                maxRequests: 60,
                windowMs: 60_000,
            },
        });

        if (!guard.ok) {
            return guard.response;
        }

        const { searchParams } = new URL(request.url);
        const rawLimit = Number(searchParams.get("limit") ?? 10);
        const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(50, rawLimit)) : 10;
        const cursor = searchParams.get("cursor");
        const search = String(searchParams.get("search") ?? "").trim();
        const rawStatus = String(searchParams.get("status") ?? "all").trim().toLowerCase();
        const rawPage = Number(searchParams.get("page") ?? 1);
        const page = Number.isFinite(rawPage) ? Math.max(1, rawPage) : 1;
        const status: BackorderStatus | "all" =
            rawStatus === "ready" || rawStatus === "partial" || rawStatus === "procced" || rawStatus === "pendding"
                ? rawStatus
                : "all";

        if (status !== "all") {
            const items = await listFilteredBackorderSnapshots({
                query: search,
                status,
            });

            return NextResponse.json({
                items,
                hasNextPage: false,
                page: 1,
            }, { headers: guard.headers });
        }

        if (search) {
            const items = await searchBackorderSnapshots({
                query: search,
            });

            return NextResponse.json({
                items,
                hasNextPage: false,
                page: 1,
            }, { headers: guard.headers });
        }

        const { items, nextCursor } = await listBackorderSnapshotsPaginated({
            limit,
            cursor,
        });

        return NextResponse.json({
            items,
            nextCursor,
            hasNextPage: Boolean(nextCursor),
            page,
        }, { headers: guard.headers });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to list backorders" },
            { status: 500 }
        );
    }
}

export async function POST(request: Request) {
    try {
        const guard = await guardAuthenticatedRequest(request, {
            rateLimit: {
                key: "api:backorders:post",
                maxRequests: 25,
                windowMs: 60_000,
            },
        });

        if (!guard.ok) {
            return guard.response;
        }

        const { details, source, force } = (await request.json()) as {
            details: BackorderDetails;
            source?: BackorderSource;
            force?: boolean;
        };

        const normalizedSource: BackorderSource = source === "odoo" ? "odoo" : "manual";
        const orderNumber = String(details.order.name ?? "").trim();

        if (!force && normalizedSource === "manual" && orderNumber) {
            const existing = await findBackorderByOrderNumber(orderNumber);
            if (existing) {
                return NextResponse.json(
                    { existingId: existing.id, orderNumber },
                    { status: 409 }
                );
            }
        }

        let credentials = undefined;
        if (normalizedSource === "manual" || normalizedSource === "odoo") {
            const authContext = await getOdooCredentialsFromRequest(request);
            credentials = authContext.credentials;
        }

        const saved = await saveBackorderSnapshot(details, normalizedSource, credentials);
        return NextResponse.json({ saved }, { headers: guard.headers });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to save backorder" },
            { status: 400 }
        );
    }
}
