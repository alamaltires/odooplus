export type OdooCredentials = {
    url: string;
    db: string;
    username: string;
    password: string;
};

/**
 * What each individual user stores under `users/{uid}/integrations/odoo`.
 * The URL + Database are a system-wide setting an admin controls instead
 * (see `system/odoo` / `/api/system-settings`) — the two are combined
 * server-side into `OdooCredentials` at request time.
 */
export type OdooUserCredentials = {
    username: string;
    password: string;
};

export type OdooSystemSettings = {
    url: string;
    db: string;
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
    customerMonthlyTarget: number;
};

export type OdooVisitedCustomer = OdooCustomerSummary & {
    visitCount: number;
    lastVisitDate: string;
    crmReference: string;
};

export type OdooInactiveCustomer = OdooCustomerSummary & {
    lastSaleDate: string;
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

export type OdooCustomerSalesProduct = {
    productName: string;
    quantitySold: number;
    totalSales: number;
};

export type OdooCustomerSalesCategory = {
    categoryName: string;
    quantitySold: number;
    totalSales: number;
    products: OdooCustomerSalesProduct[];
};

/** A brand with the categories sold under it, each with its products. */
export type OdooCustomerSalesBrand = {
    brandName: string;
    quantitySold: number;
    totalSales: number;
    categories: OdooCustomerSalesCategory[];
};

export type OdooCustomerReport = {
    customer: OdooCustomerSummary;
    totalSales: number;
    lastVisitDate: string;
    lastVisitReference: string;
    lastVisitSalespersonName: string;
    openQuotationCount: number;
    topBrands: OdooCustomerBrandSummary[];
    topCategories: OdooCustomerBrandSummary[];
    brandTree: OdooCustomerSalesBrand[];
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
        costOfGoodsSold: number;
        grossProfit: number;
    }>;
    creditNoteBrandTotals: Array<{
        brandId: number;
        totalInvoiced: number;
        costOfGoodsSold: number;
        grossProfit: number;
    }>;
    brandCategoryTotals: Array<{
        brandId: number;
        categoryId: number;
        categoryName: string;
        totalInvoiced: number;
        costOfGoodsSold: number;
        grossProfit: number;
    }>;
    creditNoteBrandCategoryTotals: Array<{
        brandId: number;
        categoryId: number;
        categoryName: string;
        totalInvoiced: number;
        costOfGoodsSold: number;
        grossProfit: number;
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
    categoryId: number | null;
    categoryName: string;
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

export type PaymentFollowupAgingBucket = "notDue" | "d1_30" | "d31_60" | "d61_90" | "d91_120" | "older";

export type PaymentFollowupAgingTotals = {
    notDue: number;
    d1_30: number;
    d31_60: number;
    d61_90: number;
    d91_120: number;
    older: number;
};

export type PaymentFollowupInvoiceRow = {
    invoiceId: number;
    invoiceNumber: string;
    // `miscEntry` is a plain journal entry (not an invoice/bill/payment —
    // e.g. a carried-forward opening balance, or a bounced-cheque re-debit)
    // whose unreconciled receivable-account debit isn't backed by any
    // invoice — folded in here so it still ages, buckets, and nets FIFO
    // exactly like a real invoice instead of being invisible to the report.
    moveType: "out_invoice" | "out_refund" | "miscEntry" | "payment" | "vendorBill" | "vendorRefund";
    invoiceDate: string;
    dueDate: string;
    paymentTermsName: string;
    amountTotal: number;
    amountResidual: number;
    currencyCode: string;
    daysOverdue: number;
    agingBucket: PaymentFollowupAgingBucket;
};

export type PaymentFollowupUnappliedEntry = {
    id: number;
    date: string;
    journalName: string;
    reference: string;
    amount: number;
    currencyCode: string;
};

export type PaymentFollowupCheque = {
    id: number;
    number: string;
    date: string;
    amount: number;
    currencyCode: string;
    state: string;
    bankName: string;
    isPending: boolean;
    isDeposited: boolean;
    /** Part of the amount counted as pending (the whole cheque unless its receivable item is partly matched). */
    pendingAmount: number;
    /** Whether the cheque's Accounts Receivable journal item is fully matched; null when no journal item could be found. */
    receivableMatched: boolean | null;
};

export type PaymentFollowupCustomerRow = {
    customerId: number;
    customerName: string;
    salespersonName: string;
    email: string;
    phone: string;
    street: string;
    city: string;
    currencyCode: string;
    totalInvoiceDue: number;
    totalUnapplied: number;
    totalPdcPending: number;
    totalPdcDeposited: number;
    totalPayableDue: number;
    netDue: number;
    oldestDueDate: string;
    maxDaysOverdue: number;
    agingBucket: PaymentFollowupAgingBucket;
    agingBuckets: PaymentFollowupAgingTotals;
    invoices: PaymentFollowupInvoiceRow[];
    unappliedPayments: PaymentFollowupUnappliedEntry[];
    cheques: PaymentFollowupCheque[];
};

export type PaymentFollowupReport = {
    scope: "salesperson" | "customer";
    salesperson: OdooSalesperson | null;
    asOfDate: string;
    dateBasis: "due" | "invoice";
    agingSystem: "day" | "month";
    currencyCode: string;
    pdcModuleDetected: boolean;
    pdcDebug: {
        paymentMethods: Array<{ code: string; name: string; paymentType: string }>;
        matchedPaymentMethodCode: string | null;
        candidateModels: Array<{ model: string; name: string; transient: boolean }>;
        fieldMatches: Array<{ model: string; modelLabel: string; field: string; fieldLabel: string; transient: boolean }>;
        relationProbe: {
            sourceField: string;
            targetModel: string;
            targetPartnerField: string;
            targetModelBlocked: boolean;
            targetModelTransient: boolean;
            resolved: boolean;
            targetModelFields: string[];
        } | null;
        error: string | null;
    } | null;
    pdcRawMatchCount: number | null;
    pdcAppliedFilters: string[];
    customers: PaymentFollowupCustomerRow[];
    totals: {
        totalInvoiceDue: number;
        totalUnapplied: number;
        totalPdcPending: number;
        totalPdcDeposited: number;
        totalPayableDue: number;
        netDue: number;
        agingBuckets: PaymentFollowupAgingTotals;
    };
};

export type OdooCustomerActivityMonth = {
    /** "YYYY-MM" */
    month: string;
    label: string;
    orderCount: number;
    sales: number;
    target: number;
    /** Delivered revenue (ex VAT, AED) and the gross profit on it, for orders dated in this month. */
    deliveredRevenue: number;
    grossProfit: number;
};

export type OdooCustomerActivityOrder = {
    id: number;
    name: string;
    date: string;
    amount: number;
    state: string;
    salespersonName: string;
    /** Revenue (ex VAT, AED) of what has been delivered so far, its cost, and the profit — confirmed orders only. */
    deliveredRevenue: number;
    grossProfit: number;
};

export type OdooCustomerActivityReport = {
    customer: OdooCustomerSummary;
    startDate: string;
    endDate: string;
    /** The customer's "Customer Monthly Target" from Odoo (0 when not set). */
    customerMonthlyTarget: number;
    totals: {
        orderCount: number;
        totalSales: number;
        averageOrderValue: number;
        lastSaleDate: string;
        openQuotationCount: number;
        openQuotationValue: number;
        /** Months touched by the range, each counted in full against the monthly target. */
        targetMonths: number;
        targetTotal: number;
        /** Sales as a percentage of the target for those months; null when there is no target. */
        targetPercent: number | null;
        /** All-time confirmed sales (not limited to the range). */
        lifetimeSales: number;
        /** Order value excluding VAT, in AED. */
        netSales: number;
        /** The part of net sales already delivered — GP is measured on this only. */
        deliveredRevenue: number;
        /** What Odoo booked as the cost of those deliveries. */
        costOfGoods: number;
        grossProfit: number;
        /** Gross profit as a percentage of delivered revenue; null when nothing was delivered. */
        gpPercent: number | null;
        /** Delivered order lines with no cost recorded (their profit is overstated). */
        linesWithoutCost: number;
    };
    months: OdooCustomerActivityMonth[];
    orders: OdooCustomerActivityOrder[];
    openQuotations: OdooCustomerActivityOrder[];
    topBrands: OdooCustomerBrandSummary[];
    topCategories: OdooCustomerBrandSummary[];
    brandTree: OdooCustomerSalesBrand[];
};

export type OdooPartnerLedgerRow = {
    id: number;
    date: string;
    dueDate: string;
    /** The journal entry's number, e.g. INV/2026/00012, MISC/2026/…, BNK1/… */
    entry: string;
    journal: string;
    account: string;
    kind: "receivable" | "payable";
    label: string;
    reference: string;
    /** Odoo's matching number (e.g. "A123"), blank when not matched at all. */
    matching: string;
    debit: number;
    credit: number;
    /** Running balance after this item (debit - credit), in company currency. */
    balance: number;
    /** Amount in the item's own currency, when it isn't the company currency. */
    amountCurrency: number;
    currencyCode: string;
    /** What is still open on the item, in company currency (0 when fully matched). */
    residual: number;
};

export type OdooPartnerLedger = {
    customerName: string;
    asOfDate: string;
    unreconciledOnly: boolean;
    currencyCode: string;
    rows: OdooPartnerLedgerRow[];
    totals: { debit: number; credit: number; balance: number };
};
