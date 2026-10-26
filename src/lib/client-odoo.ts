import { getAuth } from "firebase/auth";
import { getSelectedCompanyIds } from "@/lib/company-filter";
import {
    BackorderDetails,
    BackorderStatus,
    OdooCustomerOption,
    OdooDashboardActivityType,
    OdooDashboardStats,
    OdooCustomerActivityReport,
    OdooCustomerReport,
    OdooPartnerLedger,
    OdooNearExpiryProduct,
    OdooProductOption,
    OdooSalesperson,
    OdooSalespersonActivityReport,
    OdooSalesTargetDetailsReport,
    OdooSalespersonMonthlyInvoices,
    OdooOrderLineInput,
    PaymentFollowupReport,
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

async function post<T>(path: string, body: Record<string, unknown>, method: "POST" | "PUT" | "GET" = "POST", signal?: AbortSignal) {
    const token = await getAuthToken();

    const selectedCompanyIds = getSelectedCompanyIds();
    const requestBody = selectedCompanyIds.length > 0
        ? { ...body, companyIds: selectedCompanyIds }
        : body;

    const response = await fetch(path, {
        method,
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        body: method === "GET" ? undefined : JSON.stringify(requestBody),
        signal,
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
        excludeDropshipping?: boolean;
        excludeInternalCompanies?: boolean;
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
            incomingQty: number;
            incomingOrders: Array<{ name: string; quantity: number; expectedDate: string }>;
            stockByLot: Array<{ lotName: string; quantity: number; warehouses: Array<{ name: string; quantity: number }> }>;
            excludedItems: Array<{ kind: "sale" | "purchase"; reasons: string[]; document: string; partner: string; quantity: number }>;
            excludedSoldQty: number;
            excludedIncomingQty: number;
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
    categoryIds?: number[];
    originIds?: number[];
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
            purchaseValue: number;
            totalStock: number;
            stockValue: number;
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
            purchaseValue: number;
            totalStock: number;
            stockValue: number;
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
            currency: string;
        }>;
        defaultCompanyId: number | null;
    }>("/api/odoo/companies", {});
}

export type SalesStockRow = {
    id: number;
    productId: number;
    productName: string;
    location: string;
    lotId: number | null;
    lotName: string;
    companyId: number | null;
    companyName: string;
    categoryName: string;
    brand: string;
    country: string;
    pattern: string;
    patternId: number | null;
    lotYear: string;
    copyName: string;
    sku: string;
    availableQty: number;
    incomingQty: number | null;
    forecastedQty: number | null;
    reservedQty: number;
    onHandQty: number;
    realCostLot: number | null;
    lotAverageCost: number | null;
    retailPrice: number | null;
    wholesalePrice: number | null;
    specialPrice: number | null;
};

export type SalesStockFilters = {
    categoryId?: number | null;
    brandId?: number | null;
    rimId?: number | null;
    originId?: number | null;
    patternId?: number | null;
    patternName?: string | null;
    lotName?: string | null;
};

export function getTirePatterns() {
    return post<{ patterns: Array<{ id: number; name: string; brandName: string }> }>("/api/odoo/tire-patterns", {});
}

export function getLotNames() {
    return post<{ lots: string[] }>("/api/odoo/lot-names", {});
}

export function searchSalesStock(input: { query: string; queries?: string[]; limit?: number; offset?: number; filters?: SalesStockFilters }, signal?: AbortSignal) {
    return post<{
        rows: SalesStockRow[];
        totalCount: number;
        unresolvedFields: string[];
        hasMore: boolean;
    }>("/api/odoo/sales-stock", input, "POST", signal);
}

export function getPatternImages(ids: number[]) {
    return post<{ images: Record<string, string> }>("/api/odoo/pattern-images", { ids });
}

export function createSalesQuotation(input: {
    customerId: number;
    lines: Array<{ productId: number; quantity: number; description?: string; companyId: number | null; priceUnit?: number }>;
}) {
    return post<{ quotations: Array<{ id: number; name: string; companyName: string }> }>(
        "/api/odoo/sales-quotation",
        input
    );
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

export function getPurchaseOrderTypes() {
    return post<{
        options: Array<{ value: string; label: string }>;
    }>("/api/odoo/purchase-order-types", {});
}

export function getSaleOrderTypes() {
    return post<{
        options: Array<{ value: string; label: string }>;
    }>("/api/odoo/sale-order-types", {});
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
    rimDiameterIds?: number[] | null;
    unifiedLotIds?: number[] | null;
    productId?: number | null;
    excludePurchaseTypeValues?: string[] | null;
    excludeSaleTypeValue?: string | null;
    excludeCustomerIds?: number[] | null;
    excludeDropshipPurchases?: boolean | null;
    startDate: string;
    endDate: string;
    dateBasis?: "order" | "transaction" | null;
    valuationBasis?: "average" | "odoo" | null;
}) {
    return post<{
        startDate: string;
        endDate: string;
        currencyCode: string;
        valuationBasis?: "average" | "odoo";
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
            avgOdooCostPerUnit: number;
            avgOperationCostPerUnit: number;
            avgUnlinkedAdjustmentPerUnit: number;
            avgFinalLandedCostPerUnit: number;
            avgTotalCostPerUnit: number;
            soldQty: number;
            avgSalesPrice: number;
            hasSalesData: boolean;
            avgMarginPerUnit: number;
            marginPercent: number;
            estimatedProfitLoss: number;
            currentStock: number;
            stockByLot: Array<{ lotName: string; quantity: number }>;
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
            avgUnlinkedAdjustmentPerUnit: number;
            avgFinalLandedCostPerUnit: number;
            avgTotalCostPerUnit: number;
            avgSalesPrice: number;
            avgMarginPercent: number;
            totalEstimatedProfitLoss: number;
        };
        unconvertedCurrencyCodes: string[];
    }>("/api/odoo/margin-analytics", input);
}

export type MarginBreakdownRow = {
    reference: string;
    date: string;
    partnerName: string;
    lots: string[];
    quantity: number;
    unitPrice: number;
    currencyCode: string;
    amount: number;
    note: string;
    /** Purchase Orders rows only: the landed cost matched to this specific
     * PO line, and the resulting per-unit price (unitPrice + landed cost). */
    landedCostAmount?: number;
    finalUnitPrice?: number;
};

export type MarginBreakdown = {
    productId: number;
    productName: string;
    currencyCode: string;
    startDate: string;
    endDate: string;
    dateBasis: "order" | "transaction";
    unifiedLotNames: string[];
    purchases: MarginBreakdownRow[];
    landedCosts: MarginBreakdownRow[];
    operationCosts: MarginBreakdownRow[];
    unlinkedAdjustments: MarginBreakdownRow[];
    sales: MarginBreakdownRow[];
    totals: {
        purchasedQty: number;
        purchaseValue: number;
        landedCostValue: number;
        operationCostValue: number;
        unlinkedAdjustmentValue: number;
        soldQty: number;
        salesValue: number;
    };
};

export function getMarginAnalyticsBreakdown(input: {
    productId: number;
    unifiedLotIds?: number[] | null;
    excludePurchaseTypeValues?: string[] | null;
    excludeSaleTypeValue?: string | null;
    excludeCustomerIds?: number[] | null;
    excludeDropshipPurchases?: boolean | null;
    startDate: string;
    endDate: string;
    dateBasis?: "order" | "transaction" | null;
}) {
    return post<MarginBreakdown>("/api/odoo/margin-analytics-breakdown", input);
}

export function getSalesTeams() {
    return post<{ teams: Array<{ id: number; name: string }> }>("/api/odoo/sales-teams", {});
}

export function getCustomerTags() {
    return post<{ tags: Array<{ id: number; name: string }> }>("/api/odoo/customer-tags", {});
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

export function searchProductCatalog(input?: { query?: string; limit?: number; offset?: number; evaluatePricelists?: boolean }) {
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
            pricelists: Array<{ pricelistName: string; currencyCode: string; price: number; lotName?: string }>;
        }>;
        totalCount: number;
        limit: number;
        offset: number;
        hasMore: boolean;
    }>("/api/odoo/product-catalog-search", input ?? {});
}

export function getMsrpRetailers() {
    return post<{ urls: string[] }>("/api/msrp/retailers", {}, "GET");
}

export function addMsrpRetailer(url: string) {
    return post<{ urls: string[] }>("/api/msrp/retailers", { add: url });
}

export function removeMsrpRetailer(url: string) {
    return post<{ urls: string[] }>("/api/msrp/retailers", { remove: url });
}

export type ProductRequestType = "new_product" | "missing_size" | "missing_pattern" | "more_quantity";

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

export function getPaymentFollowupBySalesperson(input: {
    salespersonId: number;
    asOfDate?: string;
    dateBasis?: "due" | "invoice";
    agingSystem?: "day" | "month";
}) {
    return post<PaymentFollowupReport>("/api/odoo/payment-followup-by-salesperson", input);
}

export function getPaymentFollowupByCustomer(input: {
    customerId: number;
    asOfDate?: string;
    dateBasis?: "due" | "invoice";
    agingSystem?: "day" | "month";
}) {
    return post<PaymentFollowupReport>("/api/odoo/payment-followup-by-customer", input);
}

export function getSalesTargetDetails(input: {
    salespersonId: number;
    year: number;
    month: number;
    brandId: number;
}) {
    return post<OdooSalesTargetDetailsReport>("/api/odoo/sales-target-details", input);
}

// ---- PO Tracking ----

export type PoTrackingContainer = {
    index: number;
    containerNo: string;
    sealNo: string;
    blNumber: string;
    quantity: number;
    label: string;
};

export type PoTrackingOrder = {
    id: number;
    name: string;
    vendorName: string;
    vendorRef: string;
    orderDate: string;
    expectedArrival: string;
    /** The PO's "Deliver To" (receiving operation type) in Odoo. */
    deliverTo: string;
    currencyCode: string;
    types: string[];
    fullyReceived: boolean;
    receiptDone: boolean;
    totalQty: number;
    brands: string[];
    amountTotal: number;
    companyName: string;
    containers: PoTrackingContainer[];
};

export type ShipmentEvent = {
    description: string;
    datetime: string;
    isActual: boolean;
    location: string;
    transportMode: string;
    voyage: string;
};

export type ShipmentTracking = {
    blNumber: string;
    carrierName: string;
    carrierCode: string;
    referenceType?: string;
    status: string;
    updatedAt: string;
    vessels: string[];
    origin: { name: string; departure: string; at?: [number, number] } | null;
    destination: { name: string; arrival: string; at?: [number, number] } | null;
    transshipments: Array<{ name: string; arrival: string; departure: string; at?: [number, number] }>;
    /** The final delivery place when it is beyond the port of discharge. */
    finalDestination?: { name: string; at?: [number, number] };
    containers: Array<{
        number: string;
        size: string;
        type: string;
        status: string;
        lastEvent: ShipmentEvent | null;
        events: ShipmentEvent[];
    }>;
    fetchedAt: string;
};

export function getPoTrackingOrders(input?: { includeReceived?: boolean; fresh?: boolean }) {
    return post<{ orders: PoTrackingOrder[]; importedTypeNames: string[] }>("/api/odoo/po-tracking", {
        includeReceived: Boolean(input?.includeReceived),
        fresh: Boolean(input?.fresh),
    });
}

/** Tyre brands per PO id — fetched only for the orders being shown (or exported). */
export function getPoBrands(orderIds: number[]) {
    return post<{ brands: Record<string, string[]> }>("/api/odoo/po-tracking/brands", { orderIds });
}

export type PoDetails = {
    id: number;
    name: string;
    state: string;
    vendorName: string;
    vendorRef: string;
    companyName: string;
    currencyCode: string;
    orderDate: string;
    expectedArrival: string;
    sourceDocument: string;
    notes: string;
    amountUntaxed: number;
    amountTax: number;
    amountTotal: number;
    lines: Array<{
        id: number;
        productName: string;
        description: string;
        quantity: number;
        received: number;
        uom: string;
        unitPrice: number;
        subtotal: number;
    }>;
};

export function getPoDetails(orderId: number) {
    return post<{ order: PoDetails }>("/api/odoo/po-tracking/details", { orderId });
}

export type PoBillStatus = { state: string; count: number; billNames: string[] };

/** Vendor-bill payment status per PO id — only for the arrived orders being shown. */
export function getPoBills(orderIds: number[]) {
    return post<{ bills: Record<string, PoBillStatus> }>("/api/odoo/po-tracking/bills", { orderIds });
}

export function geocodePorts(names: string[]) {
    return post<{ points: Record<string, [number, number] | null> }>("/api/po-tracking/geocode", { names });
}

export type PoTrackingExportRow = {
    bl: string;
    sealine: string;
    type: string;
    eta: string | null;
    etd: string | null;
    brand: string;
    customer: string;
    pol: string;
    pod: string;
    vol: number;
    qty: number;
    amount: number | null;
    factory: string;
};

/** Builds the Excel workbook (from the saved template) on the server and returns it as a file. */
export async function exportPoTrackingExcel(rows: PoTrackingExportRow[]): Promise<Blob> {
    const token = await getAuthToken();
    const response = await fetch("/api/po-tracking/export", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ rows }),
    });
    if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Failed to build the Excel file");
    }
    return response.blob();
}

export function getSeaRoutes(routes: Array<{ id: string; stops: Array<[number, number]> }>) {
    return post<{ paths: Record<string, Array<Array<[number, number]>>> }>("/api/po-tracking/sea-route", { routes });
}

export function trackShipmentByBl(blNumber: string, carrierCode?: string, password?: string) {
    return post<ShipmentTracking>("/api/po-tracking/track", { blNumber, carrierCode, password });
}

export function checkPoTrackingPassword(password?: string) {
    return post<{ protected: boolean; valid: boolean }>("/api/po-tracking/protection", { password });
}

export async function getPoTrackingPasswordStatus() {
    const token = await getAuthToken();
    const response = await fetch("/api/system-settings/po-tracking-password", { headers: { Authorization: `Bearer ${token}` } });
    const data = (await response.json()) as { isSet?: boolean; error?: string };
    if (!response.ok || data.error) throw new Error(data.error ?? "Failed to load");
    return Boolean(data.isSet);
}

export function savePoTrackingPassword(password: string) {
    return post<{ isSet: boolean }>("/api/system-settings/po-tracking-password", { password });
}

export type TrackingCarrier = { code: string; name: string };

export function getTrackingCarriers() {
    return post<{ carriers: TrackingCarrier[] }>("/api/po-tracking/carriers", {});
}

export function getSavedShipmentTracking() {
    return post<{ tracked: Record<string, ShipmentTracking>; carriers: Record<string, string>; telex?: Record<string, string> }>("/api/po-tracking/saved", {});
}

/** Sets (or clears, with null) the Telex Release date of a B/L. */
export function saveTelexRelease(blNumber: string, date: string | null) {
    return post<{ ok: boolean }>("/api/po-tracking/telex", { blNumber, date });
}

export type PoTrackingDiagnosis = {
    found: boolean;
    name: string;
    state: string;
    types: string[];
    isImportedType: boolean;
    receiptStatus: string;
    fullyReceivedByLines: boolean;
    sourceDocument: string;
    notesPreview: string;
    notesFieldNames: string[];
    parsed: Array<{ blNumber: string; containerNo: string; units: number; from: "Source Document" | "Notes" }>;
    reasons: string[];
};

export function diagnosePoTracking(poName: string) {
    return post<PoTrackingDiagnosis>("/api/odoo/po-tracking/diagnose", { poName });
}

export function getCustomerActivityReport(input: { customerId: number; startDate: string; endDate: string }) {
    return post<OdooCustomerActivityReport>("/api/odoo/customer-activity-report", input);
}

export function getPartnerLedger(input: { customerId: number; asOfDate: string; unreconciledOnly?: boolean }) {
    return post<OdooPartnerLedger>("/api/odoo/partner-ledger", input);
}

/** Recalculates one card from Odoo and saves it. Only used by the dashboard's Refresh button. */
export function refreshDashboardCard(card: string) {
    return post<{ data: unknown; fetchedAt: string }>("/api/odoo/dashboard-card", { card, refresh: true });
}

/** The figures saved by the last refresh — never queries Odoo. */
export function getSavedDashboard() {
    return post<{ cards: Record<string, { data: unknown; fetchedAt: string }> }>("/api/odoo/dashboard-card", { cachedOnly: true });
}

export type AgedStockRow = {
    productId: number;
    productName: string;
    brand: string;
    lotName: string;
    unitCost: number | null;
    warehouse: string;
    locations: string[];
    quantity: number;
    oldestDate: string;
    lastReceivedDate?: string;
    firstReceivedDate?: string;
    ageDays: number;
};

export type AgedStockResponse = {
    minAgeDays: number;
    totalUnits: number;
    agedUnits: number;
    unknownAgeUnits: number;
    buckets: Array<{ label: string; fromDays: number; units: number }>;
    warehouses: Array<{ name: string; totalUnits: number; agedUnits: number }>;
    rows: AgedStockRow[];
    truncated: boolean;
    scannedAt: string;
};

/** On-hand stock older than `minAgeDays`, dated from Odoo's own valuation layers (receipts still on hand). */
export function getAgedStock(input: { minAgeDays: number }) {
    return post<AgedStockResponse>("/api/odoo/aged-stock", input);
}

export type PricelistOption = { id: number; name: string; currency: string };

export type PriceListRow = {
    key: string;
    productId: number;
    searchName: string;
    sku: string;
    factoryCode: string;
    name: string;
    brand: string;
    origin: string;
    pattern: string;
    rim: string;
    category: string;
    lotName: string;
    lotYear: string;
    available: number;
    /** Only sent to purchaser / sales manager / admin. */
    cost?: number | null;
    prices: Record<string, number | null>;
};

export type PriceListResponse = {
    pricelists: PricelistOption[];
    rows: PriceListRow[];
    totalMatched: number;
    truncated: boolean;
    diagnostics: {
        ruleTypes: Array<{ computePrice: string; appliedOn: string; count: number }>;
        matchedRules: number;
        lotRules: number;
        skippedQuantityBreaks: number;
        skippedDates: number;
        rowsWithPrice: number;
    };
};

export function getPricelists(options?: { all?: boolean }) {
    return post<{ pricelists: PricelistOption[]; restricted?: boolean }>("/api/odoo/pricelists", { all: options?.all === true });
}

export type PriceListFilterOptions = {
    categories: Array<{ id: number; name: string }>;
    locations: Array<{ id: number; name: string }>;
    oe: { label: string; options: Array<{ id: number | string; name: string }> } | null;
    lots: string[];
};

export function getPriceListFilterOptions() {
    return post<PriceListFilterOptions>("/api/odoo/price-list-filters", {});
}

export function getPriceListRequest(input: {
    brandIds: number[];
    excludeBrandIds: number[];
    originIds: number[];
    excludeOriginIds: number[];
    categoryIds: number[];
    excludeCategoryIds: number[];
    oeValues: Array<number | string>;
    excludeOeValues: Array<number | string>;
    lotNames: string[];
    excludeLotNames: string[];
    locationIds?: number[];
    excludeLocationIds?: number[];
    searchNames: string[];
    excludeSearchNames: string[];
    pricelistIds: number[];
    inStockOnly: boolean;
    onlyPriced: boolean;
    onlyUnpriced?: boolean;
}) {
    return post<PriceListResponse>("/api/odoo/price-list-request", input);
}

export type PriceListFacets = {
    brands: Array<{ id: number; name: string; count: number }>;
    origins: Array<{ id: number; name: string; count: number }>;
    categories: Array<{ id: number; name: string; count: number }>;
    oe: Array<{ id: number | string; name: string; count: number }> | null;
    lots: Array<{ id: string; name: string; count: number }>;
};

/** What the include filters leave available to exclude, with how many products each option covers. */
export function getPriceListFacets(input: {
    brandIds: number[];
    originIds: number[];
    categoryIds: number[];
    oeValues: Array<number | string>;
    lotNames: string[];
    searchNames: string[];
}) {
    return post<PriceListFacets>("/api/odoo/price-list-facets", input);
}

export type MyDocumentRow = {
    id: number;
    name: string;
    customer: string;
    date: string;
    dueDate: string;
    state: string;
    paymentState: string;
    amountTotal: number;
    amountResidual: number | null;
    currencyCode: string;
    companyName: string;
    isCredit: boolean;
    stateCode: string;
};

export function getMyDocuments(input: { kind: "orders" | "quotations" | "invoices"; status?: "all" | "quotation" | "confirmed" | "cancelled"; search?: string; limit?: number; offset?: number }) {
    return post<{ rows: MyDocumentRow[]; totalCount: number }>("/api/odoo/my-documents", input);
}

export type MyOrderDetails = {
    id: number;
    name: string;
    state: string;
    stateCode: string;
    customer: string;
    date: string;
    validUntil: string;
    salesperson: string;
    team: string;
    customerRef: string;
    paymentTerms: string;
    pricelist: string;
    companyName: string;
    currencyCode: string;
    amountUntaxed: number;
    amountTax: number;
    amountTotal: number;
    note: string;
    lines: Array<{
        id: number;
        kind: "product" | "section" | "note";
        productName: string;
        description: string;
        quantity: number;
        delivered: number | null;
        invoiced: number | null;
        priceUnit: number;
        discount: number;
        subtotal: number;
        total: number;
    }>;
};

export function getMyOrderDetails(orderId: number) {
    return post<{ order: MyOrderDetails }>("/api/odoo/my-order", { orderId });
}
