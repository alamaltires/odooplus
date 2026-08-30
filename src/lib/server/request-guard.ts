import { NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/server/auth-helpers";
import { enforceRateLimit } from "@/lib/server/rate-limit";

type GuardOptions = {
    rateLimit: {
        key: string;
        maxRequests: number;
        windowMs: number;
    };
};

type GuardSuccess = {
    ok: true;
    userId: string;
    headers: Headers;
};

type GuardFailure = {
    ok: false;
    response: NextResponse;
};

export async function guardAuthenticatedRequest(
    request: Request,
    options: GuardOptions
): Promise<GuardSuccess | GuardFailure> {
    let userId: string;

    try {
        userId = await getUserIdFromRequest(request);
    } catch {
        return {
            ok: false,
            response: NextResponse.json(
                {
                    error: "Unauthorized",
                },
                { status: 401 }
            ),
        };
    }

    const rateLimit = enforceRateLimit(request, {
        key: options.rateLimit.key,
        maxRequests: options.rateLimit.maxRequests,
        windowMs: options.rateLimit.windowMs,
        actorId: userId,
    });

    if (rateLimit.limitedResponse) {
        return {
            ok: false,
            response: rateLimit.limitedResponse,
        };
    }

    return {
        ok: true,
        userId,
        headers: rateLimit.headers,
    };
}
