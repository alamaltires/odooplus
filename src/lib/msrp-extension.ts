import type { FetchText } from "@/lib/market-price";

type ExtensionReply = {
    source: "msrp-ext";
    id: string;
    ok: boolean;
    error?: string;
    allowed?: boolean;
    version?: string;
    status?: number;
    finalUrl?: string;
    text?: string;
};

export type ExtensionState = "missing" | "not-allowed" | "ready";

function send(message: { type: "ping" | "fetch"; url?: string; accept?: string }, timeoutMs: number): Promise<ExtensionReply> {
    return new Promise((resolve, reject) => {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const timer = setTimeout(() => {
            window.removeEventListener("message", onMessage);
            reject(new Error("timed out"));
        }, timeoutMs);

        function onMessage(event: MessageEvent) {
            const data = event.data as ExtensionReply | undefined;
            if (event.source !== window || !data || data.source !== "msrp-ext" || data.id !== id) return;
            clearTimeout(timer);
            window.removeEventListener("message", onMessage);
            resolve(data);
        }

        window.addEventListener("message", onMessage);
        window.postMessage({ source: "msrp-page", id, ...message }, window.location.origin);
    });
}

export async function getExtensionState(): Promise<ExtensionState> {
    try {
        const reply = await send({ type: "ping" }, 1500);
        return reply.ok && reply.allowed ? "ready" : "not-allowed";
    } catch {
        return "missing";
    }
}

/** Fetches a URL through the user's own browser via the MSRP Finder Helper extension. */
export const fetchViaExtension: FetchText = async (url, accept) => {
    const reply = await send({ type: "fetch", url, accept }, 25_000);
    if (!reply.ok) {
        throw new Error(reply.error ?? "extension request failed");
    }
    const status = reply.status ?? 0;
    const text = reply.text ?? "";
    if (status >= 400) {
        const challenged = /just a moment|cf-chl|challenge-platform/i.test(text);
        throw new Error(
            challenged
                ? "Cloudflare check — open this shop once in a normal tab, then retry"
                : `HTTP ${status}`
        );
    }
    return { text, finalUrl: reply.finalUrl ?? url };
};
