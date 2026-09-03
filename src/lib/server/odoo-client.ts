import {
    OdooCredentials,
    OdooDashboardActivityType,
    OdooOrderLineInput,
} from "@/types/odoo";

type ProductCategory = {
    id: number;
    name: string;
    model: "product.public.category" | "product.category";
    parentPath?: string;
};

type BrandOption = {
    id: number;
    name: string;
};

type PurchaseOrderReportRow = {
    productId: number;
    productName: string;
    soldInPeriod: number;
    currentStock: number;
    averageMonthlySales: number;
    suggestedRestock: number;
    pendingFromBackorders: number;
};

type PurchaseOrderOption = {
    id: number;
    name: string;
    vendorName: string;
    dateOrder: string;
};

type ProductPerformanceWarehouseStock = {
    warehouseId: number;
    warehouseName: string;
    quantity: number;
};

type ProductPerformanceRow = {
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
    stockByWarehouse: ProductPerformanceWarehouseStock[];
};

type ProductsPerformancePurchaseOrderDetails = {
    name: string;
    vendorName: string;
    vendorReference: string;
    confirmationDate: string;
    expectedArrival: string;
    arrival: string;
    deliverTo: string;
};

type ProductsPerformanceReport = {
    startDate: string;
    endDate: string;
    currencyCode: string;
    matchedProductCount: number;
    rows: ProductPerformanceRow[];
    totals: {
        soldQty: number;
        salesValue: number;
        purchasedQty: number;
        totalStock: number;
    };
    unconvertedCurrencyCodes: string[];
    purchaseOrderDetails: ProductsPerformancePurchaseOrderDetails | null;
};

type SalespersonOption = {
    id: number;
    name: string;
    email: string;
};

type CustomerOption = {
    id: number;
    name: string;
    salespersonName: string;
};

type ProductOption = {
    id: number;
    name: string;
};

type NearExpiryProduct = {
    lotId: number;
    lotName: string;
    productId: number;
    productName: string;
    expirationDate: string;
    quantity: number;
    daysUntilExpiry: number;
};

type CustomerSummary = {
    customerId: number;
    customerName: string;
    salespersonName: string;
    email: string;
    phone: string;
    street: string;
    city: string;
};

type ServicedCustomerRow = CustomerSummary & {
    orderCount: number;
    totalSales: number;
    lastSaleDate: string;
};

type VisitedCustomerRow = CustomerSummary & {
    visitCount: number;
    lastVisitDate: string;
    crmReference: string;
};

type InactiveCustomerRow = CustomerSummary & {
    lastVisitDate: string;
};

type SalespersonActivityReport = {
    salesperson: SalespersonOption;
    startDate: string;
    endDate: string;
    servicedCustomers: ServicedCustomerRow[];
    visitedCustomers: VisitedCustomerRow[];
    inactiveAssignedCustomers: InactiveCustomerRow[];
};

type CustomerBrandSummary = {
    brandName: string;
    quantitySold: number;
    totalSales: number;
};

type CustomerReport = {
    customer: CustomerSummary;
    totalSales: number;
    lastVisitDate: string;
    lastVisitReference: string;
    lastVisitSalespersonName: string;
    openQuotationCount: number;
    topBrands: CustomerBrandSummary[];
};

type CurrencyTotal = {
    currencyId: number;
    currencyCode: string;
    total: number;
    invoiceCount: number;
    includedInTotal: boolean;
};

type SalespersonMonthlyInvoices = {
    salesperson: SalespersonOption;
    year: number;
    month: number;
    totalInvoiced: number;
    creditNoteTotal: number;
    invoiceCount: number;
    primaryCurrencyCode: string;
    currencyTotals: CurrencyTotal[];
    creditNoteCurrencyTotals: CurrencyTotal[];
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

type SalesTargetBrandProduct = {
    productId: number;
    productName: string;
    quantitySold: number;
    totalSales: number;
    orderCount: number;
};

type SalesTargetBrandCustomer = CustomerSummary & {
    orderCount: number;
    totalSales: number;
    lastSaleDate: string;
};

type SalesTargetDetailsReport = {
    salesperson: SalespersonOption;
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
    products: SalesTargetBrandProduct[];
    servedCustomers: SalesTargetBrandCustomer[];
};

type SalespersonDailyActivity = {
    salespersonId: number;
    salespersonName: string;
    count: number;
};

type DashboardStats = {
    pendingCount: number;
    confirmedCount: number;
    draftCount: number;
    selectedActivityType: OdooDashboardActivityType;
    salespersonDailyActivities: SalespersonDailyActivity[];
};

type JsonRpcResponse<T> = {
    jsonrpc: string;
    id: number;
    result?: T;
    error?: {
        code: number;
        message: string;
        data?: {
            debug?: string;
            message?: string;
            name?: string;
        };
    };
};

type RpcRequestBody = {
    service: "common" | "object";
    method: string;
    args: unknown[];
};

function normalizeUrl(url: string) {
    return url.replace(/\/+$/, "");
}

async function jsonRpc<T>(baseUrl: string, payload: RpcRequestBody): Promise<T> {
    const endpoint = `${normalizeUrl(baseUrl)}/jsonrpc`;
    const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            jsonrpc: "2.0",
            method: "call",
            params: payload,
            id: Date.now(),
        }),
        cache: "no-store",
    });

    if (!response.ok) {
        throw new Error(`Odoo HTTP error: ${response.status}`);
    }

    const data = (await response.json()) as JsonRpcResponse<T>;

    if (data.error) {
        const errorMsg = data.error.data?.message ?? data.error.message;
        const model = (payload.args[2] as string) ?? "unknown";
        const method = (payload.args[3] as string) ?? "unknown";
        throw new Error(`Odoo error on ${model}.${method}: ${errorMsg}`);
    }

    if (typeof data.result === "undefined") {
        throw new Error("Empty response from Odoo API");
    }

    return data.result;
}

async function authenticate(credentials: OdooCredentials) {
    let uid;
    try {
        uid = await jsonRpc<number>(credentials.url, {
            service: "common",
            method: "authenticate",
            args: [credentials.db, credentials.username, credentials.password, {}],
        });
    } catch (error) {
        throw new Error(
            `Failed to authenticate with Odoo. Check your database, username, and password. Details: ${error instanceof Error ? error.message : String(error)
            }`
        );
    }

    if (!uid || uid <= 0) {
        throw new Error("Authentication failed: received invalid user ID from Odoo");
    }

    return uid;
}

async function executeKw<T>(
    credentials: OdooCredentials,
    uid: number,
    model: string,
    method: string,
    args: unknown[] = [],
    kwargs: Record<string, unknown> = {}
) {
    return jsonRpc<T>(credentials.url, {
        service: "object",
        method: "execute_kw",
        args: [
            credentials.db,
            uid,
            credentials.password,
            model,
            method,
            args,
            kwargs,
        ],
    });
}

function formatOdooDateTime(date: Date) {
    return date.toISOString().slice(0, 19).replace("T", " ");
}

function formatLocalDate(date: Date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function toOdooDateBoundary(date: string, endOfDay: boolean) {
    const normalized = date.trim();
    return `${normalized} ${endOfDay ? "23:59:59" : "00:00:00"}`;
}

function monthsBetweenInclusive(startDate: string, endDate: string) {
    const start = new Date(`${startDate}T00:00:00Z`);
    const end = new Date(`${endDate}T23:59:59Z`);
    const millis = end.getTime() - start.getTime();

    if (!Number.isFinite(millis) || millis < 0) {
        return 1;
    }

    const days = millis / (1000 * 60 * 60 * 24) + 1;
    return Math.max(1, days / 30);
}

function ensureDateRange(startDate: string, endDate: string) {
    if (!startDate || !endDate) {
        throw new Error("Start date and end date are required.");
    }

    if (startDate > endDate) {
        throw new Error("Start date must be before or equal to end date.");
    }
}

function toDisplayString(value: unknown) {
    return String(value ?? "").trim();
}

function normalizeRelationalIdList(value: unknown) {
    if (Array.isArray(value)) {
        return value
            .map((id) => Number(id))
            .filter((id) => Number.isFinite(id) && id > 0);
    }

    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        return [value];
    }

    if (typeof value === "string") {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed > 0) {
            return [parsed];
        }
    }

    return [] as number[];
}

function getRelationalId(value: unknown) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        return value;
    }

    if (typeof value === "string") {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed > 0) {
            return parsed;
        }
    }

    return Array.isArray(value) && typeof value[0] === "number" ? value[0] : null;
}

function getRelationalName(value: unknown) {
    return Array.isArray(value) && typeof value[1] === "string" ? value[1] : "";
}

function pickCustomerPhone(record: Record<string, unknown>) {
    return toDisplayString(record.phone) || toDisplayString(record.mobile);
}

function toCustomerSummary(
    customer: Record<string, unknown>,
    fallbackSalespersonName: string
): CustomerSummary {
    return {
        customerId: Number(customer.id),
        customerName: toDisplayString(customer.name) || `Customer #${String(customer.id ?? "")}`,
        salespersonName: getRelationalName(customer.user_id) || fallbackSalespersonName,
        email: toDisplayString(customer.email),
        phone: pickCustomerPhone(customer),
        street: toDisplayString(customer.street),
        city: toDisplayString(customer.city),
    };
}

const basePartnerFields = [
    "id",
    "name",
    "email",
    "street",
    "city",
    "user_id",
    "commercial_partner_id",
    "customer_rank",
];

async function getAvailablePartnerFields(
    credentials: OdooCredentials,
    uid: number
): Promise<string[]> {
    const optionalContactFields = ["phone", "mobile"];
    const availableFields = await executeKw<Record<string, { string?: string }>>(
        credentials,
        uid,
        "res.partner",
        "fields_get",
        [optionalContactFields],
        {
            attributes: ["string"],
        }
    );

    return [
        ...basePartnerFields,
        ...optionalContactFields.filter((fieldName) => Boolean(availableFields[fieldName])),
    ];
}

async function readPartnersByIds(
    credentials: OdooCredentials,
    uid: number,
    partnerIds: number[],
    partnerFields: string[]
) {
    if (partnerIds.length === 0) {
        return [] as Array<Record<string, unknown>>;
    }

    return executeKw<Array<Record<string, unknown>>>(
        credentials,
        uid,
        "res.partner",
        "read",
        [partnerIds],
        {
            fields: partnerFields,
        }
    );
}

async function getCanonicalCustomerMap(
    credentials: OdooCredentials,
    uid: number,
    partnerIds: number[]
) {
    const uniquePartnerIds = Array.from(new Set(partnerIds.filter((id) => Number.isFinite(id) && id > 0)));
    if (uniquePartnerIds.length === 0) {
        return new Map<number, Record<string, unknown>>();
    }

    const partnerFields = await getAvailablePartnerFields(credentials, uid);
    const directPartners = await readPartnersByIds(credentials, uid, uniquePartnerIds, partnerFields);
    const commercialIds = Array.from(
        new Set(
            directPartners
                .map((partner) => getRelationalId(partner.commercial_partner_id) ?? Number(partner.id ?? 0))
                .filter((id) => Number.isFinite(id) && id > 0)
        )
    );

    const commercialPartners = await readPartnersByIds(credentials, uid, commercialIds, partnerFields);
    const commercialById = new Map<number, Record<string, unknown>>();
    for (const partner of commercialPartners) {
        commercialById.set(Number(partner.id), partner);
    }

    const canonicalByPartnerId = new Map<number, Record<string, unknown>>();
    for (const partner of directPartners) {
        const partnerId = Number(partner.id ?? 0);
        const commercialId = getRelationalId(partner.commercial_partner_id) ?? partnerId;
        canonicalByPartnerId.set(partnerId, commercialById.get(commercialId) ?? partner);
    }

    return canonicalByPartnerId;
}

function normalizeOdooDate(value: unknown) {
    return toDisplayString(value);
}

function isWithinRange(value: string, start: string, end: string) {
    return value >= start && value <= end;
}

function getMonthDateRange(year: number, month: number) {
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 0));

    return {
        startDate: start.toISOString().slice(0, 10),
        endDate: end.toISOString().slice(0, 10),
    };
}

const TARGET_CURRENCY_CODE = "AED";

/**
 * Sales targets are always entered in this currency, so it's the currency
 * `totalInvoiced`/`categoryTotals` are computed in. Falls back to the
 * currency used by the most invoices in `fallbackAmounts` if AED isn't a
 * currency configured in this Odoo instance.
 */
async function getPrimaryCurrencyId(
    credentials: OdooCredentials,
    uid: number,
    fallbackAmounts: Array<{ currencyId: number }>
): Promise<number | null> {
    const currencies = await executeKw<Array<{ id: number }>>(
        credentials,
        uid,
        "res.currency",
        "search_read",
        [[["name", "=", TARGET_CURRENCY_CODE]]],
        { fields: ["id"], limit: 1, context: { active_test: false } }
    );

    const foundId = Number(currencies[0]?.id ?? 0);
    if (foundId > 0) {
        return foundId;
    }

    const countByCurrencyId = new Map<number, number>();
    for (const amount of fallbackAmounts) {
        countByCurrencyId.set(amount.currencyId, (countByCurrencyId.get(amount.currencyId) ?? 0) + 1);
    }

    let majorityCurrencyId: number | null = null;
    let majorityCount = 0;
    for (const [currencyId, count] of countByCurrencyId) {
        if (count > majorityCount) {
            majorityCurrencyId = currencyId;
            majorityCount = count;
        }
    }

    return majorityCurrencyId;
}

/**
 * Groups per-invoice transaction-currency amounts (see
 * `getInvoiceTransactionAmounts`) by currency, for presenting a per-currency
 * breakdown instead of blending mismatched currencies into one number.
 */
function buildCurrencyTotals(
    amounts: Array<{ currencyId: number; currencyCode: string; amount: number }>,
    multiplierByCurrencyId: Map<number, number>
): CurrencyTotal[] {
    const totals = new Map<number, Omit<CurrencyTotal, "includedInTotal">>();

    for (const entry of amounts) {
        const existing = totals.get(entry.currencyId);
        if (!existing) {
            totals.set(entry.currencyId, {
                currencyId: entry.currencyId,
                currencyCode: entry.currencyCode,
                total: entry.amount,
                invoiceCount: 1,
            });
            continue;
        }

        existing.total += entry.amount;
        existing.invoiceCount += 1;
    }

    return Array.from(totals.values())
        .map((total) => ({
            ...total,
            total: Number(total.total.toFixed(2)),
            includedInTotal: multiplierByCurrencyId.has(total.currencyId),
        }))
        .sort((a, b) => b.total - a.total);
}

/**
 * Resolves each invoice's own transaction currency and raw amount
 * (`currency_id` / `amount_total`) — exactly what's printed on the invoice,
 * with no FX conversion applied. An invoice raised in USD stays USD here
 * even if the issuing company's own base currency is AED, which is what a
 * "breakdown by currency" should show: Odoo's accounting-converted
 * `amount_total_signed` collapses every invoice on the same company into
 * that company's single base currency, hiding exactly this kind of mix.
 */
function getInvoiceTransactionAmounts(
    invoices: Array<Record<string, unknown>>
): Map<number, { currencyId: number; currencyCode: string; amount: number }> {
    const byInvoiceId = new Map<number, { currencyId: number; currencyCode: string; amount: number }>();

    for (const invoice of invoices) {
        const invoiceId = Number(invoice.id ?? 0);
        if (invoiceId <= 0) {
            continue;
        }

        const currencyId = getRelationalId(invoice.currency_id);
        if (!currencyId) {
            continue;
        }

        const currencyCode = getRelationalName(invoice.currency_id) || "?";
        const amount = Number(invoice.amount_total ?? 0);

        byInvoiceId.set(invoiceId, { currencyId, currencyCode, amount });
    }

    return byInvoiceId;
}

/**
 * The company these Odoo credentials log into by default — used as the
 * source of truth for currency exchange rates, matching whatever is
 * configured under that company's Accounting > Currencies settings.
 */
async function getHomeCompanyId(credentials: OdooCredentials, uid: number): Promise<number | null> {
    const users = await executeKw<Array<{ company_id?: unknown }>>(
        credentials,
        uid,
        "res.users",
        "read",
        [[uid]],
        { fields: ["company_id"] }
    );

    return getRelationalId(users[0]?.company_id);
}

/**
 * Reads the exchange rate already configured for each currency under
 * Accounting > Currencies (the `res.currency.rate` records), as of a given
 * date. Returns each currency's most recent rate on or before that date.
 * Odoo stores `rate` such that `amount_in_home_currency = amount / rate`
 * (verified against Odoo's own `amount_total_signed` on a real invoice).
 */
async function getCurrencyRatesToHomeCurrency(
    credentials: OdooCredentials,
    uid: number,
    homeCompanyId: number,
    currencyIds: number[],
    asOfDate: string
): Promise<Map<number, number>> {
    const rateByCurrencyId = new Map<number, number>();
    if (currencyIds.length === 0) {
        return rateByCurrencyId;
    }

    const records = await executeKw<Array<{ currency_id?: unknown; rate?: number }>>(
        credentials,
        uid,
        "res.currency.rate",
        "search_read",
        [[
            ["currency_id", "in", currencyIds],
            ["company_id", "=", homeCompanyId],
            ["name", "<=", asOfDate],
        ]],
        {
            fields: ["currency_id", "rate"],
            // Most recent rate per currency first; only the first hit per
            // currency_id (below) is kept.
            order: "currency_id asc, name desc",
            limit: 5000,
        }
    );

    for (const record of records) {
        const currencyId = getRelationalId(record.currency_id);
        if (!currencyId || rateByCurrencyId.has(currencyId)) {
            continue;
        }

        const rate = Number(record.rate);
        if (Number.isFinite(rate) && rate > 0) {
            rateByCurrencyId.set(currencyId, rate);
        }
    }

    return rateByCurrencyId;
}

/**
 * Builds a currencyId -> multiplier map so a transaction-currency amount can
 * be converted to the home/target currency with a single multiplication:
 * `amount * multiplier`. The target currency itself maps to 1.
 */
function buildCurrencyMultipliers(
    primaryCurrencyId: number | null,
    rateByCurrencyId: Map<number, number>
): Map<number, number> {
    const multiplierByCurrencyId = new Map<number, number>();
    if (primaryCurrencyId) {
        multiplierByCurrencyId.set(primaryCurrencyId, 1);
    }

    for (const [currencyId, rate] of rateByCurrencyId) {
        multiplierByCurrencyId.set(currencyId, 1 / rate);
    }

    return multiplierByCurrencyId;
}

async function getInvoiceSalespersonField(
    credentials: OdooCredentials,
    uid: number
): Promise<string> {
    const candidateFields = ["invoice_user_id", "user_id"];
    const fields = await executeKw<Record<string, { string?: string }>>(
        credentials,
        uid,
        "account.move",
        "fields_get",
        [candidateFields],
        {
            attributes: ["string", "type", "relation"],
        }
    );

    for (const fieldName of candidateFields) {
        if (fields[fieldName]) {
            return fieldName;
        }
    }

    throw new Error("Could not find a salesperson field on account.move in Odoo.");
}

async function getGroupedCountBySalesperson(
    credentials: OdooCredentials,
    uid: number,
    input: {
        model: string;
        domain: unknown[];
        salespersonField?: string;
    }
) {
    const salespersonField = input.salespersonField ?? "user_id";
    const grouped = await executeKw<Array<Record<string, unknown>>>(
        credentials,
        uid,
        input.model,
        "read_group",
        [input.domain, [salespersonField], [salespersonField]],
        {
            lazy: false,
        }
    );

    const totals = new Map<number, number>();
    for (const row of grouped) {
        const salespersonId = getRelationalId(row[salespersonField]);
        if (!salespersonId) {
            continue;
        }

        const countValue =
            Number(row.__count ?? 0) ||
            Number(row[`${salespersonField}_count`] ?? 0) ||
            Number(row[`${salespersonField}_count_distinct`] ?? 0);

        totals.set(salespersonId, countValue);
    }

    return totals;
}

async function getSalesOwnDocumentsGroupId(
    credentials: OdooCredentials,
    uid: number
): Promise<number | null> {
    const refs = await executeKw<Array<Record<string, unknown>>>(
        credentials,
        uid,
        "ir.model.data",
        "search_read",
        [[
            ["model", "=", "res.groups"],
            ["name", "=", "group_sale_salesman"],
            ["module", "in", ["sales_team", "sale"]],
        ]],
        {
            fields: ["res_id"],
            order: "id asc",
            limit: 1,
        }
    );

    const groupId = Number(refs[0]?.res_id ?? 0);
    return Number.isFinite(groupId) && groupId > 0 ? groupId : null;
}

async function getUsersGroupsFieldName(
    credentials: OdooCredentials,
    uid: number
): Promise<"groups_id" | "group_ids" | null> {
    const candidateFields: Array<"groups_id" | "group_ids"> = ["groups_id", "group_ids"];
    const fields = await executeKw<Record<string, { string?: string }>>(
        credentials,
        uid,
        "res.users",
        "fields_get",
        [candidateFields],
        {
            attributes: ["string"],
        }
    );

    for (const fieldName of candidateFields) {
        if (fields[fieldName]) {
            return fieldName;
        }
    }

    return null;
}

async function getDashboardSalespeople(
    credentials: OdooCredentials,
    uid: number
): Promise<SalespersonOption[]> {
    const ownDocsGroupId = await getSalesOwnDocumentsGroupId(credentials, uid);
    const usersGroupsFieldName = await getUsersGroupsFieldName(credentials, uid);
    const domain: unknown[] = [
        ["active", "=", true],
        ["share", "=", false],
    ];

    if (ownDocsGroupId && usersGroupsFieldName) {
        domain.push([usersGroupsFieldName, "in", [ownDocsGroupId]]);
    }

    const users = await executeKw<Array<Record<string, unknown>>>(
        credentials,
        uid,
        "res.users",
        "search_read",
        [domain],
        {
            fields: ["id", "name", "email"],
            order: "name asc",
            limit: 500,
        }
    );

    return users.map((user) => ({
        id: Number(user.id),
        name: toDisplayString(user.name),
        email: toDisplayString(user.email),
    }));
}

async function getPreferredBrandField(
    credentials: OdooCredentials,
    uid: number
): Promise<{ fieldName: string; label: string }> {
    const candidateFields = ["brand_id", "product_brand_id", "x_brand_id"];
    const fields = await executeKw<Record<string, { string?: string }>>(
        credentials,
        uid,
        "product.template",
        "fields_get",
        [candidateFields],
        {
            attributes: ["string", "type", "relation"],
        }
    );

    for (const fieldName of candidateFields) {
        if (fields[fieldName]) {
            return {
                fieldName,
                label: toDisplayString(fields[fieldName].string) || "Brand",
            };
        }
    }

    return { fieldName: "categ_id", label: "Category" };
}

async function getCommercialPartner(
    credentials: OdooCredentials,
    uid: number,
    customerId: number
) {
    const canonicalMap = await getCanonicalCustomerMap(credentials, uid, [customerId]);
    const customer = canonicalMap.get(customerId);
    if (!customer) {
        throw new Error("Customer not found in Odoo.");
    }

    return customer;
}

export async function getSalespeople(credentials: OdooCredentials): Promise<SalespersonOption[]> {
    const uid = await authenticate(credentials);

    const users = await executeKw<Array<Record<string, unknown>>>(
        credentials,
        uid,
        "res.users",
        "search_read",
        [[
            ["active", "=", true],
            ["share", "=", false],
        ]],
        {
            fields: ["id", "name", "email"],
            order: "name asc",
            limit: 500,
        }
    );

    return users.map((user) => ({
        id: Number(user.id),
        name: toDisplayString(user.name),
        email: toDisplayString(user.email),
    }));
}

export async function getCustomers(credentials: OdooCredentials): Promise<CustomerOption[]> {
    const uid = await authenticate(credentials);
    const partnerFields = await getAvailablePartnerFields(credentials, uid);

    const partners = await executeKw<Array<Record<string, unknown>>>(
        credentials,
        uid,
        "res.partner",
        "search_read",
        [[
            ["is_company", "=", true],
        ]],
        {
            fields: partnerFields,
            order: "name asc",
            limit: 5000,
            context: { active_test: false },
        }
    );

    const canonicalIds = Array.from(
        new Set(
            partners
                .map((partner) => getRelationalId(partner.commercial_partner_id) ?? Number(partner.id ?? 0))
                .filter((id) => Number.isFinite(id) && id > 0)
        )
    );

    const canonicalCustomerMap = await getCanonicalCustomerMap(credentials, uid, canonicalIds);
    const customers = Array.from(canonicalCustomerMap.values()).map((customer) => {
        const summary = toCustomerSummary(customer, "-");
        return {
            id: summary.customerId,
            name: summary.customerName,
            salespersonName: summary.salespersonName || "-",
        };
    });

    customers.sort((left, right) => left.name.localeCompare(right.name));

    return customers.filter(
        (customer, index, allCustomers) =>
            index === allCustomers.findIndex((candidate) => candidate.id === customer.id)
    );
}

export async function getProducts(
    credentials: OdooCredentials,
    input?: {
        query?: string;
        limit?: number;
        offset?: number;
    }
): Promise<{ products: ProductOption[]; totalCount: number }> {
    const uid = await authenticate(credentials);
    const query = (input?.query ?? "").trim();
    const limit = Number.isFinite(input?.limit) ? Math.max(1, Math.min(100, Number(input?.limit))) : 10;
    const offset = Number.isFinite(input?.offset) ? Math.max(0, Number(input?.offset)) : 0;

    const domain: unknown[] = [];
    if (query) {
        domain.push(["name", "ilike", query]);
    }

    const totalCount = await executeKw<number>(
        credentials,
        uid,
        "product.product",
        "search_count",
        [domain],
        {
            context: { active_test: false },
        }
    );

    const products = await executeKw<Array<Record<string, unknown>>>(
        credentials,
        uid,
        "product.product",
        "search_read",
        [domain],
        {
            fields: ["id", "display_name", "name"],
            order: "name asc",
            limit,
            offset,
            context: { active_test: false },
        }
    );

    return {
        totalCount,
        products: products
            .map((product) => ({
                id: Number(product.id ?? 0),
                name: toDisplayString(product.display_name) || toDisplayString(product.name),
            }))
            .filter((product) => product.id > 0 && product.name)
            .sort((left, right) => left.name.localeCompare(right.name)),
    };
}

export async function getProductCategoriesByProductIds(
    credentials: OdooCredentials,
    productIds: number[]
): Promise<Map<number, { categoryId: number; categoryName: string }>> {
    const normalizedProductIds = Array.from(
        new Set(
            (Array.isArray(productIds) ? productIds : [])
                .map((id) => Number(id))
                .filter((id) => Number.isFinite(id) && id > 0)
        )
    );

    if (normalizedProductIds.length === 0) {
        return new Map();
    }

    const uid = await authenticate(credentials);
    const products: Array<Record<string, unknown>> = [];

    for (let index = 0; index < normalizedProductIds.length; index += 200) {
        const batch = normalizedProductIds.slice(index, index + 200);
        const batchProducts = await executeKw<Array<Record<string, unknown>>>(
            credentials,
            uid,
            "product.product",
            "read",
            [batch],
            {
                fields: ["id", "categ_id", "product_tmpl_id"],
                context: { active_test: false },
            }
        );
        products.push(...batchProducts);
    }

    const templateIdsNeedingLookup = Array.from(
        new Set(
            products
                .map((product) => getRelationalId(product.product_tmpl_id))
                .filter((id): id is number => typeof id === "number" && id > 0)
        )
    );

    const templates: Array<Record<string, unknown>> = [];
    for (let index = 0; index < templateIdsNeedingLookup.length; index += 200) {
        const batch = templateIdsNeedingLookup.slice(index, index + 200);
        const batchTemplates = await executeKw<Array<Record<string, unknown>>>(
            credentials,
            uid,
            "product.template",
            "read",
            [batch],
            {
                fields: ["id", "categ_id"],
                context: { active_test: false },
            }
        );
        templates.push(...batchTemplates);
    }

    const categoryIds = new Set<number>();
    for (const product of products) {
        const categoryId = getRelationalId(product.categ_id);
        if (typeof categoryId === "number" && categoryId > 0) {
            categoryIds.add(categoryId);
        }
    }

    for (const template of templates) {
        const categoryId = getRelationalId(template.categ_id);
        if (typeof categoryId === "number" && categoryId > 0) {
            categoryIds.add(categoryId);
        }
    }

    const categories: Array<Record<string, unknown>> = [];
    const normalizedCategoryIds = Array.from(categoryIds);
    for (let index = 0; index < normalizedCategoryIds.length; index += 200) {
        const batch = normalizedCategoryIds.slice(index, index + 200);
        const batchCategories = await executeKw<Array<Record<string, unknown>>>(
            credentials,
            uid,
            "product.category",
            "read",
            [batch],
            {
                fields: ["id", "name"],
                context: { active_test: false },
            }
        );
        categories.push(...batchCategories);
    }

    const categoryNameById = new Map<number, string>();
    for (const category of categories) {
        const categoryId = Number(category.id ?? 0);
        const categoryName = toDisplayString(category.name);
        if (categoryId > 0 && categoryName) {
            categoryNameById.set(categoryId, categoryName);
        }
    }

    const categoryByTemplateId = new Map<number, { categoryId: number; categoryName: string }>();
    for (const template of templates) {
        const templateId = Number(template.id ?? 0);
        const categoryId = getRelationalId(template.categ_id);
        const categoryName =
            (typeof categoryId === "number" && categoryId > 0
                ? categoryNameById.get(categoryId)
                : "") || getRelationalName(template.categ_id);

        if (templateId > 0 && typeof categoryId === "number" && categoryId > 0 && categoryName) {
            categoryByTemplateId.set(templateId, {
                categoryId,
                categoryName,
            });
        }
    }

    const categoryByProductId = new Map<number, { categoryId: number; categoryName: string }>();
    for (const product of products) {
        const productId = Number(product.id ?? 0);
        const directCategoryId = getRelationalId(product.categ_id);
        const directCategoryName =
            (typeof directCategoryId === "number" && directCategoryId > 0
                ? categoryNameById.get(directCategoryId)
                : "") || getRelationalName(product.categ_id);
        const templateId = getRelationalId(product.product_tmpl_id);

        if (
            productId > 0 &&
            typeof directCategoryId === "number" &&
            directCategoryId > 0 &&
            directCategoryName
        ) {
            categoryByProductId.set(productId, {
                categoryId: directCategoryId,
                categoryName: directCategoryName,
            });
            continue;
        }

        if (productId > 0 && typeof templateId === "number" && templateId > 0) {
            const templateCategory = categoryByTemplateId.get(templateId);
            if (templateCategory) {
                categoryByProductId.set(productId, templateCategory);
            }
        }
    }

    return categoryByProductId;
}

export async function resolveCanonicalProductIds(
    credentials: OdooCredentials,
    productIds: number[]
): Promise<Map<number, number>> {
    const normalizedIds = Array.from(
        new Set(
            (Array.isArray(productIds) ? productIds : [])
                .map((id) => Number(id))
                .filter((id) => Number.isFinite(id) && id > 0)
        )
    );

    if (normalizedIds.length === 0) {
        return new Map();
    }

    const uid = await authenticate(credentials);
    const resolvedByInput = new Map<number, number>();

    const products: Array<Record<string, unknown>> = [];
    for (let index = 0; index < normalizedIds.length; index += 200) {
        const batch = normalizedIds.slice(index, index + 200);
        const batchProducts = await executeKw<Array<Record<string, unknown>>>(
            credentials,
            uid,
            "product.product",
            "read",
            [batch],
            {
                fields: ["id"],
                context: { active_test: false },
            }
        );
        products.push(...batchProducts);
    }

    const existingProductIdSet = new Set<number>();
    for (const product of products) {
        const id = Number(product.id ?? 0);
        if (id > 0) {
            existingProductIdSet.add(id);
            resolvedByInput.set(id, id);
        }
    }

    const missingIds = normalizedIds.filter((id) => !existingProductIdSet.has(id));
    if (missingIds.length === 0) {
        return resolvedByInput;
    }

    const variants = await executeKw<Array<Record<string, unknown>>>(
        credentials,
        uid,
        "product.product",
        "search_read",
        [[
            ["product_tmpl_id", "in", missingIds],
        ]],
        {
            fields: ["id", "product_tmpl_id"],
            order: "id asc",
            limit: 10000,
            context: { active_test: false },
        }
    );

    const firstVariantByTemplateId = new Map<number, number>();
    for (const variant of variants) {
        const variantId = Number(variant.id ?? 0);
        const templateId = getRelationalId(variant.product_tmpl_id);
        if (!variantId || !templateId || firstVariantByTemplateId.has(templateId)) {
            continue;
        }

        firstVariantByTemplateId.set(templateId, variantId);
    }

    for (const missingId of missingIds) {
        const resolvedVariantId = firstVariantByTemplateId.get(missingId);
        if (resolvedVariantId) {
            resolvedByInput.set(missingId, resolvedVariantId);
        }
    }

    return resolvedByInput;
}

export async function getTemplateIdsByVariantIds(
    credentials: OdooCredentials,
    variantIds: number[]
): Promise<Map<number, number>> {
    const normalizedVariantIds = Array.from(
        new Set(
            (Array.isArray(variantIds) ? variantIds : [])
                .map((id) => Number(id))
                .filter((id) => Number.isFinite(id) && id > 0)
        )
    );

    if (normalizedVariantIds.length === 0) {
        return new Map();
    }

    const uid = await authenticate(credentials);
    const products: Array<Record<string, unknown>> = [];

    for (let index = 0; index < normalizedVariantIds.length; index += 200) {
        const batch = normalizedVariantIds.slice(index, index + 200);
        const batchProducts = await executeKw<Array<Record<string, unknown>>>(
            credentials,
            uid,
            "product.product",
            "read",
            [batch],
            {
                fields: ["id", "product_tmpl_id"],
                context: { active_test: false },
            }
        );
        products.push(...batchProducts);
    }

    const templateByVariantId = new Map<number, number>();
    for (const product of products) {
        const variantId = Number(product.id ?? 0);
        const templateId = getRelationalId(product.product_tmpl_id);
        if (variantId > 0 && typeof templateId === "number" && templateId > 0) {
            templateByVariantId.set(variantId, templateId);
        }
    }

    return templateByVariantId;
}

/**
 * Given a single Odoo product id (which may be a `product.template` id OR a
 * `product.product` variant id), return every equivalent id: the id itself,
 * its template id, and all variant ids of that template. Uses `search_read`
 * (never `read`) so it does not raise a MissingError when handed a template
 * id that is not a `product.product` record.
 */
export async function getEquivalentProductIds(
    credentials: OdooCredentials,
    productId: number
): Promise<number[]> {
    const id = Number(productId);
    if (!Number.isFinite(id) || id <= 0) {
        return [];
    }

    const uid = await authenticate(credentials);
    const ids = new Set<number>([id]);
    const templateIds = new Set<number>();

    // Treat the incoming id as a template id and collect its variants.
    templateIds.add(id);

    // Treat the incoming id as a variant id and collect its template.
    const asVariant = await executeKw<Array<Record<string, unknown>>>(
        credentials,
        uid,
        "product.product",
        "search_read",
        [[["id", "=", id]]],
        { fields: ["id", "product_tmpl_id"], context: { active_test: false } }
    );
    for (const variant of asVariant) {
        const templateId = getRelationalId(variant.product_tmpl_id);
        if (typeof templateId === "number" && templateId > 0) {
            templateIds.add(templateId);
        }
    }

    // Collect every variant id belonging to any of the resolved templates.
    const variants = await executeKw<Array<Record<string, unknown>>>(
        credentials,
        uid,
        "product.product",
        "search_read",
        [[["product_tmpl_id", "in", Array.from(templateIds)]]],
        { fields: ["id", "product_tmpl_id"], order: "id asc", limit: 10000, context: { active_test: false } }
    );
    for (const variant of variants) {
        const variantId = Number(variant.id ?? 0);
        const templateId = getRelationalId(variant.product_tmpl_id);
        if (variantId > 0) {
            ids.add(variantId);
        }
        if (typeof templateId === "number" && templateId > 0) {
            templateIds.add(templateId);
        }
    }

    for (const templateId of templateIds) {
        ids.add(templateId);
    }

    return Array.from(ids);
}

/**
 * Batch-resolve a list of Odoo product ids (each may be a `product.template` id
 * OR a `product.product` variant id) into their `{ templateId, variantId }` pair.
 * Uses `search_read` only, so it never raises a MissingError on a template id or
 * a deleted record. Ids that cannot be resolved are simply absent from the map.
 */
export async function mapProductIdsToTemplateAndVariant(
    credentials: OdooCredentials,
    productIds: number[]
): Promise<Map<number, { templateId: number; variantId: number }>> {
    const ids = Array.from(
        new Set(
            (Array.isArray(productIds) ? productIds : [])
                .map((id) => Number(id))
                .filter((id) => Number.isFinite(id) && id > 0)
        )
    );

    const result = new Map<number, { templateId: number; variantId: number }>();
    if (ids.length === 0) {
        return result;
    }

    const uid = await authenticate(credentials);

    // 1) Treat each input as a variant id and read its template.
    const asVariants: Array<Record<string, unknown>> = [];
    for (let index = 0; index < ids.length; index += 300) {
        const batch = ids.slice(index, index + 300);
        const found = await executeKw<Array<Record<string, unknown>>>(
            credentials,
            uid,
            "product.product",
            "search_read",
            [[["id", "in", batch]]],
            { fields: ["id", "product_tmpl_id"], limit: batch.length, context: { active_test: false } }
        );
        asVariants.push(...found);
    }
    for (const variant of asVariants) {
        const variantId = Number(variant.id ?? 0);
        const templateId = getRelationalId(variant.product_tmpl_id);
        if (variantId > 0 && typeof templateId === "number" && templateId > 0) {
            result.set(variantId, { templateId, variantId });
        }
    }

    // 2) Inputs not found as variants are (probably) template ids: resolve their first variant.
    const remaining = ids.filter((id) => !result.has(id));
    if (remaining.length > 0) {
        const variantsOfTemplates: Array<Record<string, unknown>> = [];
        for (let index = 0; index < remaining.length; index += 300) {
            const batch = remaining.slice(index, index + 300);
            const found = await executeKw<Array<Record<string, unknown>>>(
                credentials,
                uid,
                "product.product",
                "search_read",
                [[["product_tmpl_id", "in", batch]]],
                { fields: ["id", "product_tmpl_id"], order: "id asc", limit: 10000, context: { active_test: false } }
            );
            variantsOfTemplates.push(...found);
        }

        const firstVariantByTemplate = new Map<number, number>();
        for (const variant of variantsOfTemplates) {
            const variantId = Number(variant.id ?? 0);
            const templateId = getRelationalId(variant.product_tmpl_id);
            if (variantId > 0 && typeof templateId === "number" && templateId > 0 && !firstVariantByTemplate.has(templateId)) {
                firstVariantByTemplate.set(templateId, variantId);
            }
        }
        for (const templateId of remaining) {
            const variantId = firstVariantByTemplate.get(templateId);
            if (variantId) {
                result.set(templateId, { templateId, variantId });
            }
        }
    }

    return result;
}

export async function getNearExpiryProducts(
    credentials: OdooCredentials,
    thresholdDays: number
): Promise<NearExpiryProduct[]> {
    const uid = await authenticate(credentials);
    const safeThresholdDays = Number.isFinite(thresholdDays)
        ? Math.max(1, Math.min(365, Math.floor(thresholdDays)))
        : 30;

    const candidateDateFields = ["expiration_date", "life_date", "use_date", "removal_date"];
    const candidateQtyFields = ["product_qty", "quantity"];

    const lotModels = ["stock.production.lot", "stock.lot"];
    let lotModel = lotModels[0];
    let fields: Record<string, { string?: string }> | null = null;
    let modelDetectionError: string | null = null;

    for (const model of lotModels) {
        try {
            const detectedFields = await executeKw<Record<string, { string?: string }>>(
                credentials,
                uid,
                model,
                "fields_get",
                [
                    [
                        ...candidateDateFields,
                        ...candidateQtyFields,
                        "name",
                        "product_id",
                    ],
                ],
                {
                    attributes: ["string"],
                }
            );

            lotModel = model;
            fields = detectedFields;
            modelDetectionError = null;
            break;
        } catch (error) {
            modelDetectionError = error instanceof Error ? error.message : String(error);
        }
    }

    if (!fields) {
        throw new Error(modelDetectionError ?? "Could not detect Odoo lot model.");
    }

    const dateField = candidateDateFields.find((fieldName) => Boolean(fields[fieldName]));
    if (!dateField) {
        throw new Error("Odoo lot expiry fields are not available (expiration_date/life_date/use_date/removal_date).");
    }

    const qtyField = candidateQtyFields.find((fieldName) => Boolean(fields[fieldName]));
    const start = new Date();
    const end = new Date(start.getTime() + safeThresholdDays * 24 * 60 * 60 * 1000);
    const startBoundary = formatOdooDateTime(start);
    const endBoundary = formatOdooDateTime(end);

    const domain: Array<Array<string | number | boolean>> = [
        [dateField, ">=", startBoundary],
        [dateField, "<=", endBoundary],
        ["product_id", "!=", false],
    ];

    if (qtyField) {
        domain.push([qtyField, ">", 0]);
    }

    const requestedFields = ["id", "name", "product_id", dateField];
    if (qtyField) {
        requestedFields.push(qtyField);
    }

    const lots = await executeKw<Array<Record<string, unknown>>>(
        credentials,
        uid,
        lotModel,
        "search_read",
        [domain],
        {
            fields: requestedFields,
            order: `${dateField} asc`,
            limit: 1000,
        }
    );

    const nowMs = Date.now();
    return lots
        .map((lot) => {
            const expirationDate = toDisplayString(lot[dateField]);
            const parsedExpiry = Date.parse(expirationDate.replace(" ", "T"));
            const daysUntilExpiry = Number.isFinite(parsedExpiry)
                ? Math.ceil((parsedExpiry - nowMs) / (1000 * 60 * 60 * 24))
                : 0;

            return {
                lotId: Number(lot.id ?? 0),
                lotName: toDisplayString(lot.name) || "-",
                productId: getRelationalId(lot.product_id) ?? 0,
                productName: getRelationalName(lot.product_id) || "-",
                expirationDate,
                quantity: qtyField ? Number(lot[qtyField] ?? 0) : 0,
                daysUntilExpiry,
            };
        })
        .filter((lot) => lot.lotId > 0 && lot.productId > 0)
        .sort((left, right) => left.daysUntilExpiry - right.daysUntilExpiry);
}

export async function getSalespersonActivityReport(
    credentials: OdooCredentials,
    input: {
        salespersonId: number;
        startDate: string;
        endDate: string;
    }
): Promise<SalespersonActivityReport> {
    const uid = await authenticate(credentials);
    const salespersonId = Number(input.salespersonId);
    const startDate = input.startDate;
    const endDate = input.endDate;

    if (!Number.isFinite(salespersonId) || salespersonId <= 0) {
        throw new Error("A valid salesperson is required.");
    }

    ensureDateRange(startDate, endDate);
    const partnerFields = await getAvailablePartnerFields(credentials, uid);

    const [salespeople, servicedOrders, assignedPartners, crmLeads] = await Promise.all([
        getSalespeople(credentials),
        executeKw<Array<Record<string, unknown>>>(
            credentials,
            uid,
            "sale.order",
            "search_read",
            [[
                ["user_id", "=", salespersonId],
                ["state", "in", ["sale", "done"]],
                ["partner_id", "!=", false],
                ["date_order", ">=", toOdooDateBoundary(startDate, false)],
                ["date_order", "<=", toOdooDateBoundary(endDate, true)],
            ]],
            {
                fields: ["id", "name", "partner_id", "amount_total", "date_order"],
                order: "date_order desc",
                limit: 20000,
            }
        ),
        executeKw<Array<Record<string, unknown>>>(
            credentials,
            uid,
            "res.partner",
            "search_read",
            [[
                ["user_id", "=", salespersonId],
                ["customer_rank", ">", 0],
                ["active", "=", true],
            ]],
            {
                fields: partnerFields,
                order: "name asc",
                limit: 20000,
            }
        ),
        executeKw<Array<Record<string, unknown>>>(
            credentials,
            uid,
            "crm.lead",
            "search_read",
            [[
                ["user_id", "=", salespersonId],
                ["partner_id", "!=", false],
                ["active", "=", true],
            ]],
            {
                fields: ["id", "name", "partner_id", "date_open", "create_date", "write_date"],
                order: "write_date desc",
                limit: 20000,
            }
        ),
    ]);

    const salesperson = salespeople.find((item) => item.id === salespersonId);
    if (!salesperson) {
        throw new Error("Selected salesperson was not found in Odoo.");
    }

    const relevantPartnerIds = [
        ...servicedOrders.map((order) => getRelationalId(order.partner_id) ?? 0),
        ...assignedPartners.map((partner) => Number(partner.id ?? 0)),
        ...crmLeads.map((lead) => getRelationalId(lead.partner_id) ?? 0),
    ];

    const canonicalCustomerMap = await getCanonicalCustomerMap(credentials, uid, relevantPartnerIds);

    const servicedByCustomerId = new Map<number, ServicedCustomerRow>();
    for (const order of servicedOrders) {
        const partnerId = getRelationalId(order.partner_id);
        if (!partnerId) {
            continue;
        }

        const customer = canonicalCustomerMap.get(partnerId);
        if (!customer) {
            continue;
        }

        const summary = toCustomerSummary(customer, salesperson.name);
        const key = summary.customerId;
        const existing = servicedByCustomerId.get(key);
        const orderAmount = Number(order.amount_total ?? 0);
        const lastSaleDate = normalizeOdooDate(order.date_order);

        if (!existing) {
            servicedByCustomerId.set(key, {
                ...summary,
                orderCount: 1,
                totalSales: Number(orderAmount.toFixed(2)),
                lastSaleDate,
            });
            continue;
        }

        existing.orderCount += 1;
        existing.totalSales = Number((existing.totalSales + orderAmount).toFixed(2));
        if (lastSaleDate > existing.lastSaleDate) {
            existing.lastSaleDate = lastSaleDate;
        }
    }

    const visitRangeStart = toOdooDateBoundary(startDate, false);
    const visitRangeEnd = toOdooDateBoundary(endDate, true);
    const visitedByCustomerId = new Map<number, VisitedCustomerRow>();
    for (const lead of crmLeads) {
        const partnerId = getRelationalId(lead.partner_id);
        if (!partnerId) {
            continue;
        }

        const activityDate = normalizeOdooDate(lead.date_open) || normalizeOdooDate(lead.write_date) || normalizeOdooDate(lead.create_date);
        if (!activityDate || !isWithinRange(activityDate, visitRangeStart, visitRangeEnd)) {
            continue;
        }

        const customer = canonicalCustomerMap.get(partnerId);
        if (!customer) {
            continue;
        }

        const summary = toCustomerSummary(customer, salesperson.name);
        const key = summary.customerId;
        const existing = visitedByCustomerId.get(key);

        if (!existing) {
            visitedByCustomerId.set(key, {
                ...summary,
                visitCount: 1,
                lastVisitDate: activityDate,
                crmReference: toDisplayString(lead.name),
            });
            continue;
        }

        existing.visitCount += 1;
        if (activityDate > existing.lastVisitDate) {
            existing.lastVisitDate = activityDate;
            existing.crmReference = toDisplayString(lead.name);
        }
    }

    const servicedIds = new Set(servicedByCustomerId.keys());
    const visitedIds = new Set(visitedByCustomerId.keys());
    const latestVisitByCustomerId = new Map<number, string>();
    for (const lead of crmLeads) {
        const partnerId = getRelationalId(lead.partner_id);
        if (!partnerId) {
            continue;
        }

        const customer = canonicalCustomerMap.get(partnerId);
        if (!customer) {
            continue;
        }

        const summary = toCustomerSummary(customer, salesperson.name);
        const activityDate =
            normalizeOdooDate(lead.date_open) ||
            normalizeOdooDate(lead.write_date) ||
            normalizeOdooDate(lead.create_date);

        if (!activityDate) {
            continue;
        }

        const existing = latestVisitByCustomerId.get(summary.customerId);
        if (!existing || activityDate > existing) {
            latestVisitByCustomerId.set(summary.customerId, activityDate);
        }
    }

    const inactiveByCustomerId = new Map<number, InactiveCustomerRow>();
    for (const partner of assignedPartners) {
        const partnerId = Number(partner.id ?? 0);
        const customer = canonicalCustomerMap.get(partnerId) ?? partner;
        const summary = toCustomerSummary(customer, salesperson.name);

        if (servicedIds.has(summary.customerId) || visitedIds.has(summary.customerId)) {
            continue;
        }

        if (!inactiveByCustomerId.has(summary.customerId)) {
            inactiveByCustomerId.set(summary.customerId, {
                ...summary,
                lastVisitDate: latestVisitByCustomerId.get(summary.customerId) ?? "",
            });
        }
    }

    return {
        salesperson,
        startDate,
        endDate,
        servicedCustomers: Array.from(servicedByCustomerId.values()).sort(
            (a, b) => b.totalSales - a.totalSales || a.customerName.localeCompare(b.customerName)
        ),
        visitedCustomers: Array.from(visitedByCustomerId.values()).sort(
            (a, b) => b.lastVisitDate.localeCompare(a.lastVisitDate) || a.customerName.localeCompare(b.customerName)
        ),
        inactiveAssignedCustomers: Array.from(inactiveByCustomerId.values()).sort((a, b) =>
            a.customerName.localeCompare(b.customerName)
        ),
    };
}

export async function getCustomerReport(
    credentials: OdooCredentials,
    customerId: number
): Promise<CustomerReport> {
    const uid = await authenticate(credentials);
    const parsedCustomerId = Number(customerId);

    if (!Number.isFinite(parsedCustomerId) || parsedCustomerId <= 0) {
        throw new Error("A valid customer is required.");
    }

    const customer = await getCommercialPartner(credentials, uid, parsedCustomerId);
    const commercialPartnerId = Number(customer.id ?? 0);
    const customerSummary = toCustomerSummary(customer, getRelationalName(customer.user_id));

    const [confirmedOrders, openQuotationCount, latestVisit, brandField] = await Promise.all([
        executeKw<Array<Record<string, unknown>>>(
            credentials,
            uid,
            "sale.order",
            "search_read",
            [[
                ["partner_id", "child_of", commercialPartnerId],
                ["state", "in", ["sale", "done"]],
            ]],
            {
                fields: ["id", "amount_total"],
                order: "date_order desc",
                limit: 20000,
            }
        ),
        executeKw<number>(
            credentials,
            uid,
            "sale.order",
            "search_count",
            [[
                ["partner_id", "child_of", commercialPartnerId],
                ["state", "in", ["draft", "sent"]],
            ]]
        ),
        executeKw<Array<Record<string, unknown>>>(
            credentials,
            uid,
            "crm.lead",
            "search_read",
            [[
                ["partner_id", "child_of", commercialPartnerId],
                ["active", "=", true],
            ]],
            {
                fields: ["name", "date_open", "create_date", "write_date", "user_id"],
                order: "write_date desc",
                limit: 1,
            }
        ),
        getPreferredBrandField(credentials, uid),
    ]);

    const totalSales = Number(
        confirmedOrders
            .reduce((sum, order) => sum + Number(order.amount_total ?? 0), 0)
            .toFixed(2)
    );

    const saleLines = await executeKw<Array<Record<string, unknown>>>(
        credentials,
        uid,
        "sale.order.line",
        "search_read",
        [[
            ["order_id.partner_id", "child_of", commercialPartnerId],
            ["order_id.state", "in", ["sale", "done"]],
            ["display_type", "=", false],
            ["product_id", "!=", false],
        ]],
        {
            fields: ["product_id", "product_uom_qty", "price_subtotal"],
            limit: 50000,
        }
    );

    const productIds = Array.from(
        new Set(
            saleLines
                .map((line) => getRelationalId(line.product_id))
                .filter((id): id is number => typeof id === "number")
        )
    );

    const products = productIds.length > 0
        ? await executeKw<Array<Record<string, unknown>>>(
            credentials,
            uid,
            "product.product",
            "read",
            [productIds],
            {
                fields: ["id", "product_tmpl_id"],
            }
        )
        : [];

    const templateIds = Array.from(
        new Set(
            products
                .map((product) => getRelationalId(product.product_tmpl_id))
                .filter((id): id is number => typeof id === "number")
        )
    );

    const templates = templateIds.length > 0
        ? await executeKw<Array<Record<string, unknown>>>(
            credentials,
            uid,
            "product.template",
            "read",
            [templateIds],
            {
                fields: ["id", brandField.fieldName],
            }
        )
        : [];

    const templateById = new Map<number, Record<string, unknown>>();
    for (const template of templates) {
        templateById.set(Number(template.id ?? 0), template);
    }

    const productToTemplateId = new Map<number, number>();
    for (const product of products) {
        const productId = Number(product.id ?? 0);
        const templateId = getRelationalId(product.product_tmpl_id);
        if (productId > 0 && templateId) {
            productToTemplateId.set(productId, templateId);
        }
    }

    const brandMap = new Map<string, CustomerBrandSummary>();
    for (const line of saleLines) {
        const productId = getRelationalId(line.product_id);
        if (!productId) {
            continue;
        }

        const templateId = productToTemplateId.get(productId);
        const template = typeof templateId === "number" ? templateById.get(templateId) : undefined;
        const brandValue = template?.[brandField.fieldName];
        const brandName = getRelationalName(brandValue) || toDisplayString(brandValue) || `Unknown ${brandField.label}`;
        const quantity = Number(line.product_uom_qty ?? 0);
        const sales = Number(line.price_subtotal ?? 0);
        const existing = brandMap.get(brandName);

        if (!existing) {
            brandMap.set(brandName, {
                brandName,
                quantitySold: Number(quantity.toFixed(2)),
                totalSales: Number(sales.toFixed(2)),
            });
            continue;
        }

        existing.quantitySold = Number((existing.quantitySold + quantity).toFixed(2));
        existing.totalSales = Number((existing.totalSales + sales).toFixed(2));
    }

    const lastVisit = latestVisit[0];
    const lastVisitDate =
        normalizeOdooDate(lastVisit?.date_open) ||
        normalizeOdooDate(lastVisit?.write_date) ||
        normalizeOdooDate(lastVisit?.create_date);

    return {
        customer: customerSummary,
        totalSales,
        lastVisitDate,
        lastVisitReference: toDisplayString(lastVisit?.name),
        lastVisitSalespersonName: getRelationalName(lastVisit?.user_id),
        openQuotationCount,
        topBrands: Array.from(brandMap.values())
            .sort((a, b) => b.totalSales - a.totalSales || b.quantitySold - a.quantitySold)
            .slice(0, 10),
    };
}

export async function getSalespersonMonthlyInvoices(
    credentials: OdooCredentials,
    input: {
        salespersonId: number;
        year: number;
        month: number;
        includeCreditNotes?: boolean;
    }
): Promise<SalespersonMonthlyInvoices> {
    const uid = await authenticate(credentials);
    const salespersonId = Number(input.salespersonId);
    const year = Number(input.year);
    const month = Number(input.month);

    if (!Number.isFinite(salespersonId) || salespersonId <= 0) {
        throw new Error("A valid salesperson is required.");
    }

    if (!Number.isFinite(year) || year < 2000 || year > 2100) {
        throw new Error("A valid year is required.");
    }

    if (!Number.isFinite(month) || month < 1 || month > 12) {
        throw new Error("A valid month is required.");
    }

    const [salespeople, salespersonField] = await Promise.all([
        getSalespeople(credentials),
        getInvoiceSalespersonField(credentials, uid),
    ]);

    const salesperson = salespeople.find((item) => item.id === salespersonId);
    if (!salesperson) {
        throw new Error("Selected salesperson was not found in Odoo.");
    }

    const { startDate, endDate } = getMonthDateRange(year, month);
    const invoices = await executeKw<Array<Record<string, unknown>>>(
        credentials,
        uid,
        "account.move",
        "search_read",
        [[
            [salespersonField, "=", salespersonId],
            ["move_type", "=", "out_invoice"],
            ["state", "=", "posted"],
            ["invoice_date", ">=", startDate],
            ["invoice_date", "<=", endDate],
        ]],
        {
            fields: ["id", "amount_total", "currency_id"],
            order: "invoice_date desc",
            limit: 20000,
        }
    );

    const invoiceIds = invoices
        .map((invoice) => Number(invoice.id ?? 0))
        .filter((id) => Number.isFinite(id) && id > 0);

    // Invoices can be raised in different transaction currencies — even within
    // the same company — so group by each invoice's own currency and raw
    // amount instead of blending mismatched currencies (or silently
    // converting them) into one number.
    const invoiceTransactionAmounts = getInvoiceTransactionAmounts(invoices);
    const primaryCurrencyId = await getPrimaryCurrencyId(
        credentials,
        uid,
        Array.from(invoiceTransactionAmounts.values())
    );
    const primaryCurrencyCode =
        (primaryCurrencyId &&
            Array.from(invoiceTransactionAmounts.values()).find((amount) => amount.currencyId === primaryCurrencyId)
                ?.currencyCode) ||
        TARGET_CURRENCY_CODE;

    // The "total cards" (Posted Invoice Total, Target Status, Progress Bar)
    // show one blended figure in the primary currency: every non-primary
    // invoice is converted using the exchange rate already configured under
    // Accounting > Currencies for the home company (not a re-estimated rate).
    // The per-currency breakdown (`currencyTotals`) stays untouched/raw — this
    // only affects the blended totals.
    const homeCompanyId = await getHomeCompanyId(credentials, uid);
    const nonPrimaryCurrencyIds = Array.from(
        new Set(
            Array.from(invoiceTransactionAmounts.values())
                .map((entry) => entry.currencyId)
                .filter((currencyId) => currencyId !== primaryCurrencyId)
        )
    );
    const todayStr = new Date().toISOString().slice(0, 10);
    const rateByCurrencyId = homeCompanyId
        ? await getCurrencyRatesToHomeCurrency(credentials, uid, homeCompanyId, nonPrimaryCurrencyIds, todayStr)
        : new Map<number, number>();
    const multiplierByCurrencyId = buildCurrencyMultipliers(primaryCurrencyId, rateByCurrencyId);

    const currencyTotals = buildCurrencyTotals(Array.from(invoiceTransactionAmounts.values()), multiplierByCurrencyId);

    // Invoices in a currency with no configured rate can't be converted —
    // exclude them from the blended totals rather than guess.
    const convertibleInvoiceIds = invoiceIds.filter((id) => {
        const currencyId = invoiceTransactionAmounts.get(id)?.currencyId;
        return typeof currencyId === "number" && multiplierByCurrencyId.has(currencyId);
    });

    const totalInvoiced = Number(
        convertibleInvoiceIds
            .reduce((sum, id) => {
                const entry = invoiceTransactionAmounts.get(id);
                if (!entry) {
                    return sum;
                }
                const multiplier = multiplierByCurrencyId.get(entry.currencyId) ?? 0;
                return sum + entry.amount * multiplier;
            }, 0)
            .toFixed(2)
    );

    let creditNoteTotal = 0;
    let creditNoteIds: number[] = [];
    let creditNoteCurrencyTotals: CurrencyTotal[] = [];
    let creditNoteTransactionAmounts = new Map<number, { currencyId: number; currencyCode: string; amount: number }>();
    let creditNoteMultiplierByCurrencyId = new Map<number, number>();

    if (input.includeCreditNotes) {
        const creditNotes = await executeKw<Array<Record<string, unknown>>>(
            credentials,
            uid,
            "account.move",
            "search_read",
            [[
                [salespersonField, "=", salespersonId],
                ["move_type", "=", "out_refund"],
                ["state", "=", "posted"],
                ["invoice_date", ">=", startDate],
                ["invoice_date", "<=", endDate],
            ]],
            {
                fields: ["id", "amount_total", "currency_id"],
                limit: 20000,
            }
        );

        creditNoteTransactionAmounts = getInvoiceTransactionAmounts(creditNotes);
        // Credit note amounts are refunds against revenue: take the absolute
        // value, matching how `creditNoteTotal` was computed before.
        const absoluteCreditAmounts = Array.from(creditNoteTransactionAmounts.values()).map((entry) => ({
            ...entry,
            amount: Math.abs(entry.amount),
        }));

        const creditNoteNonPrimaryCurrencyIds = Array.from(
            new Set(
                absoluteCreditAmounts
                    .map((entry) => entry.currencyId)
                    .filter((currencyId) => !multiplierByCurrencyId.has(currencyId))
            )
        );
        const creditNoteRateByCurrencyId = homeCompanyId && creditNoteNonPrimaryCurrencyIds.length > 0
            ? await getCurrencyRatesToHomeCurrency(
                credentials,
                uid,
                homeCompanyId,
                creditNoteNonPrimaryCurrencyIds,
                todayStr
            )
            : new Map<number, number>();
        creditNoteMultiplierByCurrencyId = new Map([
            ...multiplierByCurrencyId,
            ...buildCurrencyMultipliers(null, creditNoteRateByCurrencyId),
        ]);

        creditNoteCurrencyTotals = buildCurrencyTotals(absoluteCreditAmounts, creditNoteMultiplierByCurrencyId);

        creditNoteTotal = Number(
            absoluteCreditAmounts
                .reduce((sum, entry) => {
                    const multiplier = creditNoteMultiplierByCurrencyId.get(entry.currencyId);
                    return multiplier ? sum + entry.amount * multiplier : sum;
                }, 0)
                .toFixed(2)
        );

        creditNoteIds = creditNotes
            .map((note) => Number(note.id ?? 0))
            .filter((id) => Number.isFinite(id) && id > 0)
            .filter((id) => {
                const currencyId = creditNoteTransactionAmounts.get(id)?.currencyId;
                return typeof currencyId === "number" && creditNoteMultiplierByCurrencyId.has(currencyId);
            });
    }

    let brandTotals: Array<{ brandId: number; totalInvoiced: number }> = [];
    let brandBySaleLineId = new Map<number, number>();
    const qualifiedInvoiceIdSet = new Set<number>(convertibleInvoiceIds);
    let invoiceLineCountFetched = 0;
    let invoiceLineCountQualified = 0;
    let productCountFetched = 0;
    let productCountMappedToBrand = 0;

    if (convertibleInvoiceIds.length > 0) {
        const invoiceLines = await executeKw<Array<Record<string, unknown>>>(
            credentials,
            uid,
            "account.move.line",
            "search_read",
            [[
                ["move_id", "in", convertibleInvoiceIds],
                ["sale_line_ids", "!=", false],
            ]],
            {
                fields: ["move_id", "sale_line_ids", "price_total", "display_type"],
                limit: 200000,
            }
        );
        invoiceLineCountFetched = invoiceLines.length;

        const qualifiedInvoiceLines = invoiceLines.filter((line) => {
            const invoiceId = getRelationalId(line.move_id);
            if (!invoiceId || !qualifiedInvoiceIdSet.has(invoiceId)) {
                return false;
            }

            return true;
        });

        invoiceLineCountQualified = qualifiedInvoiceLines.length;

        const saleLineIds = Array.from(
            new Set(
                qualifiedInvoiceLines
                    .flatMap((line) => normalizeRelationalIdList(line.sale_line_ids))
            )
        );

        const saleLines = saleLineIds.length > 0
            ? await executeKw<Array<Record<string, unknown>>>(
                credentials,
                uid,
                "sale.order.line",
                "read",
                [saleLineIds],
                {
                    fields: ["id", "product_id"],
                }
            )
            : [];

        const productIds = Array.from(
            new Set(
                saleLines
                    .map((line) => getRelationalId(line.product_id))
                    .filter((id): id is number => typeof id === "number")
            )
        );

        const products = productIds.length > 0
            ? await executeKw<Array<Record<string, unknown>>>(
                credentials,
                uid,
                "product.product",
                "read",
                [productIds],
                {
                    fields: ["id", "product_tmpl_id"],
                }
            )
            : [];
        productCountFetched = products.length;

        // Brand lives only on product.template (tire_brand, a many2one to the
        // flat tire.brand model — no hierarchy, unlike product categories).
        const templateIds = Array.from(
            new Set(
                products
                    .map((product) => getRelationalId(product.product_tmpl_id))
                    .filter((id): id is number => typeof id === "number" && id > 0)
            )
        );

        const templates = templateIds.length > 0
            ? await executeKw<Array<Record<string, unknown>>>(
                credentials,
                uid,
                "product.template",
                "read",
                [templateIds],
                {
                    fields: ["id", "tire_brand"],
                }
            )
            : [];

        const brandByTemplateId = new Map<number, number>();
        for (const template of templates) {
            const templateId = Number(template.id ?? 0);
            const brandId = getRelationalId(template.tire_brand);
            if (templateId > 0 && typeof brandId === "number" && brandId > 0) {
                brandByTemplateId.set(templateId, brandId);
            }
        }

        const brandByProductId = new Map<number, number>();
        for (const product of products) {
            const productId = Number(product.id ?? 0);
            const templateId = getRelationalId(product.product_tmpl_id);
            const brandId = typeof templateId === "number" ? brandByTemplateId.get(templateId) : undefined;

            if (productId > 0 && typeof brandId === "number" && brandId > 0) {
                brandByProductId.set(productId, brandId);
            }
        }
        productCountMappedToBrand = brandByProductId.size;

        brandBySaleLineId = new Map<number, number>();
        for (const saleLine of saleLines) {
            const saleLineId = Number(saleLine.id ?? 0);
            const productId = getRelationalId(saleLine.product_id);
            if (!Number.isFinite(saleLineId) || saleLineId <= 0 || !productId) {
                continue;
            }

            const brandId = brandByProductId.get(productId);
            if (typeof brandId === "number" && brandId > 0) {
                brandBySaleLineId.set(saleLineId, brandId);
            }
        }

        const totalsByBrand = new Map<number, number>();
        for (const line of qualifiedInvoiceLines) {
            const linkedSaleLineIds = normalizeRelationalIdList(line.sale_line_ids);

            const linkedBrandIds = Array.from(
                new Set(
                    linkedSaleLineIds
                        .map((saleLineId) => brandBySaleLineId.get(saleLineId))
                        .filter((brandId): brandId is number => typeof brandId === "number" && brandId > 0)
                )
            );

            if (linkedBrandIds.length === 0) {
                continue;
            }

            // `price_total` is in the invoice's own currency_id — convert it to
            // the primary currency using that currency's configured rate.
            const invoiceId = getRelationalId(line.move_id);
            const invoiceCurrencyId = invoiceId ? invoiceTransactionAmounts.get(invoiceId)?.currencyId : undefined;
            const multiplier = invoiceCurrencyId ? multiplierByCurrencyId.get(invoiceCurrencyId) : undefined;
            if (multiplier === undefined) {
                continue;
            }

            const lineAmount = Number(line.price_total ?? 0) * multiplier;
            if (!Number.isFinite(lineAmount)) {
                continue;
            }

            const splitAmount = lineAmount / linkedBrandIds.length;

            for (const brandId of linkedBrandIds) {
                const current = totalsByBrand.get(brandId) ?? 0;
                totalsByBrand.set(brandId, current + splitAmount);
            }
        }

        brandTotals = Array.from(totalsByBrand.entries())
            .map(([brandId, total]) => ({
                brandId,
                totalInvoiced: Number(total.toFixed(2)),
            }))
            .sort((a, b) => b.totalInvoiced - a.totalInvoiced);
    }

    let creditNoteBrandTotals: Array<{ brandId: number; totalInvoiced: number }> = [];

    if (input.includeCreditNotes && creditNoteIds.length > 0 && brandBySaleLineId.size > 0) {
        const creditNoteLines = await executeKw<Array<Record<string, unknown>>>(
            credentials,
            uid,
            "account.move.line",
            "search_read",
            [[
                ["move_id", "in", creditNoteIds],
                ["sale_line_ids", "!=", false],
            ]],
            {
                fields: ["move_id", "sale_line_ids", "price_total", "display_type"],
                limit: 200000,
            }
        );

        const qualifiedCreditNoteLineIds = new Set(
            creditNoteLines
                .filter((line) => creditNoteIds.includes(getRelationalId(line.move_id) ?? 0))
                .map((line) => Number(line.id ?? 0))
        );

        const qualifiedCreditNoteLines = creditNoteLines.filter((line) =>
            qualifiedCreditNoteLineIds.has(Number(line.id ?? 0))
        );

        const creditNoteTotalsByBrand = new Map<number, number>();
        for (const line of qualifiedCreditNoteLines) {
            const linkedSaleLineIds = normalizeRelationalIdList(line.sale_line_ids);

            const linkedBrandIds = Array.from(
                new Set(
                    linkedSaleLineIds
                        .map((saleLineId) => brandBySaleLineId.get(saleLineId))
                        .filter((brandId): brandId is number => typeof brandId === "number" && brandId > 0)
                )
            );

            if (linkedBrandIds.length === 0) {
                continue;
            }

            const creditNoteId = getRelationalId(line.move_id);
            const creditNoteCurrencyId = creditNoteId
                ? creditNoteTransactionAmounts.get(creditNoteId)?.currencyId
                : undefined;
            const multiplier = creditNoteCurrencyId
                ? creditNoteMultiplierByCurrencyId.get(creditNoteCurrencyId)
                : undefined;
            if (multiplier === undefined) {
                continue;
            }

            const lineAmount = Math.abs(Number(line.price_total ?? 0) * multiplier);
            if (!Number.isFinite(lineAmount)) {
                continue;
            }

            const splitAmount = lineAmount / linkedBrandIds.length;

            for (const brandId of linkedBrandIds) {
                const current = creditNoteTotalsByBrand.get(brandId) ?? 0;
                creditNoteTotalsByBrand.set(brandId, current + splitAmount);
            }
        }

        creditNoteBrandTotals = Array.from(creditNoteTotalsByBrand.entries())
            .map(([brandId, total]) => ({
                brandId,
                totalInvoiced: Number(total.toFixed(2)),
            }))
            .sort((a, b) => b.totalInvoiced - a.totalInvoiced);
    }

    return {
        salesperson,
        year,
        month,
        totalInvoiced,
        creditNoteTotal,
        invoiceCount: qualifiedInvoiceIdSet.size,
        primaryCurrencyCode,
        currencyTotals,
        creditNoteCurrencyTotals,
        brandTotals,
        creditNoteBrandTotals,
        debug: {
            invoiceCountFetched: invoices.length,
            invoiceCountQualified: qualifiedInvoiceIdSet.size,
            invoiceLineCountFetched,
            invoiceLineCountQualified,
            productCountFetched,
            productCountMappedToBrand,
            brandTotalCount: brandTotals.length,
        },
    };
}

export async function getSalesTargetDetails(
    credentials: OdooCredentials,
    input: {
        salespersonId: number;
        year: number;
        month: number;
        brandId: number;
    }
): Promise<SalesTargetDetailsReport> {
    const uid = await authenticate(credentials);
    const salespersonId = Number(input.salespersonId);
    const year = Number(input.year);
    const month = Number(input.month);
    const brandId = Number(input.brandId);

    if (!Number.isFinite(salespersonId) || salespersonId <= 0) {
        throw new Error("A valid salesperson is required.");
    }

    if (!Number.isFinite(year) || year < 2000 || year > 2100) {
        throw new Error("A valid year is required.");
    }

    if (!Number.isFinite(month) || month < 1 || month > 12) {
        throw new Error("A valid month is required.");
    }

    if (!Number.isFinite(brandId) || brandId <= 0) {
        throw new Error("A valid product brand is required.");
    }

    const [salespeople, brands] = await Promise.all([
        getSalespeople(credentials),
        executeKw<Array<Record<string, unknown>>>(
            credentials,
            uid,
            "tire.brand",
            "read",
            [[brandId]],
            {
                fields: ["id", "name"],
            }
        ),
    ]);

    const salesperson = salespeople.find((item) => item.id === salespersonId);
    if (!salesperson) {
        throw new Error("Selected salesperson was not found in Odoo.");
    }

    const brand = brands[0];
    if (!brand) {
        throw new Error("Selected brand was not found in Odoo.");
    }

    // Sales targets are entered in a single currency (see getPrimaryCurrencyId).
    // Orders in a different currency are converted using the exchange rate
    // already configured under Accounting > Currencies for the home company —
    // matching how the main sales-target report now blends its totals — and
    // are only broken out separately (`otherCurrencyTotals`) if no rate is
    // configured for that currency.
    const primaryCurrencyId = await getPrimaryCurrencyId(credentials, uid, []);
    const homeCompanyId = await getHomeCompanyId(credentials, uid);

    const { startDate, endDate } = getMonthDateRange(year, month);
    const from = toOdooDateBoundary(startDate, false);
    const to = toOdooDateBoundary(endDate, true);

    const lines = await executeKw<Array<Record<string, unknown>>>(
        credentials,
        uid,
        "sale.order.line",
        "search_read",
        [[
            ["order_id.user_id", "=", salespersonId],
            ["order_id.state", "in", ["sale", "done"]],
            ["order_id.date_order", ">=", from],
            ["order_id.date_order", "<=", to],
            ["display_type", "=", false],
            ["product_id", "!=", false],
            ["order_id.partner_id", "!=", false],
            ["product_id.product_tmpl_id.tire_brand", "=", brandId],
        ]],
        {
            fields: ["id", "product_id", "product_uom_qty", "price_subtotal", "order_id"],
            limit: 200000,
        }
    );

    const orderIds = Array.from(
        new Set(
            lines
                .map((line) => getRelationalId(line.order_id))
                .filter((id): id is number => typeof id === "number" && id > 0)
        )
    );

    const orders = orderIds.length > 0
        ? await executeKw<Array<Record<string, unknown>>>(
            credentials,
            uid,
            "sale.order",
            "read",
            [orderIds],
            {
                fields: ["id", "name", "partner_id", "date_order", "currency_id"],
            }
        )
        : [];

    const orderById = new Map<number, Record<string, unknown>>();
    for (const order of orders) {
        const id = Number(order.id ?? 0);
        if (id > 0) {
            orderById.set(id, order);
        }
    }

    const orderNonPrimaryCurrencyIds = Array.from(
        new Set(
            orders
                .map((order) => getRelationalId(order.currency_id))
                .filter((id): id is number => typeof id === "number" && id !== primaryCurrencyId)
        )
    );
    const todayStr = new Date().toISOString().slice(0, 10);
    const orderRateByCurrencyId = homeCompanyId
        ? await getCurrencyRatesToHomeCurrency(credentials, uid, homeCompanyId, orderNonPrimaryCurrencyIds, todayStr)
        : new Map<number, number>();
    const orderMultiplierByCurrencyId = buildCurrencyMultipliers(primaryCurrencyId, orderRateByCurrencyId);

    const partnerIds = Array.from(
        new Set(
            orders
                .map((order) => getRelationalId(order.partner_id))
                .filter((id): id is number => typeof id === "number" && id > 0)
        )
    );

    const canonicalCustomerMap = await getCanonicalCustomerMap(credentials, uid, partnerIds);

    const productsById = new Map<number, SalesTargetBrandProduct>();
    const orderIdsByProductId = new Map<number, Set<number>>();
    const customersById = new Map<number, SalesTargetBrandCustomer>();
    const orderIdsByCustomerId = new Map<number, Set<number>>();
    const otherCurrencyTotalsByCode = new Map<string, { total: number; orderIds: Set<number> }>();
    const primaryOrderIds = new Set<number>();
    let totalBrandSales = 0;

    for (const line of lines) {
        const productId = getRelationalId(line.product_id);
        const orderId = getRelationalId(line.order_id);
        if (!productId || !orderId) {
            continue;
        }

        const order = orderById.get(orderId);
        if (!order) {
            continue;
        }

        const partnerId = getRelationalId(order.partner_id);
        if (!partnerId) {
            continue;
        }

        const customer = canonicalCustomerMap.get(partnerId);
        if (!customer) {
            continue;
        }

        const quantity = Number(line.product_uom_qty ?? 0);
        const rawLineSales = Number(line.price_subtotal ?? 0);

        // Orders in a currency with no configured rate can't be converted —
        // break those out separately instead of blending them in unconverted.
        const orderCurrencyId = getRelationalId(order.currency_id);
        const multiplier = orderCurrencyId ? orderMultiplierByCurrencyId.get(orderCurrencyId) : undefined;
        if (multiplier === undefined) {
            const currencyCode = getRelationalName(order.currency_id) || "?";
            const existing = otherCurrencyTotalsByCode.get(currencyCode) ?? { total: 0, orderIds: new Set<number>() };
            existing.total += rawLineSales;
            existing.orderIds.add(orderId);
            otherCurrencyTotalsByCode.set(currencyCode, existing);
            continue;
        }

        const lineSales = rawLineSales * multiplier;
        totalBrandSales += lineSales;
        primaryOrderIds.add(orderId);

        const productName = getRelationalName(line.product_id) || `Product #${productId}`;
        const existingProduct = productsById.get(productId);
        if (!existingProduct) {
            productsById.set(productId, {
                productId,
                productName,
                quantitySold: Number(quantity.toFixed(2)),
                totalSales: Number(lineSales.toFixed(2)),
                orderCount: 0,
            });
        } else {
            existingProduct.quantitySold = Number((existingProduct.quantitySold + quantity).toFixed(2));
            existingProduct.totalSales = Number((existingProduct.totalSales + lineSales).toFixed(2));
        }

        const productOrderSet = orderIdsByProductId.get(productId) ?? new Set<number>();
        productOrderSet.add(orderId);
        orderIdsByProductId.set(productId, productOrderSet);

        const summary = toCustomerSummary(customer, salesperson.name);
        const existingCustomer = customersById.get(summary.customerId);
        const orderDate = normalizeOdooDate(order.date_order);

        if (!existingCustomer) {
            customersById.set(summary.customerId, {
                ...summary,
                orderCount: 0,
                totalSales: Number(lineSales.toFixed(2)),
                lastSaleDate: orderDate,
            });
        } else {
            existingCustomer.totalSales = Number((existingCustomer.totalSales + lineSales).toFixed(2));
            if (orderDate > existingCustomer.lastSaleDate) {
                existingCustomer.lastSaleDate = orderDate;
            }
        }

        const customerOrderSet = orderIdsByCustomerId.get(summary.customerId) ?? new Set<number>();
        customerOrderSet.add(orderId);
        orderIdsByCustomerId.set(summary.customerId, customerOrderSet);
    }

    const products = Array.from(productsById.values())
        .map((product) => ({
            ...product,
            orderCount: orderIdsByProductId.get(product.productId)?.size ?? 0,
        }))
        .sort((a, b) => b.totalSales - a.totalSales || b.quantitySold - a.quantitySold);

    const servedCustomers = Array.from(customersById.values())
        .map((customer) => ({
            ...customer,
            orderCount: orderIdsByCustomerId.get(customer.customerId)?.size ?? 0,
        }))
        .sort((a, b) => b.totalSales - a.totalSales || a.customerName.localeCompare(b.customerName));

    return {
        salesperson,
        year,
        month,
        brandId,
        brandName: toDisplayString(brand.name) || `Brand #${brandId}`,
        startDate,
        endDate,
        totalBrandSales: Number(totalBrandSales.toFixed(2)),
        primaryCurrencyCode: TARGET_CURRENCY_CODE,
        primaryOrderCount: primaryOrderIds.size,
        otherCurrencyTotals: Array.from(otherCurrencyTotalsByCode.entries())
            .map(([currencyCode, value]) => ({
                currencyCode,
                total: Number(value.total.toFixed(2)),
                orderCount: value.orderIds.size,
            }))
            .sort((a, b) => b.total - a.total),
        products,
        servedCustomers,
    };
}

export async function getProductCategories(credentials: OdooCredentials): Promise<ProductCategory[]> {
    const uid = await authenticate(credentials);

    let categories: Array<{ id: number; name: string; parent_path?: string }> = [];

    try {
        categories = await executeKw<Array<{ id: number; name: string; parent_path?: string }>>(
            credentials,
            uid,
            "product.category",
            "search_read",
            [[]],
            {
                fields: ["id", "name", "parent_path"],
                order: "name asc",
                limit: 500,
            }
        );
    } catch {
        categories = await executeKw<Array<{ id: number; name: string }>>(
            credentials,
            uid,
            "product.category",
            "search_read",
            [[]],
            {
                fields: ["id", "name"],
                order: "name asc",
                limit: 500,
            }
        );
    }

    return categories.map((category) => ({
        id: Number(category.id),
        name: String(category.name ?? ""),
        model: "product.category",
        parentPath: String(category.parent_path ?? ""),
    }));
}

export async function getBrands(credentials: OdooCredentials): Promise<BrandOption[]> {
    const uid = await authenticate(credentials);

    const brands = await executeKw<Array<{ id: number; name: string }>>(
        credentials,
        uid,
        "tire.brand",
        "search_read",
        [[]],
        {
            fields: ["id", "name"],
            order: "name asc",
            limit: 2000,
        }
    );

    return brands
        .map((brand) => ({
            id: Number(brand.id),
            name: String(brand.name ?? ""),
        }))
        .filter((brand) => brand.id > 0 && brand.name);
}

export async function getPurchaseOrderReport(
    credentials: OdooCredentials,
    input: {
        categoryId?: number | null;
        categoryModel?: "product.public.category" | "product.category";
        brandId?: number | null;
        startDate: string;
        endDate: string;
        stockDurationMonths: number;
    }
): Promise<{ monthsInRange: number; rows: PurchaseOrderReportRow[] }> {
    const uid = await authenticate(credentials);
    const categoryId = Number(input.categoryId);
    const hasCategory = Number.isFinite(categoryId) && categoryId > 0;
    const categoryModel = input.categoryModel ?? "product.public.category";
    const brandId = Number(input.brandId);
    const hasBrand = Number.isFinite(brandId) && brandId > 0;
    const stockDurationMonths = Math.min(Math.max(Number(input.stockDurationMonths) || 1, 1), 12);

    if (!hasCategory && !hasBrand) {
        throw new Error("Select a category or a brand.");
    }

    const startDate = input.startDate;
    const endDate = input.endDate;
    if (!startDate || !endDate) {
        throw new Error("Start date and end date are required.");
    }

    const templateDomain: unknown[] = [];

    if (hasCategory) {
        templateDomain.push(
            categoryModel === "product.category"
                ? ["categ_id", "child_of", categoryId]
                : ["public_categ_ids", "child_of", categoryId]
        );
    }

    if (hasBrand) {
        templateDomain.push(["tire_brand", "=", brandId]);
    }

    const templateIds = await executeKw<number[]>(
        credentials,
        uid,
        "product.template",
        "search",
        [templateDomain],
        { limit: 5000 }
    );

    if (templateIds.length === 0) {
        return { monthsInRange: monthsBetweenInclusive(startDate, endDate), rows: [] };
    }

    const products = await executeKw<Array<{ id: number; display_name?: string; qty_available?: number }>>(
        credentials,
        uid,
        "product.product",
        "search_read",
        [[["product_tmpl_id", "in", templateIds]]],
        {
            fields: ["id", "display_name", "qty_available"],
            limit: 5000,
        }
    );

    const productIds = products.map((product) => Number(product.id)).filter((id) => Number.isFinite(id));
    if (productIds.length === 0) {
        return { monthsInRange: monthsBetweenInclusive(startDate, endDate), rows: [] };
    }

    const from = toOdooDateBoundary(startDate, false);
    const to = toOdooDateBoundary(endDate, true);

    const lines = await executeKw<Array<{ product_id?: [number, string]; product_uom_qty?: number }>>(
        credentials,
        uid,
        "sale.order.line",
        "search_read",
        [[
            ["product_id", "in", productIds],
            ["display_type", "=", false],
            ["order_id.state", "in", ["sale", "done"]],
            ["order_id.date_order", ">=", from],
            ["order_id.date_order", "<=", to],
        ]],
        {
            fields: ["product_id", "product_uom_qty"],
            limit: 20000,
        }
    );

    const soldByProductId = new Map<number, number>();
    for (const line of lines) {
        const productId = line.product_id?.[0];
        if (typeof productId !== "number") {
            continue;
        }

        const qty = Number(line.product_uom_qty ?? 0);
        soldByProductId.set(productId, (soldByProductId.get(productId) ?? 0) + qty);
    }

    const monthsInRange = monthsBetweenInclusive(startDate, endDate);
    const rows = products
        .map((product) => {
            const productId = Number(product.id);
            const soldInPeriod = Number((soldByProductId.get(productId) ?? 0).toFixed(2));
            const currentStock = Number(Number(product.qty_available ?? 0).toFixed(2));
            const averageMonthlySales = Number((soldInPeriod / monthsInRange).toFixed(2));
            const suggestedRestock = Math.max(
                0,
                Number((averageMonthlySales * stockDurationMonths - currentStock).toFixed(2))
            );

            return {
                productId,
                productName: String(product.display_name ?? `Product #${productId}`),
                soldInPeriod,
                currentStock,
                averageMonthlySales,
                suggestedRestock,
                pendingFromBackorders: 0,
            };
        })
        .filter((row) => row.soldInPeriod > 0 || row.suggestedRestock > 0)
        .sort((a, b) => b.suggestedRestock - a.suggestedRestock || b.soldInPeriod - a.soldInPeriod);

    return { monthsInRange: Number(monthsInRange.toFixed(2)), rows };
}

export async function searchPurchaseOrders(
    credentials: OdooCredentials,
    query: string,
    options?: { limit?: number; offset?: number }
): Promise<{ purchaseOrders: PurchaseOrderOption[]; totalCount: number }> {
    const uid = await authenticate(credentials);
    const normalizedQuery = query.trim();
    const limit = Number.isFinite(options?.limit) ? Math.max(1, Math.min(100, Number(options?.limit))) : 20;
    const offset = Number.isFinite(options?.offset) ? Math.max(0, Number(options?.offset)) : 0;

    const domain: unknown[] = [["state", "in", ["purchase", "done"]]];
    if (normalizedQuery) {
        domain.push(["name", "ilike", normalizedQuery]);
    }

    const totalCount = await executeKw<number>(credentials, uid, "purchase.order", "search_count", [domain]);

    const orders = await executeKw<Array<Record<string, unknown>>>(
        credentials,
        uid,
        "purchase.order",
        "search_read",
        [domain],
        {
            fields: ["id", "name", "partner_id", "date_order"],
            order: "date_order desc",
            limit,
            offset,
        }
    );

    return {
        totalCount,
        purchaseOrders: orders.map((order) => ({
            id: Number(order.id),
            name: toDisplayString(order.name) || `PO #${order.id}`,
            vendorName: getRelationalName(order.partner_id),
            dateOrder: toDisplayString(order.date_order),
        })),
    };
}

function emptyProductsPerformanceReport(startDate: string, endDate: string): ProductsPerformanceReport {
    return {
        startDate,
        endDate,
        currencyCode: TARGET_CURRENCY_CODE,
        matchedProductCount: 0,
        rows: [],
        totals: { soldQty: 0, salesValue: 0, purchasedQty: 0, totalStock: 0 },
        unconvertedCurrencyCodes: [],
        purchaseOrderDetails: null,
    };
}

function intersectIdSets(sets: Array<Set<number>>): number[] {
    if (sets.length === 0) {
        return [];
    }

    const [first, ...rest] = sets;
    let result = first;

    for (const set of rest) {
        const next = new Set<number>();
        for (const id of result) {
            if (set.has(id)) {
                next.add(id);
            }
        }
        result = next;
    }

    return Array.from(result);
}

/**
 * Resolves a brand or category filter to the set of product.product ids that
 * belong to it, via product.template (brand and category both live there).
 */
async function getProductIdsForTemplateDomain(
    credentials: OdooCredentials,
    uid: number,
    templateDomain: unknown[]
): Promise<number[]> {
    const templateIds = await executeKw<number[]>(
        credentials,
        uid,
        "product.template",
        "search",
        [templateDomain],
        { limit: 5000 }
    );

    if (templateIds.length === 0) {
        return [];
    }

    return executeKw<number[]>(
        credentials,
        uid,
        "product.product",
        "search",
        [[["product_tmpl_id", "in", templateIds]]],
        { limit: 5000 }
    );
}

const PRODUCTS_PERFORMANCE_MAX_PRODUCTS = 3000;

export async function getProductsPerformanceReport(
    credentials: OdooCredentials,
    input: {
        purchaseOrderId?: number | null;
        productId?: number | null;
        brandId?: number | null;
        categoryId?: number | null;
        startDate: string;
        endDate: string;
    }
): Promise<ProductsPerformanceReport> {
    const uid = await authenticate(credentials);

    const purchaseOrderId = Number(input.purchaseOrderId);
    const hasPurchaseOrder = Number.isFinite(purchaseOrderId) && purchaseOrderId > 0;
    const productId = Number(input.productId);
    const hasProduct = Number.isFinite(productId) && productId > 0;
    const brandId = Number(input.brandId);
    const hasBrand = Number.isFinite(brandId) && brandId > 0;
    const categoryId = Number(input.categoryId);
    const hasCategory = Number.isFinite(categoryId) && categoryId > 0;

    if (!hasPurchaseOrder && !hasProduct && !hasBrand && !hasCategory) {
        throw new Error("Select a purchase order, product, brand, or category.");
    }

    const startDate = input.startDate;
    const endDate = input.endDate;
    if (!startDate || !endDate) {
        throw new Error("Start date and end date are required.");
    }

    // Each active filter narrows the product set independently; the final
    // scope is their intersection (e.g. "brand X from purchase order Y").
    const idSets: Array<Set<number>> = [];
    let purchaseOrderDetails: ProductsPerformancePurchaseOrderDetails | null = null;

    if (hasPurchaseOrder) {
        const [lines, purchaseOrderRecords] = await Promise.all([
            executeKw<Array<Record<string, unknown>>>(
                credentials,
                uid,
                "purchase.order.line",
                "search_read",
                [[["order_id", "=", purchaseOrderId]]],
                { fields: ["product_id"], limit: 5000 }
            ),
            executeKw<Array<Record<string, unknown>>>(
                credentials,
                uid,
                "purchase.order",
                "read",
                [[purchaseOrderId]],
                {
                    fields: [
                        "name",
                        "partner_id",
                        "partner_ref",
                        "date_approve",
                        "date_planned",
                        "effective_date",
                        "picking_type_id",
                    ],
                }
            ),
        ]);

        const purchaseOrderRecord = purchaseOrderRecords[0];
        if (purchaseOrderRecord) {
            purchaseOrderDetails = {
                name: toDisplayString(purchaseOrderRecord.name) || `PO #${purchaseOrderId}`,
                vendorName: getRelationalName(purchaseOrderRecord.partner_id),
                vendorReference: toDisplayString(purchaseOrderRecord.partner_ref),
                confirmationDate: toDisplayString(purchaseOrderRecord.date_approve),
                expectedArrival: toDisplayString(purchaseOrderRecord.date_planned),
                arrival: toDisplayString(purchaseOrderRecord.effective_date),
                deliverTo: getRelationalName(purchaseOrderRecord.picking_type_id),
            };
        }

        const ids = new Set<number>();
        for (const line of lines) {
            const id = getRelationalId(line.product_id);
            if (id) {
                ids.add(id);
            }
        }

        if (ids.size === 0) {
            return emptyProductsPerformanceReport(startDate, endDate);
        }

        idSets.push(ids);
    }

    if (hasProduct) {
        idSets.push(new Set([productId]));
    }

    if (hasBrand) {
        const productIds = await getProductIdsForTemplateDomain(credentials, uid, [["tire_brand", "=", brandId]]);
        if (productIds.length === 0) {
            return emptyProductsPerformanceReport(startDate, endDate);
        }
        idSets.push(new Set(productIds));
    }

    if (hasCategory) {
        const productIds = await getProductIdsForTemplateDomain(credentials, uid, [["categ_id", "child_of", categoryId]]);
        if (productIds.length === 0) {
            return emptyProductsPerformanceReport(startDate, endDate);
        }
        idSets.push(new Set(productIds));
    }

    const finalProductIds = intersectIdSets(idSets).slice(0, PRODUCTS_PERFORMANCE_MAX_PRODUCTS);
    if (finalProductIds.length === 0) {
        return emptyProductsPerformanceReport(startDate, endDate);
    }

    const products = await executeKw<Array<Record<string, unknown>>>(
        credentials,
        uid,
        "product.product",
        "read",
        [finalProductIds],
        { fields: ["id", "display_name", "product_tmpl_id"] }
    );

    const templateIds = Array.from(
        new Set(
            products
                .map((product) => getRelationalId(product.product_tmpl_id))
                .filter((id): id is number => typeof id === "number" && id > 0)
        )
    );

    const templates = templateIds.length > 0
        ? await executeKw<Array<Record<string, unknown>>>(
            credentials,
            uid,
            "product.template",
            "read",
            [templateIds],
            { fields: ["id", "tire_brand", "categ_id"] }
        )
        : [];

    const brandByTemplateId = new Map<number, string>();
    const categoryByTemplateId = new Map<number, string>();
    for (const template of templates) {
        const templateId = Number(template.id ?? 0);
        if (templateId <= 0) {
            continue;
        }

        const brandName = getRelationalName(template.tire_brand);
        if (brandName) {
            brandByTemplateId.set(templateId, brandName);
        }

        const categoryName = getRelationalName(template.categ_id);
        if (categoryName) {
            categoryByTemplateId.set(templateId, categoryName);
        }
    }

    const productInfoById = new Map<number, { name: string; brandName: string; categoryName: string }>();
    for (const product of products) {
        const id = Number(product.id ?? 0);
        if (id <= 0) {
            continue;
        }

        const templateId = getRelationalId(product.product_tmpl_id);
        productInfoById.set(id, {
            name: toDisplayString(product.display_name) || `Product #${id}`,
            brandName: (typeof templateId === "number" ? brandByTemplateId.get(templateId) : undefined) ?? "No Brand",
            categoryName: (typeof templateId === "number" ? categoryByTemplateId.get(templateId) : undefined) ?? "Uncategorized",
        });
    }

    // Sales value is converted to the home currency using the same
    // configured-exchange-rate approach as the sales target reports — a
    // product sold in both AED and USD orders must not have those amounts
    // blended together unconverted.
    const from = toOdooDateBoundary(startDate, false);
    const to = toOdooDateBoundary(endDate, true);

    const saleLines = await executeKw<Array<Record<string, unknown>>>(
        credentials,
        uid,
        "sale.order.line",
        "search_read",
        [[
            ["product_id", "in", finalProductIds],
            ["display_type", "=", false],
            ["order_id.state", "in", ["sale", "done"]],
            ["order_id.date_order", ">=", from],
            ["order_id.date_order", "<=", to],
        ]],
        {
            fields: ["product_id", "product_uom_qty", "price_subtotal", "currency_id"],
            limit: 50000,
        }
    );

    const primaryCurrencyId = await getPrimaryCurrencyId(
        credentials,
        uid,
        saleLines
            .map((line) => getRelationalId(line.currency_id))
            .filter((id): id is number => typeof id === "number")
            .map((currencyId) => ({ currencyId }))
    );
    const homeCompanyId = await getHomeCompanyId(credentials, uid);
    const nonPrimaryCurrencyIds = Array.from(
        new Set(
            saleLines
                .map((line) => getRelationalId(line.currency_id))
                .filter((id): id is number => typeof id === "number" && id !== primaryCurrencyId)
        )
    );
    const todayStr = new Date().toISOString().slice(0, 10);
    const rateByCurrencyId = homeCompanyId
        ? await getCurrencyRatesToHomeCurrency(credentials, uid, homeCompanyId, nonPrimaryCurrencyIds, todayStr)
        : new Map<number, number>();
    const multiplierByCurrencyId = buildCurrencyMultipliers(primaryCurrencyId, rateByCurrencyId);

    const soldQtyByProductId = new Map<number, number>();
    const salesValueByProductId = new Map<number, number>();
    const unconvertedCurrencyCodes = new Set<string>();

    for (const line of saleLines) {
        const id = getRelationalId(line.product_id);
        if (!id) {
            continue;
        }

        const qty = Number(line.product_uom_qty ?? 0);
        soldQtyByProductId.set(id, (soldQtyByProductId.get(id) ?? 0) + qty);

        const currencyId = getRelationalId(line.currency_id);
        const multiplier = currencyId ? multiplierByCurrencyId.get(currencyId) : undefined;
        if (multiplier === undefined) {
            if (currencyId) {
                unconvertedCurrencyCodes.add(getRelationalName(line.currency_id) || "?");
            }
            continue;
        }

        const value = Number(line.price_subtotal ?? 0) * multiplier;
        salesValueByProductId.set(id, (salesValueByProductId.get(id) ?? 0) + value);
    }

    // Purchased qty/value, same currency-safe conversion as sales — vendor POs
    // are just as often raised in a foreign currency as customer invoices.
    const purchaseLines = await executeKw<Array<Record<string, unknown>>>(
        credentials,
        uid,
        "purchase.order.line",
        "search_read",
        [[
            ["product_id", "in", finalProductIds],
            ["order_id.state", "in", ["purchase", "done"]],
            ["order_id.date_order", ">=", from],
            ["order_id.date_order", "<=", to],
        ]],
        {
            fields: ["product_id", "product_qty", "price_subtotal", "currency_id"],
            limit: 50000,
        }
    );

    const purchaseNonPrimaryCurrencyIds = Array.from(
        new Set(
            purchaseLines
                .map((line) => getRelationalId(line.currency_id))
                .filter((id): id is number => typeof id === "number" && !multiplierByCurrencyId.has(id))
        )
    );
    const purchaseRateByCurrencyId = homeCompanyId && purchaseNonPrimaryCurrencyIds.length > 0
        ? await getCurrencyRatesToHomeCurrency(credentials, uid, homeCompanyId, purchaseNonPrimaryCurrencyIds, todayStr)
        : new Map<number, number>();
    const purchaseMultiplierByCurrencyId = new Map([
        ...multiplierByCurrencyId,
        ...buildCurrencyMultipliers(null, purchaseRateByCurrencyId),
    ]);

    const purchasedQtyByProductId = new Map<number, number>();
    const purchaseValueByProductId = new Map<number, number>();

    for (const line of purchaseLines) {
        const id = getRelationalId(line.product_id);
        if (!id) {
            continue;
        }

        const qty = Number(line.product_qty ?? 0);
        purchasedQtyByProductId.set(id, (purchasedQtyByProductId.get(id) ?? 0) + qty);

        const currencyId = getRelationalId(line.currency_id);
        const multiplier = currencyId ? purchaseMultiplierByCurrencyId.get(currencyId) : undefined;
        if (multiplier === undefined) {
            if (currencyId) {
                unconvertedCurrencyCodes.add(getRelationalName(line.currency_id) || "?");
            }
            continue;
        }

        const value = Number(line.price_subtotal ?? 0) * multiplier;
        purchaseValueByProductId.set(id, (purchaseValueByProductId.get(id) ?? 0) + value);
    }

    // Stock on hand is a current snapshot (not date-bound), broken down by
    // warehouse across every company — matching an aging-stock-style report.
    const quants = await executeKw<Array<Record<string, unknown>>>(
        credentials,
        uid,
        "stock.quant",
        "search_read",
        [[
            ["product_id", "in", finalProductIds],
            ["location_id.usage", "=", "internal"],
        ]],
        {
            fields: ["product_id", "quantity", "warehouse_id", "lot_id"],
            limit: 50000,
        }
    );

    const stockByProductId = new Map<number, Map<number, { warehouseName: string; quantity: number }>>();
    const lotNamesByProductId = new Map<number, Set<string>>();
    for (const quant of quants) {
        const productIdForQuant = getRelationalId(quant.product_id);
        const warehouseId = getRelationalId(quant.warehouse_id);
        if (!productIdForQuant || !warehouseId) {
            continue;
        }

        const warehouseName = getRelationalName(quant.warehouse_id) || `Warehouse #${warehouseId}`;
        const quantity = Number(quant.quantity ?? 0);

        const byWarehouse = stockByProductId.get(productIdForQuant) ?? new Map();
        const existing = byWarehouse.get(warehouseId);
        if (existing) {
            existing.quantity += quantity;
        } else {
            byWarehouse.set(warehouseId, { warehouseName, quantity });
        }
        stockByProductId.set(productIdForQuant, byWarehouse);

        // Only lots that currently hold on-hand stock — not every lot ever
        // created for the product (which could include long-depleted ones).
        const lotName = getRelationalName(quant.lot_id);
        if (lotName && quantity > 0) {
            const lots = lotNamesByProductId.get(productIdForQuant) ?? new Set<string>();
            lots.add(lotName);
            lotNamesByProductId.set(productIdForQuant, lots);
        }
    }

    const rows: ProductPerformanceRow[] = finalProductIds
        .map((id) => {
            const info = productInfoById.get(id);
            const soldQty = Number((soldQtyByProductId.get(id) ?? 0).toFixed(2));
            const salesValue = Number((salesValueByProductId.get(id) ?? 0).toFixed(2));
            const averageSellingPrice = soldQty > 0 ? Number((salesValue / soldQty).toFixed(2)) : 0;

            const purchasedQty = Number((purchasedQtyByProductId.get(id) ?? 0).toFixed(2));
            const purchaseValue = Number((purchaseValueByProductId.get(id) ?? 0).toFixed(2));
            const averagePurchasePrice = purchasedQty > 0 ? Number((purchaseValue / purchasedQty).toFixed(2)) : 0;

            const stockByWarehouse = Array.from(stockByProductId.get(id)?.entries() ?? [])
                .map(([warehouseId, value]) => ({
                    warehouseId,
                    warehouseName: value.warehouseName,
                    quantity: Number(value.quantity.toFixed(2)),
                }))
                .sort((a, b) => b.quantity - a.quantity);

            const totalStock = Number(
                stockByWarehouse.reduce((sum, warehouse) => sum + warehouse.quantity, 0).toFixed(2)
            );

            const lots = Array.from(lotNamesByProductId.get(id) ?? []).sort((a, b) => a.localeCompare(b));

            return {
                productId: id,
                productName: info?.name ?? `Product #${id}`,
                brandName: info?.brandName ?? "No Brand",
                categoryName: info?.categoryName ?? "Uncategorized",
                lots,
                soldQty,
                salesValue,
                averageSellingPrice,
                purchasedQty,
                averagePurchasePrice,
                totalStock,
                stockByWarehouse,
            };
        })
        .sort((a, b) => b.soldQty - a.soldQty || b.totalStock - a.totalStock);

    const totals = rows.reduce(
        (acc, row) => {
            acc.soldQty += row.soldQty;
            acc.salesValue += row.salesValue;
            acc.purchasedQty += row.purchasedQty;
            acc.totalStock += row.totalStock;
            return acc;
        },
        { soldQty: 0, salesValue: 0, purchasedQty: 0, totalStock: 0 }
    );

    return {
        startDate,
        endDate,
        currencyCode: TARGET_CURRENCY_CODE,
        matchedProductCount: finalProductIds.length,
        rows,
        totals: {
            soldQty: Number(totals.soldQty.toFixed(2)),
            salesValue: Number(totals.salesValue.toFixed(2)),
            purchasedQty: Number(totals.purchasedQty.toFixed(2)),
            totalStock: Number(totals.totalStock.toFixed(2)),
        },
        unconvertedCurrencyCodes: Array.from(unconvertedCurrencyCodes),
        purchaseOrderDetails,
    };
}

export async function getPendingOrders(credentials: OdooCredentials) {
    const uid = await authenticate(credentials);

    return executeKw<Array<Record<string, unknown>>>(
        credentials,
        uid,
        "sale.order",
        "search_read",
        [["&", ["state", "in", ["draft", "sent"]], ["invoice_status", "!=", "invoiced"]]],
        {
            fields: ["id", "name", "partner_id", "amount_total", "state", "date_order"],
            order: "date_order desc",
            limit: 100,
        }
    );
}

export async function findSalesOrderByNumber(
    credentials: OdooCredentials,
    salesOrderNumber: string
) {
    const uid = await authenticate(credentials);
    const orderNumber = salesOrderNumber.trim();

    if (!orderNumber) {
        return null;
    }

    const exact = await executeKw<Array<Record<string, unknown>>>(
        credentials,
        uid,
        "sale.order",
        "search_read",
        [[["name", "=", orderNumber]]],
        {
            fields: ["id", "name", "partner_id", "amount_total", "state", "date_order"],
            limit: 1,
        }
    );

    if (exact.length > 0) {
        return exact[0];
    }

    const partial = await executeKw<Array<Record<string, unknown>>>(
        credentials,
        uid,
        "sale.order",
        "search_read",
        [[["name", "ilike", orderNumber]]],
        {
            fields: ["id", "name", "partner_id", "amount_total", "state", "date_order"],
            order: "date_order desc",
            limit: 1,
        }
    );

    return partial[0] ?? null;
}

export async function getDashboardStats(
    credentials: OdooCredentials,
    activityType: OdooDashboardActivityType = "crmVisits",
    includeSummaryCounts = true
): Promise<DashboardStats> {
    const uid = await authenticate(credentials);

    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setUTCDate(tomorrowStart.getUTCDate() + 1);

    const from = formatOdooDateTime(todayStart);
    const to = formatOdooDateTime(tomorrowStart);
    const todayDate = todayStart.toISOString().slice(0, 10);
    const nowLocal = new Date();
    const tomorrowLocal = new Date(nowLocal);
    tomorrowLocal.setDate(tomorrowLocal.getDate() + 1);
    const localTodayDate = formatLocalDate(nowLocal);
    const localTomorrowDate = formatLocalDate(tomorrowLocal);

    let pendingCount = 0;
    let confirmedCount = 0;
    let draftCount = 0;
    let salespeople: Array<{ id: number; name: string }> = [];

    if (includeSummaryCounts) {
        [pendingCount, confirmedCount, draftCount, salespeople] = await Promise.all([
            executeKw<number>(
                credentials,
                uid,
                "sale.order",
                "search_count",
                [[
                    ["state", "in", ["draft", "sent"]],
                    ["date_order", ">=", from],
                    ["date_order", "<", to],
                ]]
            ),
            executeKw<number>(
                credentials,
                uid,
                "sale.order",
                "search_count",
                [[
                    ["state", "in", ["sale", "done"]],
                    ["date_order", ">=", from],
                    ["date_order", "<", to],
                ]]
            ),
            executeKw<number>(
                credentials,
                uid,
                "account.move",
                "search_count",
                [[
                    ["move_type", "=", "out_invoice"],
                    ["state", "=", "posted"],
                    ["invoice_date", "=", todayDate],
                ]]
            ),
            getDashboardSalespeople(credentials, uid),
        ]);
    } else {
        salespeople = await getDashboardSalespeople(credentials, uid);
    }

    let selectedCountsBySalesperson = new Map<number, number>();

    if (activityType === "crmVisits") {
        selectedCountsBySalesperson = await getGroupedCountBySalesperson(credentials, uid, {
            model: "crm.lead",
            domain: [
                ["create_uid", "in", salespeople.map((salesperson) => salesperson.id)],
                ["create_date", ">=", `${localTodayDate}`],
                ["create_date", "<", `${localTomorrowDate}`],
                ["type", "=", "opportunity"],
                ["active", "=", true],
            ],
            // CRM "visits" are counted by who created the lead today in the CRM app.
            salespersonField: "create_uid",
        });
    } else if (activityType === "quotations") {
        selectedCountsBySalesperson = await getGroupedCountBySalesperson(credentials, uid, {
            model: "sale.order",
            domain: [
                ["state", "in", ["draft", "sent"]],
                ["create_date", ">=", from],
                ["create_date", "<", to],
            ],
            salespersonField: "user_id",
        });
    } else if (activityType === "salesOrders") {
        selectedCountsBySalesperson = await getGroupedCountBySalesperson(credentials, uid, {
            model: "sale.order",
            domain: [
                ["state", "in", ["sale", "done"]],
                ["create_date", ">=", from],
                ["create_date", "<", to],
            ],
            salespersonField: "user_id",
        });
    } else {
        const invoiceSalespersonField = await getInvoiceSalespersonField(credentials, uid);
        selectedCountsBySalesperson = await getGroupedCountBySalesperson(credentials, uid, {
            model: "account.move",
            domain: [
                [invoiceSalespersonField, "!=", false],
                ["move_type", "=", "out_invoice"],
                ["state", "=", "posted"],
                ["invoice_date", ">=", todayDate],
                ["invoice_date", "<=", todayDate],
            ],
            salespersonField: invoiceSalespersonField,
        });
    }

    const salespersonDailyActivities = salespeople
        .map((salesperson) => ({
            salespersonId: salesperson.id,
            salespersonName: salesperson.name,
            count: selectedCountsBySalesperson.get(salesperson.id) ?? 0,
        }))
        .sort((a, b) => a.salespersonName.localeCompare(b.salespersonName));

    return {
        pendingCount,
        confirmedCount,
        draftCount,
        selectedActivityType: activityType,
        salespersonDailyActivities,
    };
}

export async function getOrderDetails(credentials: OdooCredentials, orderId: number) {
    const uid = await authenticate(credentials);

    const [order] = await executeKw<Array<Record<string, unknown>>>(
        credentials,
        uid,
        "sale.order",
        "read",
        [[orderId]],
        {
            fields: ["id", "name", "partner_id", "amount_total", "state", "date_order", "currency_id"],
        }
    );

    const lines = await executeKw<Array<Record<string, unknown>>>(
        credentials,
        uid,
        "sale.order.line",
        "search_read",
        [[["order_id", "=", orderId]]],
        {
            fields: ["id", "product_id", "name", "product_uom_qty", "price_unit", "price_subtotal"],
            order: "id asc",
        }
    );

    return { order, lines };
}

export async function getOrderBackorderDetails(
    credentials: OdooCredentials,
    orderId: number
) {
    const uid = await authenticate(credentials);

    const [order] = await executeKw<Array<Record<string, unknown>>>(
        credentials,
        uid,
        "sale.order",
        "read",
        [[orderId]],
        {
            fields: [
                "id",
                "name",
                "partner_id",
                "user_id",
                "date_order",
                "payment_term_id",
                "state",
            ],
        }
    );

    if (!order) {
        throw new Error("Sales order not found");
    }

    const saleLines = await executeKw<Array<Record<string, unknown>>>(
        credentials,
        uid,
        "sale.order.line",
        "search_read",
        [[["order_id", "=", orderId], ["display_type", "=", false]]],
        {
            fields: ["id", "name", "product_id", "product_uom_qty", "price_unit"],
            order: "id asc",
        }
    );

    const productIds = Array.from(
        new Set(
            saleLines
                .map((line) => {
                    const product = line.product_id as [number, string] | undefined;
                    return product?.[0];
                })
                .filter((id): id is number => typeof id === "number")
        )
    );

    let products: Array<Record<string, unknown>> = [];
    if (productIds.length > 0) {
        products = await executeKw<Array<Record<string, unknown>>>(
            credentials,
            uid,
            "product.product",
            "read",
            [productIds],
            {
                fields: ["id", "qty_available"],
            }
        );
    }

    const qtyByProductId = new Map<number, number>();
    for (const product of products) {
        const id = Number(product.id ?? 0);
        const qtyAvailable = Number(product.qty_available ?? 0);
        qtyByProductId.set(id, qtyAvailable);
    }

    const backorderLines = saleLines
        .map((line) => {
            const product = line.product_id as [number, string] | undefined;
            const productId = product?.[0];
            const orderedQty = Number(line.product_uom_qty ?? 0);
            const availableQty = typeof productId === "number" ? qtyByProductId.get(productId) ?? 0 : 0;
            const shortageQty = Math.max(0, orderedQty - availableQty);

            return {
                id: Number(line.id),
                name: String(line.name ?? product?.[1] ?? ""),
                product_id: product,
                ordered_qty: orderedQty,
                price_unit: Number(line.price_unit ?? 0),
                available_qty: availableQty,
                shortage_qty: shortageQty,
            };
        })
        .filter((line) => Number.isFinite(line.product_id?.[0]) && Number(line.product_id?.[0]) > 0)
        .filter((line) => line.shortage_qty > 0);

    return {
        order: {
            id: Number(order.id),
            name: String(order.name ?? ""),
            customer_name: ((order.partner_id as [number, string] | undefined)?.[1] ?? "-") as string,
            salesperson_name: ((order.user_id as [number, string] | undefined)?.[1] ?? "-") as string,
            order_date: String(order.date_order ?? ""),
            payment_terms: ((order.payment_term_id as [number, string] | undefined)?.[1] ?? "-") as string,
            state: String(order.state ?? ""),
        },
        lines: backorderLines,
    };
}

export async function addProductToOrder(
    credentials: OdooCredentials,
    orderId: number,
    line: OdooOrderLineInput
) {
    const uid = await authenticate(credentials);

    const lineId = await executeKw<number>(
        credentials,
        uid,
        "sale.order.line",
        "create",
        [
            {
                order_id: orderId,
                product_id: line.productId,
                product_uom_qty: line.quantity,
                price_unit: line.unitPrice,
            },
        ]
    );

    return { lineId };
}
