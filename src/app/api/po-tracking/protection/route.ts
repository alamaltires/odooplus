import { NextResponse } from "next/server";
import { getOdooCredentialsFromRequest, hasPoTrackingPassword, verifyPoTrackingPassword } from "@/lib/server/auth-helpers";

/** Tells the page whether updating is password protected, and whether a given password is right. */
export async function POST(request: Request) {
    try {
        await getOdooCredentialsFromRequest(request);
        const { password } = (await request.json()) as { password?: string };
        const protectedByPassword = await hasPoTrackingPassword();
        const valid = await verifyPoTrackingPassword(password);
        return NextResponse.json({ protected: protectedByPassword, valid });
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to check" }, { status: 400 });
    }
}
