// Relays messages between the MSRP Finder page and the extension's background
// worker. It does nothing unless the page sends an "msrp-page" message, and the
// background worker refuses to fetch for any site that is not on the allow-list.
window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data || event.data.source !== "msrp-page") return;
    const { id, type, url, accept } = event.data;
    chrome.runtime.sendMessage({ type, url, accept }, (response) => {
        const error = chrome.runtime.lastError ? chrome.runtime.lastError.message : null;
        window.postMessage({ source: "msrp-ext", id, ...(response || { ok: false, error: error || "No response" }) }, window.location.origin);
    });
});
