import { getAuth } from "firebase/auth";
import { getSelectedCompanyIds } from "@/lib/company-filter";
import {
    BackorderDetails,
    BackorderStatus,
    OdooCustomerOption,
    OdooDashboardActivityType,
    OdooDashboardStats,
    OdooCustomerReport,
    OdooNearExpiryProduct,
    OdooProductOption,
    OdooSalesperson,
    OdooSalespersonActivityReport,
    OdooSalesTargetDetailsReport,
    OdooSalespersonMonthlyInvoices,
    OdooOrderLineInput,
    PurchaseFromBackorderRow,
    SalesOrderMatch,
} from "@/types/odoo";

async function getAuthToken(): Promise<string> {
    const auth = getAuth();
    const user = auth.currentUser;
    if (!user) {
        throw new Error("User not authenticated");
    }

    return user.getIdToken();
}

async function post<T>(path: string, body: Record<string, unknown>) {
    const token = await getAuthToken();

    const selectedCompanyIds = getSelectedCompanyIds();
    const requestBody = selectedCompanyIds.length > 0
        ? { ...body, companyIds: selectedCompanyIds }
        : body;

    const response = await fetch(path, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(requestBody),
    });

    const data = (await response.json()) as T & { error?: string };
    if (!response.ok || data.error) {
        throw new Error(data.error ?? "Request failed");
    }

    return data;
}

const dashboardStatsInFlight = new Map<string, Promise<OdooDashboardStats>>();

export function getDashboardStats(
    activityType: OdooDashboardActivityType = "crmVisits",
    includeSummaryCounts = true
) {
    const requestKey = `${activityType}:${includeSummaryCounts ? "with-summary" : "activity-only"}`;
    const existingRequest = dashboardStatsInFlight.get(requestKey);
    if (existingRequest) {
        return existingRequest;
    }

    const request = post<OdooDashboardStats>(
        "/api/odoo/dashboard-stats",
        {
            activityType,
            includeSummaryCounts,
        }
    ).finally(() => {
        dashboardStatsInFlight.delete(requestKey);
    });

    dashboardStatsInFlight.set(requestKey, request);
    return request;
}

export function getPendingOrders() {
    return post<{ orders: Array<Record<string, unknown>> }>("/api/odoo/pending-orders", {});
}

export function searchSalesOrder(salesOrderNumber: string) {
    return post<{ order: SalesOrderMatch | null }>("/api/odoo/search-order", {
        salesOrderNumber,
    });
}

export function getOrderDetails(orderId: number) {
    return post<BackorderDetails>(
        "/api/odoo/order",
        {
            orderId,
        }
    );
}

export function addProductToOrder(
    orderId: number,
    line: OdooOrderLineInput
) {
    return post<{ lineId: number }>("/api/odoo/add-line", {
        orderId,
        line,
    });
}

export async function getPurchaseFromBackorderReport() {
    const token = await getAuthToken();
    const response = await fetch("/api/backorders/purchase-from-backorder", {
        method: "GET",
        headers: {
            Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
    });

    const data = (await response.json()) as {
        rows?: PurchaseFromBackorderRow[];
        error?: string;
    };

    if (!response.ok || data.error) {
        throw new Error(data.error ?? "Failed to load purchase-from-backorder report.");
    }

    return {
        rows: data.rows ?? [],
    };
}

export function getProductCategories() {
    return post<{
        categories: Array<{
            id: number;
            name: string;
            model: "product.public.category" | "product.category";
            parentPath?: string;
        }>;
    }>("/api/odoo/product-categories", {});
}

export function getProductBrands() {
    return post<{
        brands: Array<{
            id: number;
            name: string;
        }>;
    }>("/api/odoo/product-brands", {});
}

export function getPurchaseOrderReport(
    input: {
        categoryId?: number | null;
        categoryModel?: "product.public.category" | "product.category";
        brandId?: number | null;
        startDate: string;
        endDate: string;
        stockDurationMonths: number;
    }
) {
    return post<{
        monthsInRange: number;
        rows: Array<{
            productId: number;
            productName: string;
            soldInPeriod: number;
            currentStock: number;
            averageMonthlySales: number;
            suggestedRestock: number;
            pendingFromBackorders: number;
        }>;
    }>("/api/odoo/purchase-order-report", input);
}

export function searchPurchaseOrders(input: { query: string; limit?: number; offset?: number }) {
    return post<{
        purchaseOrders: Array<{
            id: number;
            name: string;
            vendorName: string;
            dateOrder: string;
        }>;
        totalCount: number;
        limit: number;
        offset: number;
        hasMore: boolean;
    }>("/api/odoo/purchase-orders", input);
}

export function getProductsPerformanceReport(input: {
    purchaseOrderId?: number | null;
    productId?: number | null;
    brandId?: number | null;
    categoryId?: number | null;
    startDate: string;
    endDate: string;
    dateBasis?: "order" | "transaction" | null;
}) {
    return post<{
        startDate: string;
        endDate: string;
        currencyCode: string;
        matchedProductCount: number;
        rows: Array<{
            productId: number;
            productName: string;
            brandName: string;
            categoryName: string;
            lots: string[];
            soldQty: number;
            salesValue: number;
            averageSellingPrice: number;
            purchasedQty: number;
            averagePurchasePrice: number;
            totalStock: number;
            stockByWarehouse: Array<{
                warehouseId: number;
                warehouseName: string;
                quantity: number;
            }>;
        }>;
        totals: {
            soldQty: number;
            salesValue: number;
            purchasedQty: number;
            totalStock: number;
        };
        unconvertedCurrencyCodes: string[];
        purchaseOrderDetails: {
            name: string;
            vendorName: string;
            vendorReference: string;
            confirmationDate: string;
            expectedArrival: string;
            arrival: string;
            deliverTo: string;
        } | null;
    }>("/api/odoo/products-performance", input);
}

export async function getSystemOdooSettings() {
    const token = await getAuthToken();
    const response = await fetch("/api/system-settings", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
    });

    const data = (await response.json()) as { settings: { url: string; db: string } | null; error?: string };
    if (!response.ok || data.error) {
        throw new Error(data.error ?? "Failed to load system settings");
    }

    return data;
}

export function saveSystemOdooSettings(input: { url: string; db: string }) {
    return post<{ settings: { url: string; db: string } }>("/api/system-settings", input);
}

export function getCompanies() {
    return post<{
        companies: Array<{
            id: number;
            name: string;
        }>;
    }>("/api/odoo/companies", {});
}

export function getProductOrigins() {
    return post<{
        origins: Array<{
            id: number;
            name: string;
        }>;
    }>("/api/odoo/product-origins", {});
}

export function getRimDiameters() {
    return post<{
        rimDiameters: Array<{
            id: number;
            name: string;
        }>;
    }>("/api/odoo/rim-diameters", {});
}

export function searchUnifiedLots(input: { query: string; limit?: number; offset?: number }) {
    return post<{
        unifiedLots: Array<{
            id: number;
            name: string;
        }>;
        totalCount: number;
        limit: number;
        offset: number;
        hasMore: boolean;
    }>("/api/odoo/unified-lots", input);
}

export function getMarginAnalyticsReport(input: {
    categoryId?: number | null;
    brandId?: number | null;
    originId?: number | null;
    rimDiameterId?: number | null;
    unifiedLotId?: number | null;
    productId?: number | null;
    startDate: string;
    endDate: string;
    dateBasis?: "order" | "transaction" | null;
}) {
    return post<{
        startDate: string;
        endDate: string;
        currencyCode: string;
        matchedProductCount: number;
        rows: Array<{
            productId: number;
            productName: string;
            brandName: string;
            categoryName: string;
            originName: string;
            rimDiameterName: string;
            purchasedQty: number;
            avgPurchasePrice: number;
            avgLandedCostPerUnit: number;
            avgOperationCostPerUnit: number;
            avgTotalCostPerUnit: number;
            soldQty: number;
            avgSalesPrice: number;
            hasSalesData: boolean;
            avgMarginPerUnit: number;
            marginPercent: number;
            estimatedProfitLoss: number;
            currentStock: number;
            flags: Array<"never-sold" | "sold-without-purchase" | "no-landed-cost" | "negative-margin" | "has-cost-correction">;
            originalCurrencies: string[];
        }>;
        highlights: {
            productsWithPurchases: number;
            productsWithSales: number;
            productsWithoutSales: number;
            productsWithoutLandedCost: number;
            totalPurchasedQty: number;
            totalSoldQty: number;
            totalCurrentStock: number;
            avgPurchasePrice: number;
            avgLandedCostPerUnit: number;
            avgOperationCostPerUnit: number;
            avgTotalCostPerUnit: number;
            avgSalesPrice: number;
            avgMarginPercent: number;
            totalEstimatedProfitLoss: number;
        };
        unconvertedCurrencyCodes: string[];
    }>("/api/odoo/margin-analytics", input);
}

export function getSalespeople() {
    return post<{ salespeople: OdooSalesperson[] }>("/api/odoo/salespeople", {});
}

export function getCustomers() {
    return post<{ customers: OdooCustomerOption[] }>("/api/odoo/customers", {});
}

export function getProducts(input?: { query?: string; limit?: number; offset?: number }) {
    return post<{
        products: OdooProductOption[];
        totalCount: number;
        limit: number;
        offset: number;
        hasMore: boolean;
    }>("/api/odoo/products", input ?? {});
}

export function searchProductCatalog(input?: { query?: string; limit?: number; offset?: number }) {
    return post<{
        products: Array<{
            id: number;
            name: string;
            sku: string;
            brandName: string;
            categoryName: string;
            originName: string;
            rimDiameterName: string;
            currentStock: number;
            stockByLot: Array<{ lotName: string; companyName: string; quantity: number }>;
            pricelists: Array<{ pricelistName: string; currencyCode: string; price: number }>;
        }>;
        totalCount: number;
        limit: number;
        offset: number;
        hasMore: boolean;
    }>("/api/odoo/product-catalog-search", input ?? {});
}

export type ProductRequestType = "new_product" | "missing_size" | "missing_pattern";

export type ProductRequest = {
    id: string;
    requestType: ProductRequestType;
    brand: string;
    size: string;
    pattern: string;
    notes: string;
    searchQuery: string;
    referenceProductId: number | null;
    referenceProductName: string;
    seen: boolean;
    seenAt: string | null;
    seenByEmail: string;
    requestedByUserId: string;
    requestedByEmail: string;
    requestedByName: string;
    createdAt: string;
};

export function createProductRequest(input: {
    requestType: ProductRequestType;
    brand: string;
    size: string;
    pattern: string;
    notes: string;
    searchQuery: string;
    referenceProductId?: number | null;
    referenceProductName?: string;
}) {
    return post<{ request: ProductRequest }>("/api/product-requests", input);
}

export async function listProductRequests() {
    const token = await getAuthToken();
    const response = await fetch("/api/product-requests", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
    });

    const data = (await response.json()) as { requests: ProductRequest[]; error?: string };
    if (!response.ok || data.error) {
        throw new Error(data.error ?? "Failed to load product requests");
    }

    return data;
}

async function authorizedFetch(path: string, init: RequestInit) {
    const token = await getAuthToken();
    const response = await fetch(path, {
        ...init,
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            ...(init.headers ?? {}),
        },
    });

    const data = (await response.json()) as { error?: string } & Record<string, unknown>;
    if (!response.ok || data.error) {
        throw new Error(data.error ?? "Request failed");
    }

    return data;
}

export async function setProductRequestSeen(id: string, seen: boolean) {
    const data = await authorizedFetch(`/api/product-requests/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ seen }),
    });
    return data as { request: ProductRequest };
}

export async function deleteProductRequest(id: string) {
    await authorizedFetch(`/api/product-requests/${id}`, { method: "DELETE" });
}

export function getNearExpiryProducts(input: { thresholdDays: number }) {
    return post<{ products: OdooNearExpiryProduct[]; thresholdDays: number; scannedAt: string }>(
        "/api/odoo/near-expiry-products",
        input
    );
}

export function getSalespersonActivityReport(input: {
    salespersonId: number;
    startDate: string;
    endDate: string;
}) {
    return post<OdooSalespersonActivityReport>("/api/odoo/salesperson-activity-report", input);
}

export function getCustomerReport(customerId: number) {
    return post<OdooCustomerReport>("/api/odoo/customer-report", { customerId });
}

export function getSalespersonMonthlyInvoices(input: {
    salespersonId: number;
    year: number;
    month: number;
    includeCreditNotes?: boolean;
}) {
    return post<OdooSalespersonMonthlyInvoices>("/api/odoo/salesperson-monthly-invoices", input);
}

export function sendSalesTargetEmail(input: {
    toEmail: string;
    salespersonName: string;
    monthLabel: string;
    year: number;
    totalInvoiced: number;
    totalTargetAmount: number;
    rows: Array<{
        brandName: string;
        targetAmount: number;
        achieved: number;
        progress: number;
        remaining: number;
    }>;
}) {
    return post<{ success: boolean }>("/api/odoo/sales-target-email", input);
}

export function sendSalesTargetBrandMarketingEmail(input: {
    salespersonName: string;
    monthLabel: string;
    year: number;
    brandName: string;
    targetAmount: number;
    achieved: number;
    remaining: number;
}) {
    return post<{ success: boolean }>("/api/odoo/sales-target-category-email", input);
}

export function sendPendingOrderEmail(input: {
    orderId: number;
    orderNumber: string;
    customerName: string;
    salespersonName: string;
    previousStatus: BackorderStatus;
    currentStatus: BackorderStatus;
    products: Array<{
        name: string;
        orderedQuantity: number;
        availableQuantity: number;
        shortage: number;
    }>;
}) {
    return post<{ success: boolean }>("/api/odoo/pending-order-email", input);
}

export function getSalesTargetDetails(input: {
    salespersonId: number;
    year: number;
    month: number;
    brandId: number;
}) {
    return post<OdooSalesTargetDetailsReport>("/api/odoo/sales-target-details", input);
}
