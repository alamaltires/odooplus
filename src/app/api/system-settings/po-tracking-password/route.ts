import { NextResponse } from "next/server";
import { getUserIdFromRequest, getUserRoleFromRequest, hasPoTrackingPassword, setPoTrackingPassword } from "@/lib/server/auth-helpers";

export async function GET(request: Request) {
    try {
        if ((await getUserRoleFromRequest(request)) !== "admin") {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        return NextResponse.json({ isSet: await hasPoTrackingPassword() });
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to load" }, { status: 400 });
    }
}

/** Sets the PO Tracking update password; an empty password removes the protection. */
export async function POST(request: Request) {
    try {
        if ((await getUserRoleFromRequest(request)) !== "admin") {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        const actorId = await getUserIdFromRequest(request);
        const body = (await request.json()) as { password?: string };
        const password = String(body.password ?? "");
        await setPoTrackingPassword(password, actorId);
        return NextResponse.json({ isSet: password.length > 0 });
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to save" }, { status: 400 });
    }
}
