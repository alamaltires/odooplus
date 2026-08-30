import { NextResponse } from "next/server";

type Bucket = {
    count: number;
    resetAt: number;
};

type RateLimitOptions = {
    key: string;
    maxRequests: number;
    windowMs: number;
    actorId?: string;
};

type RateLimitResult = {
    headers: Headers;
    limitedResponse: NextResponse | null;
};

declare global {
    var __odooplusRateLimitStore: Map<string, Bucket> | undefined;
}

function getStore() {
    if (!globalThis.__odooplusRateLimitStore) {
        globalThis.__odooplusRateLimitStore = new Map<string, Bucket>();
    }

    return globalThis.__odooplusRateLimitStore;
}

function cleanupExpiredBuckets(store: Map<string, Bucket>, now: number) {
    if (store.size < 2000) {
        return;
    }

    for (const [bucketKey, bucket] of store.entries()) {
        if (bucket.resetAt <= now) {
            store.delete(bucketKey);
        }
    }
}

function getClientIp(request: Request) {
    const forwardedFor = request.headers.get("x-forwarded-for");
    if (forwardedFor) {
        const first = forwardedFor.split(",")[0]?.trim();
        if (first) {
            return first;
        }
    }

    return request.headers.get("x-real-ip")?.trim() || "unknown";
}

export function enforceRateLimit(request: Request, options: RateLimitOptions): RateLimitResult {
    const now = Date.now();
    const maxRequests = Math.max(1, Math.floor(options.maxRequests));
    const windowMs = Math.max(1000, Math.floor(options.windowMs));
    const ip = getClientIp(request);
    const actor = options.actorId ? `user:${options.actorId}` : "user:anonymous";
    const bucketKey = `${options.key}:${actor}:ip:${ip}`;
    const store = getStore();

    cleanupExpiredBuckets(store, now);

    let bucket = store.get(bucketKey);
    if (!bucket || bucket.resetAt <= now) {
        bucket = {
            count: 0,
            resetAt: now + windowMs,
        };
    }

    bucket.count += 1;
    store.set(bucketKey, bucket);

    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    const remaining = Math.max(0, maxRequests - bucket.count);

    const headers = new Headers({
        "X-RateLimit-Limit": String(maxRequests),
        "X-RateLimit-Remaining": String(remaining),
        "X-RateLimit-Reset": String(Math.ceil(bucket.resetAt / 1000)),
    });

    if (bucket.count > maxRequests) {
        headers.set("Retry-After", String(retryAfterSeconds));
        return {
            headers,
            limitedResponse: NextResponse.json(
                {
                    error: "Rate limit exceeded. Please retry shortly.",
                },
                {
                    status: 429,
                    headers,
                }
            ),
        };
    }

    return {
        headers,
        limitedResponse: null,
    };
}
