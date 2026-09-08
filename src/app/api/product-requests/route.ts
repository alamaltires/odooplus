import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/server/firebase-admin";
import { getUserIdFromRequest, getUserRoleFromRequest } from "@/lib/server/auth-helpers";
import { createProductRequest, listProductRequests } from "@/lib/server/product-requests-store";

export async function GET(request: Request) {
    try {
        const userId = await getUserIdFromRequest(request);
        const role = await getUserRoleFromRequest(request);

        const requests = await listProductRequests(role === "admin" ? {} : { userId });
        return NextResponse.json({ requests });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to load product requests" },
            { status: 400 }
        );
    }
}

export async function POST(request: Request) {
    try {
        const userId = await getUserIdFromRequest(request);
        const body = (await request.json()) as {
            requestType?: unknown;
            brand?: unknown;
            size?: unknown;
            pattern?: unknown;
            notes?: unknown;
            searchQuery?: unknown;
            referenceProductId?: unknown;
            referenceProductName?: unknown;
        };

        const userDoc = await getAdminDb().collection("users").doc(userId).get();
        const email = String(userDoc.data()?.email ?? "");

        const record = await createProductRequest({
            ...body,
            requestedByUserId: userId,
            requestedByEmail: email,
            requestedByName: email,
        });

        return NextResponse.json({ request: record });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to save product request" },
            { status: 400 }
        );
    }
}
