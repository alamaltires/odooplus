export type OdooCredentials = {
    url: string;
    db: string;
    username: string;
    password: string;
};

export type OdooOrderLineInput = {
    productId: number;
    quantity: number;
    unitPrice: number;
};

export type PendingOrder = {
    id: number;
    name: string;
    partner_id?: [number, string];
    amount_total: number;
    state: string;
    date_order?: string;
};

export type SalesOrderMatch = {
    id: number;
    name: string;
    partner_id?: [number, string];
    amount_total?: number;
    state?: string;
    date_order?: string;
};

export type BackorderLine = {
    id: number;
    name: string;
    product_id?: [number, string];
    ordered_qty: number;
    price_unit: number;
    available_qty: number;
    shortage_qty: number;
};

export type BackorderDetails = {
    order: {
        id: number;
        name: string;
        customer_name: string;
        salesperson_name: string;
        order_date: string;
        payment_terms: string;
        state: string;
    };
    lines: BackorderLine[];
};

export type BackorderSource = "manual" | "odoo" | "webhook";

export type SavedBackorderProduct = {
    product_id?: number | null;
    product_variant_id?: number | null;
    category_id?: number | null;
    category_name?: string;
    name: string;
    ordered_quantity: number;
    available_quantity: number;
    shortage: number;
    price: number;
};

export type BackorderStatus = "pendding" | "partial" | "ready" | "procced";

export type SavedBackorder = {
    id: string;
    order_id: number;
    order_number: string;
    customer_name: string;
    order_date: string;
    salesperson_name: string;
    products: SavedBackorderProduct[];
    saved_at: string;
    source?: BackorderSource;
    status?: BackorderStatus;
};

export type PurchaseFromBackorderRow = {
    categoryId: number | null;
    categoryName: string;
    productId: number | null;
    productVariantId: number | null;
    productName: string;
    pendingQuantity: number;
    orderedQuantity: number;
    availableQuantity: number;
    backorderCount: number;
};

export type OdooSalesperson = {
    id: number;
    name: string;
    email: string;
};

export type OdooCustomerOption = {
    id: number;
    name: string;
    salespersonName: string;
};

export type OdooProductOption = {
    id: number;
    name: string;
};

export type OdooNearExpiryProduct = {
    lotId: number;
    lotName: string;
    productId: number;
    productName: string;
    expirationDate: string;
    quantity: number;
    daysUntilExpiry: number;
};

export type OdooCustomerSummary = {
    customerId: number;
    customerName: string;
    salespersonName: string;
    email: string;
    phone: string;
    street: string;
    city: string;
};

export type OdooServicedCustomer = OdooCustomerSummary & {
    orderCount: number;
    totalSales: number;
    lastSaleDate: string;
};

export type OdooVisitedCustomer = OdooCustomerSummary & {
    visitCount: number;
    lastVisitDate: string;
    crmReference: string;
};

export type OdooInactiveCustomer = OdooCustomerSummary & {
    lastVisitDate: string;
};

export type OdooSalespersonActivityReport = {
    salesperson: OdooSalesperson;
    startDate: string;
    endDate: string;
    servicedCustomers: OdooServicedCustomer[];
    visitedCustomers: OdooVisitedCustomer[];
    inactiveAssignedCustomers: OdooInactiveCustomer[];
};

export type OdooCustomerBrandSummary = {
    brandName: string;
    quantitySold: number;
    totalSales: number;
};

export type OdooCustomerReport = {
    customer: OdooCustomerSummary;
    totalSales: number;
    lastVisitDate: string;
    lastVisitReference: string;
    lastVisitSalespersonName: string;
    openQuotationCount: number;
    topBrands: OdooCustomerBrandSummary[];
};

export type OdooCurrencyTotal = {
    currencyId: number;
    currencyCode: string;
    total: number;
    invoiceCount: number;
    includedInTotal: boolean;
};

export type OdooSalespersonMonthlyInvoices = {
    salesperson: OdooSalesperson;
    year: number;
    month: number;
    totalInvoiced: number;
    creditNoteTotal: number;
    invoiceCount: number;
    primaryCurrencyCode: string;
    currencyTotals: OdooCurrencyTotal[];
    creditNoteCurrencyTotals: OdooCurrencyTotal[];
    brandTotals: Array<{
        brandId: number;
        totalInvoiced: number;
    }>;
    creditNoteBrandTotals: Array<{
        brandId: number;
        totalInvoiced: number;
    }>;
    debug?: {
        invoiceCountFetched: number;
        invoiceCountQualified: number;
        invoiceLineCountFetched: number;
        invoiceLineCountQualified: number;
        productCountFetched: number;
        productCountMappedToBrand: number;
        brandTotalCount: number;
    };
};

export type OdooSalespersonDailyActivity = {
    salespersonId: number;
    salespersonName: string;
    count: number;
};

export type OdooDashboardActivityType =
    | "crmVisits"
    | "quotations"
    | "salesOrders"
    | "invoices";

export type OdooDashboardStats = {
    pendingCount: number;
    confirmedCount: number;
    draftCount: number;
    selectedActivityType: OdooDashboardActivityType;
    salespersonDailyActivities: OdooSalespersonDailyActivity[];
};

export type SalesTargetBrand = {
    brandId: number | null;
    brandName: string;
    targetAmount: number;
    isGeneral: boolean;
};

export type SalesTargetRecord = {
    id: string;
    salespersonId: number;
    salespersonName: string;
    year: number;
    month: number;
    targets: SalesTargetBrand[];
    marketingEmailsSentAt?: Record<string, string>;
    targetAmount?: number;
    updatedAt: string;
};

export type OdooSalesTargetBrandProduct = {
    productId: number;
    productName: string;
    quantitySold: number;
    totalSales: number;
    orderCount: number;
};

export type OdooSalesTargetBrandCustomer = OdooCustomerSummary & {
    orderCount: number;
    totalSales: number;
    lastSaleDate: string;
};

export type OdooSalesTargetDetailsReport = {
    salesperson: OdooSalesperson;
    year: number;
    month: number;
    brandId: number;
    brandName: string;
    startDate: string;
    endDate: string;
    totalBrandSales: number;
    primaryCurrencyCode: string;
    primaryOrderCount: number;
    otherCurrencyTotals: Array<{ currencyCode: string; total: number; orderCount: number }>;
    products: OdooSalesTargetBrandProduct[];
    servedCustomers: OdooSalesTargetBrandCustomer[];
};
