import { NextResponse } from "next/server";
import { getUserIdFromRequest, getUserRoleFromRequest } from "@/lib/server/auth-helpers";
import { ACTIVITY_CATEGORIES, ACTIVITY_RETENTION_DAYS, cleanupOldActivity, queryActivity, recordActivity, type ActivityCategory } from "@/lib/server/activity-log";

// Events only the browser sees (sign-in/out, opening an app, downloading an export, saves made straight to
// Firestore). Entries always carry the signed-in user's own identity; the rest of the log is written by server routes.
const CLIENT_CATEGORIES: ActivityCategory[] = ["account", "navigation", "export", "write", "settings"];

export async function POST(request: Request) {
    try {
        const userId = await getUserIdFromRequest(request);
        const body = (await request.json()) as { action?: unknown; category?: unknown; target?: unknown; detail?: unknown };
        const category = CLIENT_CATEGORIES.find((item) => item === body.category);
        const action = typeof body.action === "string" ? body.action.trim() : "";
        if (!category || !action) throw new Error("Invalid activity.");
        await recordActivity(userId, request, {
            action,
            category,
            target: typeof body.target === "string" ? body.target : undefined,
            detail: typeof body.detail === "string" ? body.detail : undefined,
        });
        return NextResponse.json({ ok: true });
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to log the activity" }, { status: 400 });
    }
}

/** Admin only: the activity log, newest first. */
export async function GET(request: Request) {
    try {
        if ((await getUserRoleFromRequest(request)) !== "admin") {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        const params = new URL(request.url).searchParams;
        const category = params.get("category") ?? "";
        const result = await queryActivity({
            limit: Math.min(200, Math.max(1, Number(params.get("limit")) || 100)),
            before: params.get("before") || undefined,
            from: params.get("from") || undefined,
            to: params.get("to") || undefined,
            userId: params.get("userId") || undefined,
            category: ACTIVITY_CATEGORIES.some((item) => item === category) ? category : undefined,
            search: params.get("search") || undefined,
        });
        // Opening the log also clears entries past the retention.
        const removed = params.get("before") ? 0 : await cleanupOldActivity(true);
        return NextResponse.json({ ...result, retentionDays: ACTIVITY_RETENTION_DAYS, removed });
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to load the activity log" }, { status: 400 });
    }
}
