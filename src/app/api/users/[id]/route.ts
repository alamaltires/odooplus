import { NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/server/firebase-admin";
import { getUserIdFromRequest, getUserRoleFromRequest } from "@/lib/server/auth-helpers";
import { APP_HREFS } from "@/lib/app-permissions";

type Role = "admin" | "purchase" | "salesperson" | "sales_manager" | "store" | "user";

function normalizeRole(value: string | undefined): Role {
    if (
        value === "admin" ||
        value === "purchase" ||
        value === "salesperson" ||
        value === "sales_manager" ||
        value === "store" ||
        value === "user"
    ) {
        return value;
    }

    return "purchase";
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
    try {
        const role = await getUserRoleFromRequest(request);
        if (role !== "admin") {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const actorId = await getUserIdFromRequest(request);
        const { id } = await context.params;

        const body = (await request.json()) as {
            email?: string;
            password?: string;
            role?: string;
            enabledApps?: string[] | null;
        };

        const adminAuth = getAdminAuth();
        const authUpdate: { email?: string; password?: string } = {};

        if (typeof body.email === "string" && body.email.trim()) {
            authUpdate.email = body.email.trim().toLowerCase();
        }
        if (typeof body.password === "string" && body.password.length > 0) {
            if (body.password.length < 6) {
                throw new Error("Password must be at least 6 characters.");
            }
            authUpdate.password = body.password;
        }
        if (Object.keys(authUpdate).length > 0) {
            await adminAuth.updateUser(id, authUpdate);
        }

        const firestoreUpdate: Record<string, unknown> = {
            updatedAt: Timestamp.now(),
            updatedBy: actorId,
        };

        if (authUpdate.email) {
            firestoreUpdate.email = authUpdate.email;
        }
        if (typeof body.role === "string") {
            firestoreUpdate.role = normalizeRole(body.role);
        }
        if (body.enabledApps === null) {
            // Explicit null clears the override, reverting the user to
            // their role's default app set.
            firestoreUpdate.enabledApps = FieldValue.delete();
        } else if (Array.isArray(body.enabledApps)) {
            firestoreUpdate.enabledApps = body.enabledApps.filter(
                (href): href is string => typeof href === "string" && APP_HREFS.includes(href)
            );
        }

        await getAdminDb().collection("users").doc(id).set(firestoreUpdate, { merge: true });

        const updatedDoc = await getAdminDb().collection("users").doc(id).get();
        const data = updatedDoc.data() as
            | { email?: string; role?: string; createdAt?: Timestamp; enabledApps?: string[] }
            | undefined;

        return NextResponse.json({
            user: {
                id,
                email: String(data?.email ?? ""),
                role: normalizeRole(data?.role),
                createdAt: data?.createdAt instanceof Timestamp ? data.createdAt.toDate().toISOString() : null,
                enabledApps: Array.isArray(data?.enabledApps) ? data.enabledApps : null,
            },
        });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to update user" },
            { status: 400 }
        );
    }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
    try {
        const role = await getUserRoleFromRequest(request);
        if (role !== "admin") {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const actorId = await getUserIdFromRequest(request);
        const { id } = await context.params;

        if (id === actorId) {
            throw new Error("You cannot delete your own account.");
        }

        await getAdminAuth().deleteUser(id);
        await getAdminDb().collection("users").doc(id).delete();

        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to delete user" },
            { status: 400 }
        );
    }
}
