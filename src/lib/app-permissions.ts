export type AppUserRole = "admin" | "purchase" | "salesperson" | "sales_manager" | "store" | "user";

/**
 * Every sidebar destination the app can grant access to. Shared between the
 * sidebar (`app-shell.tsx`, which attaches icons on top of this) and the
 * per-user permissions modal in Settings, so both stay in sync automatically
 * when a route is added or removed here.
 */
export const APP_DEFINITIONS: Array<{ href: string; label: string }> = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/orders/pending", label: "Pending Orders" },
    { href: "/product-scanner", label: "Product Scanner" },
    { href: "/product-requests", label: "Product Requests" },
    { href: "/purchase-order", label: "Purchase Order" },
    { href: "/products-performance", label: "Products Performance" },
    { href: "/margin-analytics", label: "Margin Analytics" },
    { href: "/salesperson-activity", label: "Salesperson Activity" },
    { href: "/sales-targets", label: "Sales Targets" },
    { href: "/settings", label: "Settings" },
];

export const APP_HREFS = APP_DEFINITIONS.map((app) => app.href);

/**
 * The apps a role sees when no per-user override (`enabledApps` on the
 * Firestore user profile) is set. Also used as the starting point for the
 * permissions modal the first time an admin opens it for a user.
 */
export function defaultAppHrefsForRole(role: AppUserRole): string[] {
    switch (role) {
        case "purchase":
            return [
                "/orders/pending",
                "/purchase-order",
                "/products-performance",
                "/settings",
                "/product-scanner",
                "/product-requests",
            ];
        case "salesperson":
            return ["/sales-targets", "/settings", "/product-requests"];
        case "sales_manager":
            return ["/sales-targets", "/salesperson-activity", "/settings", "/product-requests"];
        case "store":
            return ["/orders/pending", "/product-scanner", "/settings", "/product-requests"];
        case "user":
            return ["/product-requests", "/settings"];
        case "admin":
        default:
            return [...APP_HREFS];
    }
}
