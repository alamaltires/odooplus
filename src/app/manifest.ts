import type { MetadataRoute } from "next";

// Mirrors next.config.ts's own getBasePath() — duplicated here (not
// imported) because this route needs it independently and the logic is a
// couple of lines.
function getBasePath() {
    const configured = process.env.NEXT_PUBLIC_BASE_PATH?.trim();

    if (!configured || configured === "/") {
        return "";
    }

    return configured.startsWith("/")
        ? configured.replace(/\/$/, "")
        : `/${configured.replace(/\/$/, "")}`;
}

export default function manifest(): MetadataRoute.Manifest {
    const basePath = getBasePath();

    return {
        name: "Odoo++ Sales Hub",
        short_name: "Odoo++",
        description:
            "A branded Odoo operations workspace for sales visibility, targets, orders, and customer activity.",
        start_url: `${basePath}/`,
        scope: `${basePath}/`,
        display: "standalone",
        background_color: "#fdf5f5",
        theme_color: "#e51a27",
        icons: [
            { src: `${basePath}/icons/icon-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
            { src: `${basePath}/icons/icon-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
            {
                src: `${basePath}/icons/icon-maskable-512.png`,
                sizes: "512x512",
                type: "image/png",
                purpose: "maskable",
            },
        ],
    };
}
