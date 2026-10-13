type LatLng = [number, number];
type LonLat = [number, number];
type NetworkLine = { geometry: { type: string; coordinates: LonLat[] | LonLat[][] } };
type Network = { type: string; features: NetworkLine[] };

const key = ([lng, lat]: LonLat) => `${lng},${lat}`;

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

    // Lane graph: consecutive vertices of a lane are joined, weighted by their distance.
    const edges = new Map<string, Array<{ to: string; km: number }>>();
    const link = (from: string, to: string, km: number) => {
        const list = edges.get(from);
        if (list) list.push({ to, km });
        else edges.set(from, [{ to, km }]);
    };
    for (const line of lines) {
        for (let index = 1; index < line.length; index += 1) {
            const km = distanceKm(line[index - 1], line[index]);
            link(key(line[index - 1]), key(line[index]), km);
            link(key(line[index]), key(line[index - 1]), km);
        }
    }

    /** Dijkstra's shortest path between two lane vertices (a binary heap keeps it fast). */
    const shortestPath = (startId: string, endId: string): LonLat[] | null => {
        const best = new Map<string, number>([[startId, 0]]);
        const previous = new Map<string, string>();
        const heap: Array<[number, string]> = [[0, startId]];
        const push = (item: [number, string]) => {
            heap.push(item);
            let index = heap.length - 1;
            while (index > 0) {
                const parentIndex = (index - 1) >> 1;
                if (heap[parentIndex][0] <= heap[index][0]) break;
                [heap[parentIndex], heap[index]] = [heap[index], heap[parentIndex]];
                index = parentIndex;
            }
        };
        const pop = (): [number, string] => {
            const top = heap[0];
            const last = heap.pop() as [number, string];
            if (heap.length > 0) {
                heap[0] = last;
                let index = 0;
                for (;;) {
                    const left = index * 2 + 1;
                    const right = left + 1;
                    let smallest = index;
                    if (left < heap.length && heap[left][0] < heap[smallest][0]) smallest = left;
                    if (right < heap.length && heap[right][0] < heap[smallest][0]) smallest = right;
                    if (smallest === index) break;
                    [heap[smallest], heap[index]] = [heap[index], heap[smallest]];
                    index = smallest;
                }
            }
            return top;
        };

        while (heap.length > 0) {
            const [cost, id] = pop();
            if (id === endId) {
                const path: LonLat[] = [];
                for (let at: string | undefined = endId; at !== undefined; at = previous.get(at)) {
                    path.push(vertices.get(at) as LonLat);
                }
                return path.reverse();
            }
            if (cost > (best.get(id) ?? Infinity)) continue;
            for (const edge of edges.get(id) ?? []) {
                const next = cost + edge.km;
                if (next < (best.get(edge.to) ?? Infinity)) {
                    best.set(edge.to, next);
                    previous.set(edge.to, id);
                    push([next, edge.to]);
                }
            }
        }
        return null;
    };

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
            const result = shortestPath(key(origin), key(destination));
            if (!result || result.length < 2) {
                return { path: [from, to], routed: false };
            }
            return { path: [from, ...result.map(([lng, lat]): LatLng => [lat, lng]), to], routed: true };
        },
    };
}
