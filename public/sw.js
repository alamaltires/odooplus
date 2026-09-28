// Exists only to satisfy PWA installability (a manifest + HTTPS + a fetch
// handler is what browsers check for). Deliberately does NOT pre-cache the
// app shell or API responses — this app is a live Odoo dashboard, so a
// stale cached response is actively wrong, not just inconvenient, and we've
// already been bitten once by stale cached JS chunks after a deploy. Every
// request just passes straight through to the network.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // No-op: let the browser handle the request normally. An empty handler
  // is enough for installability without taking on any caching behavior.
});
