"use client";

import { useEffect } from "react";

// Mirrors next.config.ts's own getBasePath().
function getBasePath() {
    const configured = process.env.NEXT_PUBLIC_BASE_PATH?.trim();

    if (!configured || configured === "/") {
        return "";
    }

    return configured.startsWith("/")
        ? configured.replace(/\/$/, "")
        : `/${configured.replace(/\/$/, "")}`;
}

/**
 * Registers the no-op service worker (see public/sw.js) purely so the app
 * is recognized as installable — this is a progressive enhancement, so any
 * failure here is silently ignored rather than surfaced to the user.
 */
export function ServiceWorkerRegister() {
    useEffect(() => {
        if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
            return;
        }

        const basePath = getBasePath();
        navigator.serviceWorker.register(`${basePath}/sw.js`, { scope: `${basePath}/` }).catch(() => {
            // Installability is a progressive enhancement — nothing else
            // depends on the service worker being present.
        });
    }, []);

    return null;
}
