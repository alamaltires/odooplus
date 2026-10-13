"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import { pointAlong, type LatLng } from "@/lib/shipment-route";

export type MapShipment = {
    blNumber: string;
    title: string;
    vendor: string;
    carrier: string;
    vessel: string;
    origin: string;
    destination: string;
    stage: "waiting" | "departed" | "arrived" | "delivered";
    etaText: string;
    stops: Array<{ name: string; at: LatLng }>;
    /** Sea route, one path per leg between consecutive stops. */
    legs: LatLng[][];
    /** Estimated position now, and the part of the route already sailed. */
    at: LatLng;
    travelled: LatLng[];
    /** Short note on how the position was estimated. */
    positionNote: string;
};

const STAGE_COLOR: Record<MapShipment["stage"], string> = {
    waiting: "#64748b",
    departed: "#0284c7",
    arrived: "#059669",
    delivered: "#059669",
};

const CSS = `
@keyframes shipmap-dash { to { stroke-dashoffset: -28; } }
@keyframes shipmap-pulse { 0% { transform: scale(0.6); opacity: 0.7; } 100% { transform: scale(2.4); opacity: 0; } }
.shipmap-route-ahead { animation: shipmap-dash 1.4s linear infinite; }
.shipmap-ship { position: relative; width: 28px; height: 28px; }
.shipmap-ship .ring { position: absolute; inset: 0; border-radius: 9999px; animation: shipmap-pulse 2s ease-out infinite; }
.shipmap-ship .dot { position: absolute; inset: 4px; border-radius: 9999px; border: 2px solid #fff; box-shadow: 0 2px 6px rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; }
.shipmap-ship .dot svg { width: 12px; height: 12px; fill: #fff; }
@media (prefers-reduced-motion: reduce) { .shipmap-route-ahead, .shipmap-ship .ring { animation: none; } }
`;

const SHIP_SVG =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17l1.6 3.2c.2.5.7.8 1.2.8h12.4c.5 0 1-.3 1.2-.8L21 17H3zm2-2h14l-1.5-5H13V6h-2v4H6.5L5 15zM11 3h2v2h-2V3z"/></svg>';

function escapeHtml(value: string) {
    return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

export function ShipmentMap({
    shipments,
    onOpen,
    focus,
}: {
    shipments: MapShipment[];
    onOpen: (blNumber: string) => void;
    /** Changing `n` flies to that shipment and opens its popup. */
    focus?: { blNumber: string; n: number } | null;
}) {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<{ flyTo: (at: LatLng, zoom: number) => void } | null>(null);
    const markersRef = useRef<Map<string, { getLatLng: () => { lat: number; lng: number }; openPopup: () => void }>>(new Map());
    const onOpenRef = useRef(onOpen);
    const shipmentsRef = useRef(shipments);
    useEffect(() => {
        onOpenRef.current = onOpen;
        shipmentsRef.current = shipments;
    }, [onOpen, shipments]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        let cancelled = false;
        let cleanup: (() => void) | undefined;

        void import("leaflet").then((leafletModule) => {
            if (cancelled || !containerRef.current) return;
            const L = leafletModule.default ?? leafletModule;

            const map = L.map(containerRef.current, { worldCopyJump: true, zoomControl: true, minZoom: 2 }).setView([22, 65], 3);
            L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
                maxZoom: 8,
                attribution: "&copy; OpenStreetMap contributors",
            }).addTo(map);

            mapRef.current = { flyTo: (at, zoom) => map.flyTo(at, zoom, { duration: 1 }) };
            markersRef.current = new Map();
            const frames: number[] = [];
            const bounds: LatLng[] = [];
            const drawnPorts = new Set<string>();
            const markerFinal = new Map<string, LatLng>();

            const handleOpen = ((event: CustomEvent<string>) => onOpenRef.current(event.detail)) as EventListener;
            window.addEventListener("shipmap-open", handleOpen);
            const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

            for (const shipment of shipments) {
                const color = STAGE_COLOR[shipment.stage];
                const route = shipment.legs.flatMap((leg) => leg);
                bounds.push(...route);

                // Planned sea route: animated dashes show the direction of travel.
                for (const leg of shipment.legs) {
                    L.polyline(leg, { color, weight: 2, opacity: 0.55, dashArray: "6 8", className: "shipmap-route-ahead" }).addTo(map);
                }

                for (const stop of shipment.stops) {
                    const key = `${stop.at[0]},${stop.at[1]}`;
                    if (drawnPorts.has(key)) continue;
                    drawnPorts.add(key);
                    L.circleMarker(stop.at, { radius: 4, color: "#334155", weight: 1, fillColor: "#fff", fillOpacity: 1 })
                        .bindTooltip(stop.name, { direction: "top" })
                        .addTo(map);
                }

                const travelledLine = L.polyline([shipment.travelled[0]], { color, weight: 3, opacity: 0.95 }).addTo(map);
                const icon = L.divIcon({
                    className: "",
                    iconSize: [28, 28],
                    iconAnchor: [14, 14],
                    html: `<div class="shipmap-ship"><span class="ring" style="background:${color}"></span><span class="dot" style="background:${color}">${SHIP_SVG}</span></div>`,
                });
                const marker = L.marker(shipment.travelled[0], { icon }).addTo(map);
                markerFinal.set(shipment.blNumber, shipment.at);
                markersRef.current.set(shipment.blNumber, marker);
                const vesselUrl = shipment.vessel
                    ? `https://www.vesselfinder.com/vessels?name=${encodeURIComponent(shipment.vessel)}`
                    : "";
                marker.bindPopup(
                    `<div style="min-width:190px"><strong>${escapeHtml(shipment.title)}</strong><br/>` +
                        `<span style="color:#64748b">${escapeHtml(shipment.vendor)}</span><br/>` +
                        `B/L ${escapeHtml(shipment.blNumber)}${shipment.carrier ? ` · ${escapeHtml(shipment.carrier)}` : ""}<br/>` +
                        `${shipment.vessel ? `Vessel ${escapeHtml(shipment.vessel)}<br/>` : ""}` +
                        `${escapeHtml(shipment.origin)} → ${escapeHtml(shipment.destination)}<br/>` +
                        `${escapeHtml(shipment.etaText)}<br/>` +
                        `<span style="color:#64748b">${escapeHtml(shipment.positionNote)}</span><br/>` +
                        `<a href="#" onclick="window.dispatchEvent(new CustomEvent('shipmap-open',{detail:${JSON.stringify(shipment.blNumber)}}));return false;">Show in list</a>` +
                        (vesselUrl ? ` · <a href="${vesselUrl}" target="_blank" rel="noopener noreferrer">VesselFinder</a>` : "") +
                        `</div>`
                );

                // Intro: the ship sails from the origin to where it is now.
                const duration = 1600;
                const startedAt = performance.now();
                const step = (now: number) => {
                    const t = Math.min(1, (now - startedAt) / duration);
                    const eased = 1 - Math.pow(1 - t, 3);
                    const { at, travelled } = pointAlong(shipment.travelled, eased);
                    marker.setLatLng(at);
                    travelledLine.setLatLngs(travelled);
                    if (t < 1) frames.push(window.requestAnimationFrame(step));
                };
                if (reduceMotion) {
                    marker.setLatLng(shipment.at);
                    travelledLine.setLatLngs(shipment.travelled);
                } else {
                    frames.push(window.requestAnimationFrame(step));
                }
            }

            if (bounds.length > 0) {
                map.fitBounds(L.latLngBounds(bounds), { padding: [40, 40], maxZoom: 5 });
            }
            window.setTimeout(() => applyFocusRef.current(), 250);

            cleanup = () => {
                mapRef.current = null;
                markersRef.current = new Map();
                window.removeEventListener("shipmap-open", handleOpen);
                frames.forEach((frame) => window.cancelAnimationFrame(frame));
                map.remove();
            };
        });

        return () => {
            cancelled = true;
            cleanup?.();
        };
    }, [shipments]);

    // Fly to the focused shipment once it is on the map (it may only appear after
    // the map is rebuilt, e.g. after "Only this shipment"), once per request.
    const handledFocusRef = useRef(0);
    const applyFocusRef = useRef<() => void>(() => undefined);
    const focusRef = useRef(focus);
    const applyFocus = useRef(() => {
        const request = focusRef.current;
        if (!request || request.n === handledFocusRef.current) return;
        const marker = markersRef.current.get(request.blNumber);
        if (!marker || !mapRef.current) return;
        handledFocusRef.current = request.n;
        const target = shipmentsRef.current.find((item) => item.blNumber === request.blNumber)?.at ?? [marker.getLatLng().lat, marker.getLatLng().lng];
        mapRef.current.flyTo(target as LatLng, 5);
        window.setTimeout(() => marker.openPopup(), 1100);
    });
    useEffect(() => {
        applyFocusRef.current = applyFocus.current;
        focusRef.current = focus;
        applyFocus.current();
    }, [focus]);

    return (
        <>
            <style>{CSS}</style>
            <div ref={containerRef} className="h-[34rem] w-full overflow-hidden rounded-2xl border border-(--line)" role="region" aria-label="Shipments map" />
        </>
    );
}
