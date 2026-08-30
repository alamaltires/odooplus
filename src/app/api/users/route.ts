import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/server/firebase-admin";
import { getUserIdFromRequest, getUserRoleFromRequest } from "@/lib/server/auth-helpers";

type Role = "admin" | "purchase" | "salesperson" | "store";

function normalizeRole(value: string | undefined): Role {
    if (value === "admin" || value === "purchase" || value === "salesperson" || value === "store") {
        return value;
    }

    return "purchase";
}

export async function GET(request: Request) {
    try {
        const role = await getUserRoleFromRequest(request);
        if (role !== "admin") {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const adminAuth = getAdminAuth();
        const adminDb = getAdminDb();
        const authUsers = await adminAuth.listUsers(1000);
        const userIds = authUsers.users.map((item) => item.uid);

        const profileSnapshots = userIds.length > 0
            ? await adminDb.getAll(...userIds.map((userId) => adminDb.collection("users").doc(userId)))
            : [];

        const profileById = new Map(
            profileSnapshots.map((snapshot) => [snapshot.id, snapshot.data() as {
                email?: string;
                role?: string;
                createdAt?: Timestamp;
            } | undefined])
        );

        const missingProfiles = authUsers.users.filter((item) => !profileById.has(item.uid) || !profileById.get(item.uid));

        if (missingProfiles.length > 0) {
            const batch = adminDb.batch();
            for (const userRecord of missingProfiles) {
                const createdAt = userRecord.metadata.creationTime
                    ? Timestamp.fromDate(new Date(userRecord.metadata.creationTime))
                    : Timestamp.now();

                batch.set(
                    adminDb.collection("users").doc(userRecord.uid),
                    {
                        email: userRecord.email ?? "",
                        role: "purchase",
                        createdAt,
                        updatedAt: Timestamp.now(),
                    },
                    { merge: true }
                );
            }

            await batch.commit();

            for (const userRecord of missingProfiles) {
                profileById.set(userRecord.uid, {
                    email: userRecord.email ?? "",
                    role: "purchase",
                    createdAt: userRecord.metadata.creationTime
                        ? Timestamp.fromDate(new Date(userRecord.metadata.creationTime))
                        : Timestamp.now(),
                });
            }
        }

        const users = authUsers.users
            .map((userRecord) => {
                const profile = profileById.get(userRecord.uid);
                const createdAt = profile?.createdAt instanceof Timestamp
                    ? profile.createdAt.toDate().toISOString()
                    : userRecord.metadata.creationTime || null;

                return {
                    id: userRecord.uid,
                    email: String(profile?.email ?? userRecord.email ?? ""),
                    role: normalizeRole(String(profile?.role ?? "purchase")),
                    createdAt,
                };
            })
            .sort((left, right) => left.email.localeCompare(right.email));

        return NextResponse.json({ users });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to load users" },
            { status: 400 }
        );
    }
}

export async function POST(request: Request) {
    try {
        const role = await getUserRoleFromRequest(request);
        if (role !== "admin") {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const actorId = await getUserIdFromRequest(request);
        const body = (await request.json()) as {
            email?: string;
            password?: string;
            role?: string;
        };

        const email = String(body.email ?? "").trim().toLowerCase();
        const password = String(body.password ?? "");
        const nextRole = normalizeRole(String(body.role ?? "purchase"));

        if (!email) {
            throw new Error("Email is required.");
        }

        if (password.length < 6) {
            throw new Error("Password must be at least 6 characters.");
        }

        const created = await getAdminAuth().createUser({ email, password });
        const now = Timestamp.now();

        await getAdminDb().collection("users").doc(created.uid).set(
            {
                email,
                role: nextRole,
                createdAt: now,
                updatedAt: now,
                createdBy: actorId,
            },
            { merge: true }
        );

        return NextResponse.json({
            user: {
                id: created.uid,
                email,
                role: nextRole,
                createdAt: now.toDate().toISOString(),
            },
        });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to create user" },
            { status: 400 }
        );
    }
}