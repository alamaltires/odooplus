export type LatLng = [number, number];

type PortEntry = { keys: string[]; at: LatLng };

// Approximate port coordinates, matched against whatever the carrier prints
// for a location ("Shanghai, China", "CNSHA", "JEBEL ALI"…). Not exhaustive —
// an unknown port simply isn't drawn.
const PORTS: PortEntry[] = [
    // China / HK / Taiwan
    { keys: ["shanghai", "cnsha", "yangshan"], at: [31.23, 121.47] },
    { keys: ["ningbo", "cnngb"], at: [29.87, 121.55] },
    { keys: ["qingdao", "cntao"], at: [36.07, 120.32] },
    { keys: ["tianjin", "xingang", "cntsn"], at: [39.0, 117.75] },
    { keys: ["dalian", "cndlc"], at: [38.92, 121.64] },
    { keys: ["xiamen", "cnxmn"], at: [24.48, 118.08] },
    { keys: ["shenzhen", "yantian", "shekou", "chiwan", "cnszx", "cnytn"], at: [22.55, 114.1] },
    { keys: ["guangzhou", "nansha", "huangpu", "cngzg", "cnnsa"], at: [22.75, 113.6] },
    { keys: ["lianyungang"], at: [34.75, 119.45] },
    { keys: ["fuzhou", "cnfoc"], at: [26.05, 119.45] },
    { keys: ["zhongshan", "jiangmen", "zhuhai"], at: [22.5, 113.5] },
    { keys: ["hong kong", "hkhkg"], at: [22.3, 114.17] },
    { keys: ["kaohsiung", "twkhh"], at: [22.6, 120.28] },
    { keys: ["keelung", "taipei", "taichung"], at: [25.15, 121.75] },
    // Korea / Japan
    { keys: ["busan", "pusan", "krpus"], at: [35.1, 129.04] },
    { keys: ["incheon", "krinc"], at: [37.45, 126.6] },
    { keys: ["yokohama", "tokyo", "jpyok", "jptyo"], at: [35.45, 139.65] },
    { keys: ["kobe", "osaka", "jpuky", "jposa"], at: [34.68, 135.2] },
    { keys: ["nagoya"], at: [35.08, 136.88] },
    // South-East Asia
    { keys: ["laem chabang", "thlch"], at: [13.08, 100.88] },
    { keys: ["bangkok", "thbkk"], at: [13.7, 100.57] },
    { keys: ["haiphong", "hai phong", "vnhph"], at: [20.85, 106.7] },
    { keys: ["ho chi minh", "cat lai", "saigon", "vnsgn", "vncla"], at: [10.77, 106.78] },
    { keys: ["da nang", "danang"], at: [16.1, 108.22] },
    { keys: ["port klang", "port kelang", "mypkg", "westport", "northport"], at: [3.0, 101.4] },
    { keys: ["tanjung pelepas", "mytpp", "pasir gudang"], at: [1.36, 103.55] },
    { keys: ["penang", "mypen"], at: [5.42, 100.35] },
    { keys: ["singapore", "sgsin"], at: [1.26, 103.84] },
    { keys: ["jakarta", "tanjung priok", "idjkt"], at: [-6.1, 106.88] },
    { keys: ["surabaya", "idsub"], at: [-7.2, 112.73] },
    { keys: ["belawan", "medan"], at: [3.78, 98.7] },
    { keys: ["manila", "phmnl"], at: [14.6, 120.97] },
    // South Asia
    { keys: ["nhava sheva", "jawaharlal", "jnpt", "innsa"], at: [18.95, 72.95] },
    { keys: ["mumbai", "inbom"], at: [18.95, 72.84] },
    { keys: ["mundra", "inmun"], at: [22.74, 69.7] },
    { keys: ["kandla", "tuna"], at: [22.99, 70.22] },
    { keys: ["chennai", "kattupalli", "inmaa"], at: [13.1, 80.3] },
    { keys: ["kolkata", "calcutta"], at: [22.55, 88.3] },
    { keys: ["cochin", "kochi", "vallarpadam"], at: [9.97, 76.27] },
    { keys: ["colombo", "lkcmb"], at: [6.95, 79.85] },
    { keys: ["karachi", "pkkhi", "qasim"], at: [24.83, 66.98] },
    { keys: ["chittagong", "chattogram", "bdcgp"], at: [22.3, 91.8] },
    // Gulf / Middle East
    { keys: ["jebel ali", "aejea"], at: [25.0, 55.06] },
    { keys: ["khalifa port", "khalifa", "aeaua"], at: [24.8, 54.65] },
    { keys: ["mina rashid", "port rashid", "dubai", "aedxb"], at: [25.27, 55.28] },
    { keys: ["abu dhabi"], at: [24.5, 54.37] },
    { keys: ["sharjah", "khalid", "aesha"], at: [25.36, 55.38] },
    { keys: ["fujairah", "aefjr"], at: [25.15, 56.35] },
    { keys: ["khor fakkan"], at: [25.35, 56.37] },
    { keys: ["sohar", "omsoh"], at: [24.5, 56.62] },
    { keys: ["salalah", "omsLL", "omsll"], at: [16.95, 54.0] },
    { keys: ["muscat", "sultan qaboos"], at: [23.63, 58.57] },
    { keys: ["dammam", "sadmm"], at: [26.5, 50.2] },
    { keys: ["jubail"], at: [27.0, 49.65] },
    { keys: ["jeddah", "sajed"], at: [21.48, 39.17] },
    { keys: ["hamad port", "doha", "qahmd"], at: [25.0, 51.6] },
    { keys: ["bahrain", "khalifa bin salman"], at: [26.2, 50.6] },
    { keys: ["kuwait", "shuwaikh", "shuaiba"], at: [29.35, 48.0] },
    { keys: ["bandar abbas", "irbnd"], at: [27.1, 56.07] },
    { keys: ["aqaba"], at: [29.52, 35.0] },
    // Red Sea / East Med / Oceania
    { keys: ["djibouti", "djjib"], at: [11.6, 43.15] },
    { keys: ["latakia", "lattakia", "syria", "sylta"], at: [35.52, 35.78] },
    { keys: ["tripoli, lebanon", "tripoli, lb", "lbkyt"], at: [34.45, 35.82] },
    { keys: ["tripoli, libya", "lytip"], at: [32.9, 13.18] },
    { keys: ["beirut", "lbbey"], at: [33.9, 35.5] },
    { keys: ["brisbane", "aubne"], at: [-27.38, 153.17] },
    { keys: ["sydney", "ausyd"], at: [-33.97, 151.2] },
    { keys: ["melbourne", "aumel"], at: [-37.83, 144.92] },
    // Egypt / Med / Europe
    { keys: ["port said", "egpsd"], at: [31.26, 32.3] },
    { keys: ["damietta"], at: [31.47, 31.77] },
    { keys: ["alexandria", "egalx"], at: [31.2, 29.88] },
    { keys: ["iskenderun", "iskandarun", "alexandretta", "triskn"], at: [36.59, 36.17] },
    { keys: ["mersin", "trmer"], at: [36.8, 34.64] },
    { keys: ["izmir", "aliaga", "trizm"], at: [38.4, 27.1] },
    { keys: ["gemlik"], at: [40.43, 29.15] },
    { keys: ["derince", "kocaeli", "gebze", "yarimca"], at: [40.75, 29.83] },
    { keys: ["ambarli", "istanbul", "tripa"], at: [41.0, 28.7] },
    { keys: ["piraeus", "grpir"], at: [37.94, 23.63] },
    { keys: ["gioia tauro"], at: [38.43, 15.9] },
    { keys: ["genoa", "genova", "la spezia", "itgoa", "itspz"], at: [44.4, 8.93] },
    { keys: ["barcelona", "esbcn"], at: [41.35, 2.17] },
    { keys: ["valencia", "esvlc"], at: [39.45, -0.32] },
    { keys: ["algeciras", "esalg"], at: [36.13, -5.43] },
    { keys: ["rotterdam", "nlrtm"], at: [51.95, 4.1] },
    { keys: ["antwerp", "beanr"], at: [51.27, 4.4] },
    { keys: ["hamburg", "bremerhaven", "deham", "debrv"], at: [53.54, 9.97] },
    { keys: ["le havre", "frlehv"], at: [49.48, 0.1] },
    { keys: ["felixstowe", "southampton", "london gateway", "gbfxt"], at: [51.96, 1.35] },
    { keys: ["constanta"], at: [44.17, 28.65] },
    // Africa / Americas
    { keys: ["mombasa", "kemba"], at: [-4.05, 39.67] },
    { keys: ["dar es salaam"], at: [-6.82, 39.29] },
    { keys: ["durban", "zadur"], at: [-29.87, 31.03] },
    { keys: ["new york", "newark", "usnyc"], at: [40.67, -74.04] },
    { keys: ["savannah"], at: [32.08, -81.09] },
    { keys: ["houston"], at: [29.73, -95.27] },
    { keys: ["los angeles", "long beach"], at: [33.74, -118.27] },
    { keys: ["santos", "brsst"], at: [-23.98, -46.3] },
];

// When a port isn't in the list above, fall back to a coastal point in its
// country (the carrier prints "Port, Country") so the shipment is still drawn.
const COUNTRIES: PortEntry[] = [
    { keys: ["china"], at: [31.23, 121.47] },
    { keys: ["hong kong"], at: [22.3, 114.17] },
    { keys: ["taiwan"], at: [22.6, 120.28] },
    { keys: ["south korea", "korea"], at: [35.1, 129.04] },
    { keys: ["japan"], at: [35.45, 139.65] },
    { keys: ["thailand"], at: [13.08, 100.88] },
    { keys: ["vietnam", "viet nam"], at: [10.77, 106.78] },
    { keys: ["malaysia"], at: [3.0, 101.4] },
    { keys: ["singapore"], at: [1.26, 103.84] },
    { keys: ["indonesia"], at: [-6.1, 106.88] },
    { keys: ["philippines"], at: [14.6, 120.97] },
    { keys: ["india"], at: [18.95, 72.95] },
    { keys: ["sri lanka"], at: [6.95, 79.85] },
    { keys: ["pakistan"], at: [24.83, 66.98] },
    { keys: ["bangladesh"], at: [22.3, 91.8] },
    { keys: ["united arab emirates", "uae"], at: [25.0, 55.06] },
    { keys: ["oman"], at: [24.5, 56.62] },
    { keys: ["saudi"], at: [26.5, 50.2] },
    { keys: ["qatar"], at: [25.0, 51.6] },
    { keys: ["kuwait"], at: [29.35, 48.0] },
    { keys: ["bahrain"], at: [26.2, 50.6] },
    { keys: ["iran"], at: [27.1, 56.07] },
    { keys: ["jordan"], at: [29.52, 35.0] },
    { keys: ["djibouti"], at: [11.6, 43.15] },
    { keys: ["syria"], at: [35.52, 35.78] },
    { keys: ["lebanon"], at: [33.9, 35.5] },
    { keys: ["libya"], at: [32.9, 13.18] },
    { keys: ["australia"], at: [-27.38, 153.17] },
    { keys: ["egypt"], at: [31.26, 32.3] },
    { keys: ["turkey", "türkiye", "turkiye"], at: [41.0, 28.7] },
    { keys: ["greece"], at: [37.94, 23.63] },
    { keys: ["italy"], at: [44.4, 8.93] },
    { keys: ["spain"], at: [39.45, -0.32] },
    { keys: ["france"], at: [49.48, 0.1] },
    { keys: ["netherlands"], at: [51.95, 4.1] },
    { keys: ["belgium"], at: [51.27, 4.4] },
    { keys: ["germany"], at: [53.54, 9.97] },
    { keys: ["united kingdom", "great britain"], at: [51.96, 1.35] },
    { keys: ["poland"], at: [54.4, 18.67] },
    { keys: ["romania"], at: [44.17, 28.65] },
    { keys: ["kenya"], at: [-4.05, 39.67] },
    { keys: ["tanzania"], at: [-6.82, 39.29] },
    { keys: ["south africa"], at: [-29.87, 31.03] },
    { keys: ["united states", "usa"], at: [40.67, -74.04] },
    { keys: ["brazil"], at: [-23.98, -46.3] },
];

function matchEntry(entries: PortEntry[], text: string): LatLng | null {
    for (const entry of entries) {
        if (entry.keys.some((key) => text.includes(key.toLowerCase()))) {
            return entry.at;
        }
    }
    return null;
}

export function lookupPort(name: string | null | undefined): LatLng | null {
    const text = (name ?? "").toLowerCase();
    if (!text.trim()) return null;
    return matchEntry(PORTS, text) ?? matchEntry(COUNTRIES, text);
}

// Rough sea lanes so the drawn route bends round land instead of cutting
// across it. Only used for voyages that end in the Gulf.
const MALACCA: LatLng[] = [[1.2, 104.2], [5.5, 96.5], [5.6, 80.4]];
const ARABIAN_SEA_TO_HORMUZ: LatLng[] = [[15.5, 66.0], [24.5, 60.0], [26.4, 56.6]];
const SUEZ_TO_ARABIAN_SEA: LatLng[] = [[29.9, 32.55], [27.5, 34.2], [20.0, 38.8], [12.6, 43.4], [12.2, 50.0], [15.5, 62.0], [24.5, 60.0], [26.4, 56.6]];

function inGulf([lat, lng]: LatLng) {
    return lat > 22 && lat < 31 && lng > 47 && lng < 59;
}

function lanesToGulf(from: LatLng): LatLng[] {
    const [lat, lng] = from;
    if (inGulf(from)) return [];
    // Australia: north through the Torres Strait and the Indonesian islands, then west across the Indian Ocean.
    if (lat < -5 && lng > 110) {
        return [[-10.6, 142.2], [-9.8, 128.0], [-10.5, 115.0], [-10.0, 100.0], [0.0, 85.0], [5.6, 80.4], ...ARABIAN_SEA_TO_HORMUZ];
    }
    // East Asia / South-East Asia: through the Strait of Malacca and round Sri Lanka.
    if (lng > 95) return [...(lat > 10 ? [[16.0, 112.0] as LatLng] : []), ...MALACCA, ...ARABIAN_SEA_TO_HORMUZ];
    // Horn of Africa / Gulf of Aden: out through the Gulf of Aden, then across the Arabian Sea.
    if (lng > 40 && lng < 52 && lat > 8 && lat < 16) return [[12.2, 50.0], ...ARABIAN_SEA_TO_HORMUZ];
    // Indian sub-continent, East Africa: straight across the Arabian Sea.
    if (lng > 60 || (lng > 30 && lat < 12 && lat > -35)) return [...ARABIAN_SEA_TO_HORMUZ];
    // Europe, Mediterranean, Americas: via Suez and the Red Sea.
    if (lng < 36) {
        return [
            ...(lng < -5 ? [[36.0, -5.6] as LatLng] : []),
            ...(lat > 30 && lng < 15 ? [[37.0, 11.5] as LatLng] : []),
            ...(lat > 30 ? [[31.3, 32.3] as LatLng] : []),
            ...SUEZ_TO_ARABIAN_SEA,
        ];
    }
    return [];
}

export type RouteInput = { origin: string; via: string[]; destination: string };

/** The drawn route plus the known port stops along it (for markers). */
export function buildRoute(input: RouteInput): { path: LatLng[]; stops: Array<{ name: string; at: LatLng }> } | null {
    const origin = lookupPort(input.origin);
    const destination = lookupPort(input.destination);
    if (!origin || !destination) return null;

    const stops: Array<{ name: string; at: LatLng }> = [{ name: input.origin, at: origin }];
    const path: LatLng[] = [origin];

    for (const name of input.via) {
        const at = lookupPort(name);
        if (at) {
            stops.push({ name, at });
            path.push(at);
        }
    }
    const last = path[path.length - 1];
    if (inGulf(destination)) {
        path.push(...lanesToGulf(last));
    }
    path.push(destination);
    stops.push({ name: input.destination, at: destination });
    return { path, stops };
}

function segmentLength(a: LatLng, b: LatLng) {
    const dLat = b[0] - a[0];
    const dLng = (b[1] - a[1]) * Math.cos((((a[0] + b[0]) / 2) * Math.PI) / 180);
    return Math.hypot(dLat, dLng);
}

/** The point `fraction` (0–1) of the way along the path, and the path up to it. */
export function pointAlong(path: LatLng[], fraction: number): { at: LatLng; travelled: LatLng[] } {
    const clamped = Math.min(1, Math.max(0, fraction));
    const lengths = path.slice(1).map((point, index) => segmentLength(path[index], point));
    const total = lengths.reduce((sum, value) => sum + value, 0);
    if (total === 0 || clamped === 0) return { at: path[0], travelled: [path[0]] };

    let remaining = clamped * total;
    const travelled: LatLng[] = [path[0]];
    for (let index = 0; index < lengths.length; index += 1) {
        if (remaining <= lengths[index] || index === lengths.length - 1) {
            const t = lengths[index] === 0 ? 0 : Math.min(1, remaining / lengths[index]);
            const at: LatLng = [
                path[index][0] + (path[index + 1][0] - path[index][0]) * t,
                path[index][1] + (path[index + 1][1] - path[index][1]) * t,
            ];
            travelled.push(at);
            return { at, travelled };
        }
        remaining -= lengths[index];
        travelled.push(path[index + 1]);
    }
    return { at: path[path.length - 1], travelled };
}
