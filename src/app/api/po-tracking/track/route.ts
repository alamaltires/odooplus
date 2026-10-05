import { NextResponse } from "next/server";
import { getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";
import { getAdminDb } from "@/lib/server/firebase-admin";

const QUBICTRON_OCEAN_URL = "https://api.qubictron.com/tracking/v1/ocean";

type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

type ShipmentEvent = {
    description: string;
    datetime: string;
    isActual: boolean;
    location: string;
    transportMode: string;
    voyage: string;
};

type ShipmentTracking = {
    blNumber: string;
    carrierName: string;
    carrierCode: string;
    status: string;
    updatedAt: string;
    vessels: string[];
    origin: { name: string; departure: string } | null;
    destination: { name: string; arrival: string } | null;
    transshipments: Array<{ name: string; arrival: string; departure: string }>;
    containers: Array<{
        number: string;
        size: string;
        type: string;
        status: string;
        lastEvent: ShipmentEvent | null;
        events: ShipmentEvent[];
    }>;
    /** When this server fetched it from Qubictron. */
    fetchedAt: string;
};

const str = (value: unknown) => (value === null || value === undefined ? "" : typeof value === "object" ? "" : String(value));

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

/** Text from a value that may be a plain string or a nested object like { code, name }. */
function pickText(value: unknown): string {
    if (value === null || value === undefined) return "";
    if (typeof value !== "object") return String(value);
    const record = value as Raw;
    for (const key of ["name", "label", "description", "code", "value"]) {
        if (typeof record[key] === "string" && record[key]) return record[key];
    }
    return "";
}

const DATE_KEYS = ["actual", "datetime", "date_time", "date", "estimated", "scheduled", "planned", "predicted", "value"];

/** An ISO date string from a value that may be a string or a nested object ({ datetime, is_actual, ... }). */
function pickDate(value: unknown): string {
    if (typeof value === "string") return value;
    if (!value || typeof value !== "object") return "";
    const record = value as Raw;
    for (const key of DATE_KEYS) {
        const found = pickDate(record[key]);
        if (found) return found;
    }
    for (const entry of Object.values(record)) {
        if (typeof entry === "string" && ISO_DATE.test(entry)) return entry;
    }
    return "";
}

/** Whether a date object says it is an actual (not estimated) time; plain strings are unknown, treated as actual. */
function pickIsActual(value: unknown): boolean {
    if (value && typeof value === "object") {
        const record = value as Raw;
        if (typeof record.is_actual === "boolean") return record.is_actual;
        if (typeof record.actual === "string" && record.actual) return true;
        if (typeof record.actual === "boolean") return record.actual;
        if (record.estimated || record.predicted) return false;
    }
    return true;
}

function normalize(blNumber: string, body: Raw): ShipmentTracking {
    const data: Raw = body.data ?? {};
    const shipment: Raw = data.shipment ?? {};
    const route: Raw = data.route ?? {};

    const locations = new Map<string, string>();
    for (const location of (data.locations ?? []) as Raw[]) {
        const label = [pickText(location.name), pickText(location.country)].filter(Boolean).join(", ");
        locations.set(str(location.id), label || pickText(location.unlocode));
    }
    const placeName = (ref: Raw | undefined | null) => (ref?.location_id !== undefined ? locations.get(str(ref.location_id)) ?? "" : "");

    const toEvent = (event: Raw): ShipmentEvent => ({
        description: pickText(event.description),
        datetime: pickDate(event.datetime),
        isActual: typeof event.is_actual === "boolean" ? event.is_actual : pickIsActual(event.datetime),
        location: locations.get(str(event.location_id)) ?? "",
        transportMode: pickText(event.transport_mode),
        voyage: str(event.voyage_number),
    });

    const containers = ((data.containers ?? []) as Raw[]).map((container) => {
        const events = ((container.events ?? []) as Raw[]).map(toEvent);
        const actual = events.filter((event) => event.isActual);
        // Latest actual milestone; fall back to the last listed event.
        const lastEvent = [...actual].sort((a, b) => a.datetime.localeCompare(b.datetime)).pop() ?? events[events.length - 1] ?? null;
        return {
            number: str(container.number),
            size: pickText(container.size),
            type: pickText(container.type),
            status: pickText(container.status),
            lastEvent,
            events: [...events].sort((a, b) => b.datetime.localeCompare(a.datetime)),
        };
    });

    const origin = route.first_port_of_loading;
    const destination = route.final_port_of_discharge;

    return {
        blNumber,
        carrierName: pickText(shipment.carrier?.name),
        carrierCode: str(shipment.carrier?.code),
        status: pickText(shipment.status),
        updatedAt: pickDate(shipment.updated_at),
        vessels: ((data.transports ?? []) as Raw[]).map((transport) => str(transport.name)).filter(Boolean),
        origin: origin ? { name: placeName(origin), departure: pickDate(origin.departure) } : null,
        destination: destination ? { name: placeName(destination), arrival: pickDate(destination.arrival) } : null,
        transshipments: ((route.transshipments ?? []) as Raw[]).map((stop) => ({
            name: placeName(stop),
            arrival: pickDate(stop.arrival),
            departure: pickDate(stop.departure),
        })),
        containers,
        fetchedAt: new Date().toISOString(),
    };
}

/**
 * One request per Bill of Lading — a B/L covers every container on it, so
 * the client never asks per container. Only ever called on demand.
 */
export async function POST(request: Request) {
    try {
        // Requires a signed-in user so the API quota can't be used by anyone else.
        await getOdooCredentialsFromRequest(request);

        const apiKey = process.env.QUBICTRON_API_KEY;
        if (!apiKey) {
            return NextResponse.json({ error: "QUBICTRON_API_KEY is not configured on the server." }, { status: 500 });
        }

        const { blNumber, carrierCode } = (await request.json()) as { blNumber?: string; carrierCode?: string };
        const bl = (blNumber ?? "").trim();
        if (!bl) {
            return NextResponse.json({ error: "A B/L number is required." }, { status: 400 });
        }

        const url = new URL(QUBICTRON_OCEAN_URL);
        url.searchParams.set("reference_number", bl);
        // No reference_type on purpose: the number in Odoo can be a B/L or an
        // MSC-style booking number, and Qubictron detects which (forcing "bl"
        // makes booking numbers fail with AUTO_CANT_DETECT_CARRIER).
        const carrier = (carrierCode ?? "").trim().toUpperCase();
        if (carrier) {
            url.searchParams.set("carrier_code", carrier);
        }

        const response = await fetch(url, { headers: { "x-api-key": apiKey }, cache: "no-store" });
        const body = (await response.json().catch(() => ({}))) as Raw;

        if (!response.ok || body.success === false) {
            if (str(body.status_code) === "AUTO_CANT_DETECT_CARRIER") {
                return NextResponse.json(
                    { error: `Qubictron can't tell which shipping line ${bl} belongs to. Choose the shipping line below and try again.` },
                    { status: 400 }
                );
            }
            const reason = response.status === 401 ? "Invalid Qubictron API key" : str(body.message || body.status_code) || `HTTP ${response.status}`;
            return NextResponse.json({ error: `Tracking failed for ${bl}: ${reason}` }, { status: response.status === 401 ? 502 : 400 });
        }

        const tracking = normalize(bl, body);

        // Saved so the page can show the last known status without asking
        // Qubictron again. A save failure must not hide a successful lookup.
        try {
            await getAdminDb().collection("po-tracking").doc(bl.replace(/[^A-Za-z0-9_-]/g, "_")).set(tracking);
            // The shipping line that worked is remembered so later updates need no choice.
            const usedCarrier = carrier || tracking.carrierCode;
            if (usedCarrier) {
                await getAdminDb()
                    .collection("po-tracking-carriers")
                    .doc(bl.replace(/[^A-Za-z0-9_-]/g, "_"))
                    .set({ blNumber: bl, carrierCode: usedCarrier });
            }
        } catch (saveError) {
            console.error("Failed to save PO tracking result", saveError);
        }

        return NextResponse.json(tracking);
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to track shipment" },
            { status: 400 }
        );
    }
}
