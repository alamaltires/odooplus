const MAX_BODY_CHARS = 8_000_000;
const FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_ALLOWED = ["http://localhost:3000"];

async function getAllowed() {
    const { allowedOrigins } = await chrome.storage.local.get("allowedOrigins");
    return Array.isArray(allowedOrigins) ? allowedOrigins : DEFAULT_ALLOWED;
}

function isPrivateHost(hostname) {
    const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return true;
    if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) return true;
    const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (m) {
        const [a, b] = [Number(m[1]), Number(m[2])];
        return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
    }
    return false;
}

async function handle(message, sender) {
    const origin = sender.origin || (sender.url ? new URL(sender.url).origin : "");
    const allowed = (await getAllowed()).includes(origin);

    if (message.type === "ping") {
        return { ok: true, allowed, version: chrome.runtime.getManifest().version, origin };
    }
    if (!allowed) {
        return { ok: false, error: "This site is not allowed. Click the extension icon and press 'Allow this site'." };
    }
    if (message.type !== "fetch") {
        return { ok: false, error: "Unknown request" };
    }

    let url;
    try {
        url = new URL(message.url);
    } catch {
        return { ok: false, error: "Invalid URL" };
    }
    if ((url.protocol !== "http:" && url.protocol !== "https:") || isPrivateHost(url.hostname)) {
        return { ok: false, error: "URL not allowed" };
    }

    try {
        const response = await fetch(url.toString(), {
            method: "GET",
            credentials: "include",
            redirect: "follow",
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            headers: { Accept: String(message.accept || "text/html,application/json") },
        });
        const finalUrl = new URL(response.url || url.toString());
        if (isPrivateHost(finalUrl.hostname)) {
            return { ok: false, error: "URL not allowed" };
        }
        const text = (await response.text()).slice(0, MAX_BODY_CHARS);
        return { ok: true, status: response.status, finalUrl: finalUrl.toString(), text };
    } catch (error) {
        return { ok: false, error: error && error.name === "TimeoutError" ? "timed out" : "could not connect" };
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handle(message, sender).then(sendResponse, (error) => sendResponse({ ok: false, error: String(error) }));
    return true;
});
