import { defaultAppHrefsForRole, type AppUserRole } from "@/lib/app-permissions";

export type DashboardCardId = "today" | "sales" | "receivables" | "pending" | "shipments" | "topProducts" | "topBrands";

/** `hrefs`: the card shows when the user can open at least one of these apps (empty = everyone). */
export const DASHBOARD_CARDS: Array<{ id: DashboardCardId; title: string; hrefs: string[]; link?: string }> = [
    { id: "today", title: "Today", hrefs: [], link: "/orders/pending" },
    { id: "receivables", title: "Overdue receivables", hrefs: ["/payment-followup"], link: "/payment-followup" },
    { id: "sales", title: "Sales this month", hrefs: ["/sales-targets", "/salesperson-activity", "/customer-activity", "/margin-analytics"], link: "/salesperson-activity" },
    { id: "pending", title: "Pending orders", hrefs: ["/orders/pending"], link: "/orders/pending" },
    { id: "shipments", title: "Shipments", hrefs: ["/po-tracking"], link: "/po-tracking" },
    { id: "topProducts", title: "Most sold products", hrefs: ["/products-performance", "/sales-targets", "/salesperson-activity", "/margin-analytics"], link: "/products-performance" },
    { id: "topBrands", title: "Most sold brands", hrefs: ["/products-performance", "/sales-targets", "/salesperson-activity", "/margin-analytics"], link: "/products-performance" },
];

export function visibleDashboardCards(role: AppUserRole, enabledApps: string[] | null) {
    const apps = new Set(enabledApps ?? defaultAppHrefsForRole(role));
    return DASHBOARD_CARDS.filter((card) => card.hrefs.length === 0 || card.hrefs.some((href) => apps.has(href)));
}

export type DashboardCardData = {
    today: { pending: number; confirmed: number; invoices: number; prev?: { pending: number; confirmed: number; invoices: number } };
    sales: { mtd: number; prevSamePeriod: number; prevMonthTotal: number; invoices: number; month: string; daysInMonth: number; thisMonth: number[]; lastMonth: number[] };
    receivables: { overdue: number; overdueInvoices: number; open: number };
    pending: { count: number; total: number };
    shipments: { onTheWay: number; late: number; dueWeek: number; atPort: number; untracked: number; unitsWeek: number };
    topProducts: { rows: Array<{ name: string; quantity: number; amount: number }> };
    topBrands: { rows: Array<{ name: string; quantity: number; amount: number }> };
};
