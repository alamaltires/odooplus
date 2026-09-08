import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/server/firebase-admin";
import { getUserIdFromRequest, getUserRoleFromRequest } from "@/lib/server/auth-helpers";
import { deleteProductRequest, setProductRequestSeen } from "@/lib/server/product-requests-store";

type RouteContext = {
    params: Promise<{
        id: string;
    }>;
};

export async function PATCH(request: Request, context: RouteContext) {
    try {
        const role = await getUserRoleFromRequest(request);
        if (role !== "admin") {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const { id } = await context.params;
        const userId = await getUserIdFromRequest(request);
        const body = (await request.json()) as { seen?: unknown };
        const seen = Boolean(body.seen);

        const userDoc = await getAdminDb().collection("users").doc(userId).get();
        const email = String(userDoc.data()?.email ?? "");

        const record = await setProductRequestSeen(id, { seen, seenByEmail: email });
        return NextResponse.json({ request: record });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to update product request" },
            { status: 400 }
        );
    }
}

export async function DELETE(request: Request, context: RouteContext) {
    try {
        const role = await getUserRoleFromRequest(request);
        if (role !== "admin") {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const { id } = await context.params;
        await deleteProductRequest(id);
        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to delete product request" },
            { status: 400 }
        );
    }
}
