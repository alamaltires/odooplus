import * as PathFinderModule from "geojson-path-finder";

type LatLng = [number, number];
type LonLat = [number, number];
type NetworkLine = { geometry: { type: string; coordinates: LonLat[] | LonLat[][] } };
type Network = { type: string; features: NetworkLine[] };

const key = ([lng, lat]: LonLat) => `${lng},${lat}`;
const point = (at: LonLat) => ({ type: "Feature" as const, properties: {}, geometry: { type: "Point" as const, coordinates: at } });

function distanceKm([lng1, lat1]: LonLat, [lng2, lat2]: LonLat) {
    const dLat = lat2 - lat1;
    const dLng = (lng2 - lng1) * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180);
    return Math.hypot(dLat, dLng) * 111.2;
}

/**
 * Sea routing over a shipping-lane network. Unlike snapping each port to its
 * *nearest lane* (which can be a lane that isn't connected to the rest of the
 * network, so no route exists), each port is snapped to the nearest point of
 * the main connected network, so every pair of ports gets a real sea route.
 */
export function createSeaRouter(network: Network) {
    const lines: LonLat[][] = network.features.flatMap((feature) =>
        feature.geometry.type === "LineString" ? [feature.geometry.coordinates as LonLat[]] : (feature.geometry.coordinates as LonLat[][])
    );

    // Union-find over lane vertices, to find the main connected network.
    const parent = new Map<string, string>();
    const find = (id: string): string => {
        let root = id;
        while (parent.get(root) !== root) root = parent.get(root) as string;
        let current = id;
        while (parent.get(current) !== root) {
            const next = parent.get(current) as string;
            parent.set(current, root);
            current = next;
        }
        return root;
    };
    const vertices = new Map<string, LonLat>();
    for (const line of lines) {
        for (const vertex of line) {
            const id = key(vertex);
            if (!parent.has(id)) {
                parent.set(id, id);
                vertices.set(id, vertex);
            }
        }
        for (let index = 1; index < line.length; index += 1) {
            parent.set(find(key(line[index])), find(key(line[index - 1])));
        }
    }
    const sizes = new Map<string, number>();
    for (const id of vertices.keys()) sizes.set(find(id), (sizes.get(find(id)) ?? 0) + 1);
    let mainRoot = "";
    let mainSize = 0;
    for (const [root, size] of sizes) {
        if (size > mainSize) {
            mainRoot = root;
            mainSize = size;
        }
    }
    const mainVertices = Array.from(vertices.entries())
        .filter(([id]) => find(id) === mainRoot)
        .map(([, vertex]) => vertex);

    // The package ships both ESM and CJS builds, which expose the class differently.
    const exported = PathFinderModule as unknown as { default?: unknown };
    const PathFinderClass = (typeof exported.default === "function" ? exported.default : (exported.default as { default: unknown }).default) as new (
        network: unknown
    ) => { findPath(a: unknown, b: unknown): { path: LonLat[] } | undefined };
    const finder = new PathFinderClass(network);

    const snap = (at: LonLat): LonLat => {
        let best = mainVertices[0];
        let bestDistance = Infinity;
        for (const vertex of mainVertices) {
            const distance = distanceKm(at, vertex);
            if (distance < bestDistance) {
                bestDistance = distance;
                best = vertex;
            }
        }
        return best;
    };

    return {
        /** Sea path from one port to another ([lat, lng] points); `routed` is false when only a straight line was possible. */
        leg(from: LatLng, to: LatLng): { path: LatLng[]; routed: boolean } {
            const origin = snap([from[1], from[0]]);
            const destination = snap([to[1], to[0]]);
            if (key(origin) === key(destination)) {
                return { path: [from, [origin[1], origin[0]], to], routed: true };
            }
            const result = finder.findPath(point(origin), point(destination)) as { path: LonLat[] } | undefined;
            if (!result || result.path.length < 2) {
                return { path: [from, to], routed: false };
            }
            return { path: [from, ...result.path.map(([lng, lat]): LatLng => [lat, lng]), to], routed: true };
        },
    };
}
