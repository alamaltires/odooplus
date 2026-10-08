import { AsyncLocalStorage } from "node:async_hooks";
import {
    OdooCredentials,
    OdooCustomerActivityReport,
    OdooDashboardActivityType,
    OdooOrderLineInput,
} from "@/types/odoo";

/**
 * Carries the caller's selected company IDs (from the sidebar company
 * selector) across the async call chain of a single request, so every
 * `executeKw` call made while handling that request — no matter how deep in
 * the report-building pipeline — automatically scopes to those companies via
 * Odoo's own `allowed_company_ids` context key (the same mechanism the Odoo
 * web client uses when you switch companies). This avoids threading a
 * `companyIds` parameter through every report function's signature.
 */
const companyContextStorage = new AsyncLocalStorage<number[]>();

/**
 * Runs `fn` with the given company IDs applied to every Odoo RPC call made
 * within it (directly or via nested async calls). Pass an empty/undefined
 * list to run without any company restriction (falls back to Odoo's own
 * default — the API user's assigned company).
 */
export async function runWithCompanyIds<T>(
    companyIds: number[] | null | undefined,
    fn: () => Promise<T>
): Promise<T> {
    if (!companyIds || companyIds.length === 0) {
        return fn();
    }

    return companyContextStorage.run(companyIds, fn);
}

/**
 * Escapes the current company restriction for the duration of `fn`. Needed
 * for lookups that are pinned to the home company specifically (e.g. FX
 * rates in `getCurrencyRatesToHomeCurrency`, always read from the home
 * company's Accounting > Currencies table regardless of which companies are
 * selected for the report): Odoo's multi-company record rules AND the
 * `allowed_company_ids` context onto every domain a query supplies, so an
 * explicit `["company_id", "=", homeCompanyId]` filter still comes back
 * empty when the selected companies (e.g. a USD-only company like Alamal
 * SYR) don't include the home company — that's the exact "No exchange rate
 * is configured for USD at your home company" failure this fixes.
 */
async function runWithoutCompanyRestriction<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        companyContextStorage.exit(() => {
            fn().then(resolve, reject);
        });
    });
}

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
    /** Quantity on confirmed purchase orders that hasn't been received yet. */
    incomingQty: number;
    /** The purchase orders behind `incomingQty`, with each one's open quantity. */
    incomingOrders: Array<{ name: string; quantity: number; expectedDate: string }>;
    /** On-hand stock per lot, each split by the warehouse it sits in (lots newest first). */
    stockByLot: Array<{ lotName: string; quantity: number; warehouses: Array<{ name: string; quantity: number }> }>;
    /** Orders the exclusion toggles removed from this product's figures. */
    excludedItems: PurchaseOrderExcludedItem[];
    /** Sold quantity removed from "Sold in Period" by the exclusions. */
    excludedSoldQty: number;
    /** Open quantity removed from "On the Way" by the exclusions. */
    excludedIncomingQty: number;
};

type PurchaseOrderExcludedItem = {
    kind: "sale" | "purchase";
    reasons: string[];
    document: string;
    partner: string;
    quantity: number;
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
    customerMonthlyTarget: number;
};

type VisitedCustomerRow = CustomerSummary & {
    visitCount: number;
    lastVisitDate: string;
    crmReference: string;
};

type InactiveCustomerRow = CustomerSummary & {
    lastSaleDate: string;
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

type CustomerSalesBrand = {
    brandName: string;
    quantitySold: number;
    totalSales: number;
    categories: Array<{
        categoryName: string;
        quantitySold: number;
        totalSales: number;
        products: Array<{ productName: string; quantitySold: number; totalSales: number }>;
    }>;
};

type CustomerReport = {
    customer: CustomerSummary;
    totalSales: number;
    lastVisitDate: string;
    lastVisitReference: string;
    lastVisitSalespersonName: string;
    openQuotationCount: number;
    topBrands: CustomerBrandSummary[];
    topCategories: CustomerBrandSummary[];
    brandTree: CustomerSalesBrand[];
};

type CurrencyTotal = {
    currencyId: number;
    currencyCode: string;
    total: number;
    invoiceCount: number;
    includedInTotal: boolean;
};

type BrandCategoryTotal = {
    brandId: number;
    categoryId: number;
    categoryName: string;
    totalInvoiced: number;
    costOfGoodsSold: number;
    grossProfit: number;
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
        /** Live-cost (`product.standard_price`) estimate of what this
         * brand's invoiced quantity cost, and the resulting gross profit. */
        costOfGoodsSold: number;
        grossProfit: number;
    }>;
    creditNoteBrandTotals: Array<{
        brandId: number;
        totalInvoiced: number;
        costOfGoodsSold: number;
        grossProfit: number;
    }>;
    /** Same figures as `brandTotals`, split further by each brand's product
     * categories — powers the collapsible "Sales by brand" breakdown. */
    brandCategoryTotals: BrandCategoryTotal[];
    creditNoteBrandCategoryTotals: BrandCategoryTotal[];
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
    categoryId: number | null;
    categoryName: string;
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
        // Odoo answers a bad login with `false` rather than an error, so this
        // is the only signal that the credentials themselves were rejected.
        // These credentials are whatever was saved under "Your Odoo Login" in
        // Settings — independent of the app's own sign-in — so a rejection
        // here means that saved Odoo email/password itself is wrong or stale.
        throw new Error(
            `Odoo rejected the login for "${credentials.username}". ` +
            "Update your Odoo email and password under \"Your Odoo Login\" in Settings. " +
            "If that Odoo user has two-factor authentication enabled, use an Odoo API key as the password instead."
        );
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
    const companyIds = companyContextStorage.getStore();
    const finalKwargs = companyIds && companyIds.length > 0
        ? {
            ...kwargs,
            context: {
                ...(kwargs.context as Record<string, unknown> | undefined),
                allowed_company_ids: companyIds,
            },
        }
        : kwargs;

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
            finalKwargs,
        ],
    });
}

/**
 * `search_read` that keeps paging until Odoo stops returning rows, instead of
 * capping at a single `limit`.
 *
 * A plain capped `search_read` does not error or warn when more records match
 * than the cap — it silently returns only the first page in Odoo's default
 * order (id ascending, i.e. the OLDEST records). Any caller that then derives
 * a date-scoped figure from those rows gets a wrong answer that looks
 * plausible (verified live: a Unified Lot's delivery trace capped at 20 000
 * move lines dropped every recent delivery, making a lot with real activity in
 * the selected period report zero). Use this wherever the matching row count
 * is driven by how much business the data covers rather than by a small fixed
 * bound.
 */
async function searchReadAll(
    credentials: OdooCredentials,
    uid: number,
    model: string,
    domain: unknown[],
    fields: string[],
    options: { pageSize?: number; maxRecords?: number; order?: string } = {}
): Promise<Array<Record<string, unknown>>> {
    const pageSize = options.pageSize ?? 5000;
    const maxRecords = options.maxRecords ?? 500000;
    const results: Array<Record<string, unknown>> = [];

    for (let offset = 0; offset < maxRecords; offset += pageSize) {
        const page = await executeKw<Array<Record<string, unknown>>>(
            credentials,
            uid,
            model,
            "search_read",
            [domain],
            { fields, limit: pageSize, offset, order: options.order ?? "id asc" }
        );

        results.push(...page);
        if (page.length < pageSize) {
            break;
        }
    }

    return results;
}

/** `read` split into batches, so a large id list can't blow up one RPC call. */
async function readInBatches(
    credentials: OdooCredentials,
    uid: number,
    model: string,
    ids: number[],
    fields: string[],
    batchSize = 2000
): Promise<Array<Record<string, unknown>>> {
    const results: Array<Record<string, unknown>> = [];
    for (let index = 0; index < ids.length; index += batchSize) {
        const batch = ids.slice(index, index + batchSize);
        const rows = await executeKw<Array<Record<string, unknown>>>(
            credentials,
            uid,
            model,
            "read",
            [batch],
            { fields }
        );
        results.push(...rows);
    }
    return results;
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

// Minutes to ADD to a UTC instant to get that same instant's wall-clock time
// in `timeZone` (e.g. positive for zones ahead of UTC like Asia/Dubai).
function getTimezoneOffsetMinutes(date: Date, timeZone: string): number {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    }).formatToParts(date);

    const value = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    const asUtc = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"), value("second"));
    return (asUtc - date.getTime()) / 60000;
}

// The report's own date pickers are plain calendar dates ("2026-01-01") with
// no timezone of their own — they mean midnight/end-of-day in whichever
// timezone the person filtering actually works in, not UTC. Every date
// field these reports filter on (date_order, invoice_date, etc.) is stored
// in Odoo as UTC, so treating "2026-01-01 00:00:00" as if it were already a
// UTC instant silently shifts the whole window by the user's UTC offset
// (verified live: for a UTC+4 user this dropped ~4 hours off the start of
// the range and added ~4 hours past the end, measurably changing summed
// quantities). Resolving the actual UTC instant that corresponds to local
// midnight/end-of-day in the signed-in user's own Odoo timezone (`res.users.tz`
// — the same setting that makes Odoo's own UI and reports, e.g. the Sales
// Analysis pivot, interpret date filters correctly) fixes that.
function toOdooDateBoundary(date: string, endOfDay: boolean, timeZone: string): string {
    const normalized = date.trim();
    const naiveUtc = new Date(`${normalized}T${endOfDay ? "23:59:59" : "00:00:00"}Z`);
    if (!timeZone || timeZone === "UTC") {
        return formatOdooDateTime(naiveUtc);
    }

    const offsetMinutes = getTimezoneOffsetMinutes(naiveUtc, timeZone);
    const corrected = new Date(naiveUtc.getTime() - offsetMinutes * 60000);
    return formatOdooDateTime(corrected);
}

// The timezone Odoo itself uses to interpret this user's date filters —
// `res.users.tz` is what drives that in Odoo's own UI/reports, so matching
// it here is what makes our date-scoped reports agree with Odoo's.
async function getUserTimezone(credentials: OdooCredentials, uid: number): Promise<string> {
    const users = await executeKw<Array<Record<string, unknown>>>(
        credentials,
        uid,
        "res.users",
        "read",
        [[uid]],
        { fields: ["tz"] }
    );
    return toDisplayString(users[0]?.tz) || "UTC";
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

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Falls back to today when `value` is missing/malformed — used for the
 * Payment Followup report's "as of" date, which defaults to today. */
function resolveAsOfDate(value: string | undefined | null): string {
    return value && ISO_DATE_PATTERN.test(value) ? value : new Date().toISOString().slice(0, 10);
}

function toDisplayString(value: unknown) {
    // Odoo's JSON-RPC serializes an empty/unset Char, Text, or Many2one
    // field as the boolean `false`, not an empty string — without this
    // check, String(false) silently produces the literal text "false"
    // wherever a field is genuinely blank (verified live: product.product's
    // default_code shows "SKU: false" on every product with no SKU set).
    if (value === false) {
        return "";
    }
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

const CUSTOMER_MONTHLY_TARGET_LABEL = "customer monthly target";
const CUSTOMER_MONTHLY_TARGET_CANDIDATE_FIELDS = ["customer_target"];

/**
 * The "Customer Monthly Target" field on the contact's Sales & Purchase tab
 * is a custom field (this deployment's technical name is `customer_target`).
 * Tries that known name first, then falls back to matching by label in case
 * a deployment has it under a different technical name.
 */
async function getCustomerMonthlyTargetField(
    credentials: OdooCredentials,
    uid: number
): Promise<string | null> {
    const candidateFields = await executeKw<Record<string, { string?: string }>>(
        credentials,
        uid,
        "res.partner",
        "fields_get",
        [CUSTOMER_MONTHLY_TARGET_CANDIDATE_FIELDS],
        { attributes: ["string"] }
    );

    for (const fieldName of CUSTOMER_MONTHLY_TARGET_CANDIDATE_FIELDS) {
        if (candidateFields[fieldName]) {
            return fieldName;
        }
    }

    const allFields = await executeKw<Record<string, { string?: string }>>(
        credentials,
        uid,
        "res.partner",
        "fields_get",
        [],
        { attributes: ["string"] }
    );

    const match = Object.entries(allFields).find(
        ([, meta]) => toDisplayString(meta?.string).trim().toLowerCase() === CUSTOMER_MONTHLY_TARGET_LABEL
    );

    return match ? match[0] : null;
}

type DiscoveredTypeField =
    | { kind: "selection"; fieldName: string; options: Array<{ value: string; label: string }> }
    // Covers both Many2one and Many2many — a plain id list "in" domain leaf
    // and an id-based options fetch work identically for either shape.
    | { kind: "relational"; fieldName: string; relation: string };

type TypeFieldSpec = {
    /** Known technical field name(s) to try first, e.g. `["type_ids"]`. */
    candidateFieldNames: string[];
    /** Label(s) to fall back to matching against `fields_get`'s `string`
     * attribute, for a deployment where the technical name differs. */
    labels: string[];
};

// `type_ids` (Many2many — multiple purchase types can apply to one PO).
const PURCHASE_TYPE_FIELD_SPEC: TypeFieldSpec = {
    candidateFieldNames: ["type_ids"],
    labels: ["Purchase Type"],
};

// `type_id` (Many2one — a sale order has exactly one sale type).
const SALE_TYPE_FIELD_SPEC: TypeFieldSpec = {
    candidateFieldNames: ["type_id"],
    labels: ["Sale Type", "Sales Type"],
};

function toDiscoveredTypeField(
    fieldName: string,
    meta: { string?: string; selection?: Array<[string, string]>; type?: string; relation?: string }
): DiscoveredTypeField {
    if ((meta.type === "many2one" || meta.type === "many2many") && meta.relation) {
        return { kind: "relational", fieldName, relation: meta.relation };
    }

    const options = Array.isArray(meta.selection)
        ? meta.selection.map(([value, label]) => ({ value: String(value), label: toDisplayString(label) || String(value) }))
        : [];
    return { kind: "selection", fieldName, options };
}

/**
 * Finds a model's own classification field ("Purchase Type", "Sale Type",
 * etc.) — a per-deployment custom field (Selection, Many2one, or Many2many
 * to a small "type" model). Tries the known technical name(s) first, then
 * falls back to matching by label for a deployment that named it differently.
 */
async function discoverTypeField(
    credentials: OdooCredentials,
    uid: number,
    model: string,
    spec: TypeFieldSpec
): Promise<DiscoveredTypeField | null> {
    if (spec.candidateFieldNames.length > 0) {
        const candidateFields = await executeKw<
            Record<string, { string?: string; selection?: Array<[string, string]>; type?: string; relation?: string }>
        >(credentials, uid, model, "fields_get", [spec.candidateFieldNames], {
            attributes: ["string", "selection", "type", "relation"],
        });

        for (const fieldName of spec.candidateFieldNames) {
            if (candidateFields[fieldName]) {
                return toDiscoveredTypeField(fieldName, candidateFields[fieldName]);
            }
        }
    }

    if (spec.labels.length === 0) {
        return null;
    }

    const fields = await executeKw<
        Record<string, { string?: string; selection?: Array<[string, string]>; type?: string; relation?: string }>
    >(credentials, uid, model, "fields_get", [], { attributes: ["string", "selection", "type", "relation"] });

    const normalizedLabels = spec.labels.map((label) => label.trim().toLowerCase());
    const match = Object.entries(fields).find(([, meta]) =>
        normalizedLabels.includes(toDisplayString(meta?.string).trim().toLowerCase())
    );
    return match ? toDiscoveredTypeField(match[0], match[1]) : null;
}

async function getTypeFieldOptions(
    credentials: OdooCredentials,
    uid: number,
    model: string,
    spec: TypeFieldSpec
): Promise<Array<{ value: string; label: string }>> {
    const field = await discoverTypeField(credentials, uid, model, spec);
    if (!field) {
        return [];
    }
    if (field.kind === "selection") {
        return field.options;
    }

    const records = await executeKw<Array<Record<string, unknown>>>(
        credentials,
        uid,
        field.relation,
        "search_read",
        [[]],
        { fields: ["id", "name"], order: "name asc", limit: 1000 }
    );
    return records.map((record) => ({
        value: String(record.id ?? ""),
        label: toDisplayString(record.name) || `#${String(record.id ?? "")}`,
    }));
}

/**
 * Resolves a chosen set of type-field values into the concrete order ids
 * that match them — a plain id list is unambiguous and reusable across every
 * domain that needs to exclude those orders, whether reached directly or
 * through a one2many hop (e.g. an invoice line's linked sale order), and
 * "in" behaves the same whether the field itself is Many2one or Many2many.
 */
async function findOrderIdsMatchingTypeField(
    credentials: OdooCredentials,
    uid: number,
    model: string,
    spec: TypeFieldSpec,
    values: string[]
): Promise<number[] | null> {
    if (values.length === 0) {
        return null;
    }

    const field = await discoverTypeField(credentials, uid, model, spec);
    if (!field) {
        return null;
    }

    const domainValue = field.kind === "relational" ? values.map(Number).filter((id) => Number.isFinite(id) && id > 0) : values;
    if (domainValue.length === 0) {
        return null;
    }

    return executeKw<number[]>(credentials, uid, model, "search", [[[field.fieldName, "in", domainValue]]]);
}

/**
 * Purchase orders whose Deliver To (`picking_type_id`) is a Dropship
 * operation type — the stock_dropshipping module sets `code = "dropship"` on
 * that picking type, which is stable across deployments; a name-based
 * fallback covers instances that renamed or don't set that code.
 */
async function findDropshipPickingTypeIds(credentials: OdooCredentials, uid: number): Promise<number[]> {
    const byCode = await executeKw<number[]>(
        credentials,
        uid,
        "stock.picking.type",
        "search",
        [[["code", "=", "dropship"]]]
    );
    if (byCode.length > 0) {
        return byCode;
    }

    return executeKw<number[]>(
        credentials,
        uid,
        "stock.picking.type",
        "search",
        [[["name", "ilike", "dropship"]]]
    );
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
    partnerIds: number[],
    extraFields: string[] = []
) {
    const uniquePartnerIds = Array.from(new Set(partnerIds.filter((id) => Number.isFinite(id) && id > 0)));
    if (uniquePartnerIds.length === 0) {
        return new Map<number, Record<string, unknown>>();
    }

    const partnerFields = Array.from(new Set([...(await getAvailablePartnerFields(credentials, uid)), ...extraFields]));
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
    const users = await runWithoutCompanyRestriction(() =>
        executeKw<Array<{ company_id?: unknown }>>(
            credentials,
            uid,
            "res.users",
            "read",
            [[uid]],
            { fields: ["company_id"] }
        )
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

    const records = await runWithoutCompanyRestriction(() =>
        executeKw<Array<{ currency_id?: unknown; rate?: number }>>(
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
        )
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
    const candidateFields = ["tire_brand", "brand_id", "product_brand_id", "x_brand_id"];
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

export type ProductCatalogCard = {
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
};

/**
 * Richer product search for the Product Requests module's card view — same
 * name/SKU search as `getProducts`, but also brings back the tire data
 * (brand, category, origin, rim diameter) and current stock a card needs, so
 * the searcher can tell at a glance whether a near-match is actually the
 * product they want before deciding to request something new.
 */
// A search-as-you-type card list, capped well below what a broad query
// could match — ranking the full match set by stock (see below) already
// requires reading every match's quants up front, so this bounds that cost
// rather than the (much larger) true `search_count` total.
const PRODUCT_CATALOG_SEARCH_MAX_MATCHES = 500;

export async function searchProductCatalog(
    credentials: OdooCredentials,
    input?: {
        query?: string;
        limit?: number;
        offset?: number;
    }
): Promise<{ products: ProductCatalogCard[]; totalCount: number }> {
    const uid = await authenticate(credentials);
    const query = (input?.query ?? "").trim();
    const limit = Number.isFinite(input?.limit) ? Math.max(1, Math.min(60, Number(input?.limit))) : 24;
    const offset = Number.isFinite(input?.offset) ? Math.max(0, Number(input?.offset)) : 0;

    const domain: unknown[] = [];
    if (query) {
        // `product_tmpl_id.second_name` ("Search Name") is a normalized key
        // Odoo maintains per template — size and brand concatenated with no
        // spaces/slashes/case sensitivity (e.g. "215/55R17 Austone" ->
        // "2155517Austone") — so it matches typed-together fragments like
        // "2155517austone" that would never hit `name`'s slash/space
        // formatting. Kept alongside `name`/`default_code` rather than
        // replacing them, so normally-formatted or SKU searches still work.
        domain.push(
            "|",
            "|",
            ["name", "ilike", query],
            ["default_code", "ilike", query],
            ["product_tmpl_id.second_name", "ilike", query]
        );
    }

    // Every id the query matches (capped) — fetched up front, unpaginated,
    // so the *whole* match set can be ranked by on-hand quantity before
    // slicing out the requested page. Sorting only the one page Odoo's own
    // `order: "name asc"` happened to return would rank alphabetically
    // within that page, not "highest stock across all matches first".
    const matchingIds = await executeKw<number[]>(
        credentials,
        uid,
        "product.product",
        "search",
        [domain],
        { order: "name asc", limit: PRODUCT_CATALOG_SEARCH_MAX_MATCHES, context: { active_test: false } }
    );

    if (matchingIds.length === 0) {
        return { products: [], totalCount: 0 };
    }

    // `allowed_company_ids` alone doesn't restrict stock.quant reads on this
    // instance (no multi-company record rule enforces it here), so the
    // selected companies need an explicit domain filter — otherwise every
    // company's stock shows up regardless of the sidebar selector.
    const activeCompanyIds = companyContextStorage.getStore();
    const quantDomain: unknown[] = [["product_id", "in", matchingIds], ["location_id.usage", "=", "internal"]];
    if (activeCompanyIds && activeCompanyIds.length > 0) {
        quantDomain.push(["company_id", "in", activeCompanyIds]);
    }

    const allQuants = await executeKw<Array<Record<string, unknown>>>(
        credentials,
        uid,
        "stock.quant",
        "search_read",
        [quantDomain],
        { fields: ["product_id", "quantity", "lot_id", "company_id"], limit: 20000 }
    );

    // Broken down per lot AND the company that lot belongs to (not just one
    // total) — "company aware" here means the company owning each unit of
    // stock is visible on the card itself, scoped by whichever companies
    // are selected in the sidebar (via `runWithCompanyIds` at the route
    // level) rather than asked for separately on the request form. Computed
    // for every match up front so it can both rank the results (highest
    // total stock first) and be reused for the page's cards below without a
    // second query.
    const stockByProductId = new Map<number, Map<string, { lotName: string; companyName: string; quantity: number }>>();
    for (const quant of allQuants) {
        const id = getRelationalId(quant.product_id);
        if (!id) {
            continue;
        }
        const lotName = getRelationalName(quant.lot_id) || "Unlotted";
        const companyName = getRelationalName(quant.company_id) || "Unknown Company";
        const quantity = Number(quant.quantity ?? 0);
        const key = `${lotName} ${companyName}`;
        const byLot = stockByProductId.get(id) ?? new Map<string, { lotName: string; companyName: string; quantity: number }>();
        const existing = byLot.get(key);
        if (existing) {
            existing.quantity += quantity;
        } else {
            byLot.set(key, { lotName, companyName, quantity });
        }
        stockByProductId.set(id, byLot);
    }

    const totalStockByProductId = new Map<number, number>();
    for (const [id, byLot] of stockByProductId) {
        let sum = 0;
        for (const entry of byLot.values()) {
            sum += entry.quantity;
        }
        totalStockByProductId.set(id, sum);
    }

    const sortedIds = [...matchingIds].sort(
        (a, b) => (totalStockByProductId.get(b) ?? 0) - (totalStockByProductId.get(a) ?? 0)
    );
    const pageIds = sortedIds.slice(offset, offset + limit);

    if (pageIds.length === 0) {
        return { products: [], totalCount: matchingIds.length };
    }

    const productRecords = await executeKw<Array<Record<string, unknown>>>(
        credentials,
        uid,
        "product.product",
        "read",
        [pageIds],
        { fields: ["id", "display_name", "default_code", "product_tmpl_id"], context: { active_test: false } }
    );

    // `read` doesn't preserve the id order it was called with — re-sort to
    // match `pageIds` (already stock-desc ordered) rather than whatever
    // order Odoo happened to return.
    const productById = new Map(productRecords.map((product) => [Number(product.id ?? 0), product]));
    const products = pageIds
        .map((id) => productById.get(id))
        .filter((product): product is Record<string, unknown> => Boolean(product));

    if (products.length === 0) {
        return { products: [], totalCount: matchingIds.length };
    }

    const totalCount = matchingIds.length;

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
            { fields: ["id", "tire_brand", "categ_id", "origin", "rim_diameter"] }
        )
        : [];

    const templateInfoById = new Map<
        number,
        { brandName: string; categoryName: string; originName: string; rimDiameterName: string }
    >();
    for (const template of templates) {
        const templateId = Number(template.id ?? 0);
        if (templateId <= 0) {
            continue;
        }

        templateInfoById.set(templateId, {
            brandName: getRelationalName(template.tire_brand) || "No Brand",
            categoryName: getRelationalName(template.categ_id) || "Uncategorized",
            originName: getRelationalName(template.origin) || "Unknown Origin",
            rimDiameterName: getRelationalName(template.rim_diameter) || "-",
        });
    }

    // Stock for this page's products was already computed above (from the
    // full match set, before ranking/pagination) — reused here rather than
    // queried again.
    const productIds = pageIds;

    // Pricelists — like stock.quant above, `allowed_company_ids` context
    // alone doesn't restrict `product.pricelist` reads here, so different
    // companies' identically-named lists (e.g. each company having its own
    // "Retail (USD)") were all coming back at once, showing as duplicate
    // rows on the card. Explicitly scoped to the selected companies (plus
    // company-agnostic/shared pricelists, company_id = false) to match what
    // the sidebar selector actually shows. Only "fixed price" items are read
    // — the common case for this catalogue (verified live: pricelist items
    // here are all `compute_price: "fixed"`, e.g. a Wholesale (USD) line at
    // a flat fixed_price per product) — percentage/formula-based rules
    // would need Odoo's full pricing engine to evaluate and aren't worth the
    // complexity for a request-form reference price.
    const pricelistDomain: unknown[] = activeCompanyIds && activeCompanyIds.length > 0
        ? ["|", ["company_id", "=", false], ["company_id", "in", activeCompanyIds]]
        : [];
    const pricelists = await executeKw<Array<Record<string, unknown>>>(
        credentials,
        uid,
        "product.pricelist",
        "search_read",
        [pricelistDomain],
        { fields: ["id", "name", "currency_id"], limit: 200 }
    );

    // Prices are always shown in AED (the home currency) regardless of
    // which currency each pricelist is itself denominated in — the same
    // currency-safe conversion approach used throughout (see
    // `getMarginAnalyticsReport`), so a USD-priced Wholesale list and an
    // AED-priced Retail list are directly comparable on the card.
    const primaryCurrencyId = await getPrimaryCurrencyId(credentials, uid, []);
    const homeCompanyId = await getHomeCompanyId(credentials, uid);
    const todayStr = new Date().toISOString().slice(0, 10);
    const priceMultiplierByCurrencyId = buildCurrencyMultipliers(primaryCurrencyId, new Map());
    const pricelistCurrencyIds = Array.from(
        new Set(
            pricelists
                .map((list) => getRelationalId(list.currency_id))
                .filter((id): id is number => typeof id === "number" && id > 0 && id !== primaryCurrencyId)
        )
    );
    if (pricelistCurrencyIds.length > 0 && homeCompanyId) {
        const rates = await getCurrencyRatesToHomeCurrency(credentials, uid, homeCompanyId, pricelistCurrencyIds, todayStr);
        for (const [currencyId, rate] of rates) {
            priceMultiplierByCurrencyId.set(currencyId, 1 / rate);
        }
    }

    const pricelistIds = pricelists.map((list) => Number(list.id ?? 0)).filter((id) => id > 0);
    const pricelistInfoById = new Map<number, { name: string; multiplier: number | undefined }>();
    for (const list of pricelists) {
        const id = Number(list.id ?? 0);
        if (id <= 0) continue;
        const currencyId = getRelationalId(list.currency_id);
        pricelistInfoById.set(id, {
            name: toDisplayString(list.name) || `Pricelist #${id}`,
            multiplier: currencyId ? priceMultiplierByCurrencyId.get(currencyId) : undefined,
        });
    }

    const pricelistItems = pricelistIds.length > 0 && productIds.length > 0
        ? await executeKw<Array<Record<string, unknown>>>(
            credentials,
            uid,
            "product.pricelist.item",
            "search_read",
            [[
                ["pricelist_id", "in", pricelistIds],
                ["product_id", "in", productIds],
                ["compute_price", "=", "fixed"],
            ]],
            { fields: ["pricelist_id", "product_id", "fixed_price"], limit: 5000 }
        )
        : [];

    const pricelistsByProductId = new Map<
        number,
        Array<{ pricelistName: string; currencyCode: string; price: number }>
    >();
    for (const item of pricelistItems) {
        const productId = getRelationalId(item.product_id);
        const pricelistId = getRelationalId(item.pricelist_id);
        if (!productId || !pricelistId) {
            continue;
        }
        const info = pricelistInfoById.get(pricelistId);
        // Skip entries in a currency we have no rate to convert from —
        // showing an unconverted, wrongly-labeled AED figure would be worse
        // than omitting the line entirely.
        if (!info || info.multiplier === undefined) {
            continue;
        }
        const entries = pricelistsByProductId.get(productId) ?? [];
        entries.push({
            pricelistName: info.name,
            currencyCode: TARGET_CURRENCY_CODE,
            price: Number((Number(item.fixed_price ?? 0) * info.multiplier).toFixed(2)),
        });
        pricelistsByProductId.set(productId, entries);
    }

    const cards = products
        .map((product) => {
            const id = Number(product.id ?? 0);
            const templateId = getRelationalId(product.product_tmpl_id);
            const info = typeof templateId === "number" ? templateInfoById.get(templateId) : undefined;

            const stockByLot = Array.from(stockByProductId.get(id)?.values() ?? [])
                .map((entry) => ({ ...entry, quantity: Number(entry.quantity.toFixed(2)) }))
                .filter((entry) => entry.quantity !== 0)
                .sort((a, b) => b.quantity - a.quantity);
            const currentStock = Number(stockByLot.reduce((sum, entry) => sum + entry.quantity, 0).toFixed(2));

            return {
                id,
                name: toDisplayString(product.display_name) || `Product #${id}`,
                sku: toDisplayString(product.default_code),
                brandName: info?.brandName ?? "No Brand",
                categoryName: info?.categoryName ?? "Uncategorized",
                originName: info?.originName ?? "Unknown Origin",
                rimDiameterName: info?.rimDiameterName ?? "-",
                currentStock,
                stockByLot,
                pricelists: (pricelistsByProductId.get(id) ?? []).sort((a, b) =>
                    a.pricelistName.localeCompare(b.pricelistName)
                ),
            };
        })
        .filter((card) => card.id > 0);

    return { products: cards, totalCount };
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
    const timeZone = await getUserTimezone(credentials, uid);
    const monthlyTargetField = await getCustomerMonthlyTargetField(credentials, uid);

    const [salespeople, servicedOrders, assignedPartners, crmLeads, allSalespersonOrders] = await Promise.all([
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
                ["date_order", ">=", toOdooDateBoundary(startDate, false, timeZone)],
                ["date_order", "<=", toOdooDateBoundary(endDate, true, timeZone)],
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
        // Unrestricted by date range — used to show how long an assigned but
        // currently-inactive customer's last sale under this salesperson has been.
        executeKw<Array<Record<string, unknown>>>(
            credentials,
            uid,
            "sale.order",
            "search_read",
            [[
                ["user_id", "=", salespersonId],
                ["state", "in", ["sale", "done"]],
                ["partner_id", "!=", false],
            ]],
            {
                fields: ["id", "partner_id", "date_order"],
                order: "date_order desc",
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
        ...allSalespersonOrders.map((order) => getRelationalId(order.partner_id) ?? 0),
    ];

    const canonicalCustomerMap = await getCanonicalCustomerMap(
        credentials,
        uid,
        relevantPartnerIds,
        monthlyTargetField ? [monthlyTargetField] : []
    );

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
        const customerMonthlyTarget = monthlyTargetField ? Number(customer[monthlyTargetField] ?? 0) : 0;

        if (!existing) {
            servicedByCustomerId.set(key, {
                ...summary,
                orderCount: 1,
                totalSales: Number(orderAmount.toFixed(2)),
                lastSaleDate,
                customerMonthlyTarget,
            });
            continue;
        }

        existing.orderCount += 1;
        existing.totalSales = Number((existing.totalSales + orderAmount).toFixed(2));
        if (lastSaleDate > existing.lastSaleDate) {
            existing.lastSaleDate = lastSaleDate;
        }
    }

    const visitRangeStart = toOdooDateBoundary(startDate, false, timeZone);
    const visitRangeEnd = toOdooDateBoundary(endDate, true, timeZone);
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
    const lastSaleByCustomerId = new Map<number, string>();
    for (const order of allSalespersonOrders) {
        const partnerId = getRelationalId(order.partner_id);
        if (!partnerId) {
            continue;
        }

        const customer = canonicalCustomerMap.get(partnerId);
        if (!customer) {
            continue;
        }

        const summary = toCustomerSummary(customer, salesperson.name);
        const saleDate = normalizeOdooDate(order.date_order);
        if (!saleDate) {
            continue;
        }

        const existing = lastSaleByCustomerId.get(summary.customerId);
        if (!existing || saleDate > existing) {
            lastSaleByCustomerId.set(summary.customerId, saleDate);
        }
    }

    const inactiveByCustomerId = new Map<number, InactiveCustomerRow>();
    for (const partner of assignedPartners) {
        const partnerId = Number(partner.id ?? 0);
        const customer = canonicalCustomerMap.get(partnerId) ?? partner;
        const summary = toCustomerSummary(customer, salesperson.name);

        if (servicedIds.has(summary.customerId)) {
            continue;
        }

        if (!inactiveByCustomerId.has(summary.customerId)) {
            inactiveByCustomerId.set(summary.customerId, {
                ...summary,
                lastSaleDate: lastSaleByCustomerId.get(summary.customerId) ?? "",
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
                fields: ["id", "product_tmpl_id", "display_name"],
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
                fields: Array.from(new Set(["id", brandField.fieldName, "categ_id"])),
            }
        )
        : [];

    const templateById = new Map<number, Record<string, unknown>>();
    for (const template of templates) {
        templateById.set(Number(template.id ?? 0), template);
    }

    const productToTemplateId = new Map<number, number>();
    const productNameById = new Map<number, string>();
    for (const product of products) {
        const productId = Number(product.id ?? 0);
        const templateId = getRelationalId(product.product_tmpl_id);
        if (productId > 0 && templateId) {
            productToTemplateId.set(productId, templateId);
        }
        if (productId > 0) {
            productNameById.set(productId, toDisplayString(product.display_name) || `Product #${productId}`);
        }
    }

    function accumulateBrandSummary(
        map: Map<string, CustomerBrandSummary>,
        name: string,
        quantity: number,
        sales: number
    ) {
        const existing = map.get(name);
        if (!existing) {
            map.set(name, {
                brandName: name,
                quantitySold: Number(quantity.toFixed(2)),
                totalSales: Number(sales.toFixed(2)),
            });
            return;
        }

        existing.quantitySold = Number((existing.quantitySold + quantity).toFixed(2));
        existing.totalSales = Number((existing.totalSales + sales).toFixed(2));
    }

    // Brand and category are tracked as two independent breakdowns — a
    // Odoo instance without a real brand field (see `getPreferredBrandField`)
    // makes these degenerate to the same grouping, but on one that has both,
    // conflating them lost real brand-level detail behind a generic category.
    const brandMap = new Map<string, CustomerBrandSummary>();
    const categoryMap = new Map<string, CustomerBrandSummary>();
    const treeMap = new Map<
        string,
        {
            quantitySold: number;
            totalSales: number;
            categories: Map<string, { quantitySold: number; totalSales: number; products: Map<string, { quantitySold: number; totalSales: number }> }>;
        }
    >();
    for (const line of saleLines) {
        const productId = getRelationalId(line.product_id);
        if (!productId) {
            continue;
        }

        const templateId = productToTemplateId.get(productId);
        const template = typeof templateId === "number" ? templateById.get(templateId) : undefined;
        const quantity = Number(line.product_uom_qty ?? 0);
        const sales = Number(line.price_subtotal ?? 0);

        const brandValue = template?.[brandField.fieldName];
        const brandName = getRelationalName(brandValue) || toDisplayString(brandValue) || `Unknown ${brandField.label}`;
        accumulateBrandSummary(brandMap, brandName, quantity, sales);

        const categoryName = getRelationalName(template?.categ_id) || "Uncategorized";
        accumulateBrandSummary(categoryMap, categoryName, quantity, sales);

        // Brand -> category -> product, for the expandable breakdown.
        const treeBrand = treeMap.get(brandName) ?? { quantitySold: 0, totalSales: 0, categories: new Map() };
        const treeCategory = treeBrand.categories.get(categoryName) ?? { quantitySold: 0, totalSales: 0, products: new Map() };
        const productName = productNameById.get(productId) ?? `Product #${productId}`;
        const treeProduct = treeCategory.products.get(productName) ?? { quantitySold: 0, totalSales: 0 };
        treeProduct.quantitySold += quantity;
        treeProduct.totalSales += sales;
        treeCategory.quantitySold += quantity;
        treeCategory.totalSales += sales;
        treeBrand.quantitySold += quantity;
        treeBrand.totalSales += sales;
        treeCategory.products.set(productName, treeProduct);
        treeBrand.categories.set(categoryName, treeCategory);
        treeMap.set(brandName, treeBrand);
    }

    const bySalesThenQty = <T extends { totalSales: number; quantitySold: number }>(a: T, b: T) =>
        b.totalSales - a.totalSales || b.quantitySold - a.quantitySold;
    const round2 = (value: number) => Number(value.toFixed(2));
    const brandTree: CustomerSalesBrand[] = Array.from(treeMap, ([brandName, brand]) => ({
        brandName,
        quantitySold: round2(brand.quantitySold),
        totalSales: round2(brand.totalSales),
        categories: Array.from(brand.categories, ([categoryName, category]) => ({
            categoryName,
            quantitySold: round2(category.quantitySold),
            totalSales: round2(category.totalSales),
            products: Array.from(category.products, ([productName, product]) => ({
                productName,
                quantitySold: round2(product.quantitySold),
                totalSales: round2(product.totalSales),
            })).sort(bySalesThenQty),
        })).sort(bySalesThenQty),
    })).sort(bySalesThenQty);

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
        topCategories: Array.from(categoryMap.values())
            .sort((a, b) => b.totalSales - a.totalSales || b.quantitySold - a.quantitySold)
            .slice(0, 10),
        brandTree,
    };
}

/**
 * Splits one brand's share of a line (`amountForBrand`/`costForBrand`,
 * already computed by the caller) across the distinct categories among just
 * THAT brand's linked sale lines — evenly, mirroring how the caller already
 * splits a multi-brand line across brands. Almost always resolves to exactly
 * one category (one line -> one product in the common case); accumulates
 * into `target`, keyed by brand+category so the same map can be reused
 * across every line in the loop.
 */
function accumulateBrandCategorySplit(
    target: Map<string, { brandId: number; categoryId: number; categoryName: string; total: number; cost: number }>,
    brandId: number,
    saleLineIdsForLine: number[],
    amountForBrand: number,
    costForBrand: number,
    brandBySaleLineId: Map<number, number>,
    categoryBySaleLineId: Map<number, { categoryId: number; categoryName: string }>
): void {
    const categoriesForBrand = Array.from(
        new Map(
            saleLineIdsForLine
                .filter((saleLineId) => brandBySaleLineId.get(saleLineId) === brandId)
                .map((saleLineId) => categoryBySaleLineId.get(saleLineId))
                .filter((category): category is { categoryId: number; categoryName: string } => Boolean(category))
                .map((category) => [category.categoryId, category] as const)
        ).values()
    );

    if (categoriesForBrand.length === 0) {
        return;
    }

    const amountShare = amountForBrand / categoriesForBrand.length;
    const costShare = costForBrand / categoriesForBrand.length;

    for (const category of categoriesForBrand) {
        const key = `${brandId}::${category.categoryId}`;
        const existing = target.get(key) ?? {
            brandId,
            categoryId: category.categoryId,
            categoryName: category.categoryName,
            total: 0,
            cost: 0,
        };
        existing.total += amountShare;
        existing.cost += costShare;
        target.set(key, existing);
    }
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

    let brandTotals: Array<{ brandId: number; totalInvoiced: number; costOfGoodsSold: number; grossProfit: number }> = [];
    let brandCategoryTotals: BrandCategoryTotal[] = [];
    let brandBySaleLineId = new Map<number, number>();
    // Each sale line's product cost (Odoo's own live `standard_price`), used
    // to derive the gross profit shown alongside each brand's revenue below.
    let costBySaleLineId = new Map<number, number>();
    // Each sale line's product category, used to further split a brand's
    // total in the "Sales by brand" breakdown.
    let categoryBySaleLineId = new Map<number, { categoryId: number; categoryName: string }>();
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
                fields: ["move_id", "sale_line_ids", "price_total", "quantity", "display_type"],
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
                    // `standard_price` is Odoo's own live Cost field, always in
                    // the company's base currency (AED here — same as
                    // `TARGET_CURRENCY_CODE`), so it needs no FX conversion
                    // unlike the invoice amounts below.
                    fields: ["id", "product_tmpl_id", "standard_price"],
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
                    fields: ["id", "tire_brand", "categ_id"],
                }
            )
            : [];

        const brandByTemplateId = new Map<number, number>();
        const categoryIdByTemplateId = new Map<number, number>();
        for (const template of templates) {
            const templateId = Number(template.id ?? 0);
            const brandId = getRelationalId(template.tire_brand);
            if (templateId > 0 && typeof brandId === "number" && brandId > 0) {
                brandByTemplateId.set(templateId, brandId);
            }
            const categoryId = getRelationalId(template.categ_id);
            if (templateId > 0 && typeof categoryId === "number" && categoryId > 0) {
                categoryIdByTemplateId.set(templateId, categoryId);
            }
        }

        const categoryIds = Array.from(new Set(categoryIdByTemplateId.values()));
        const categories = categoryIds.length > 0
            ? await executeKw<Array<Record<string, unknown>>>(
                credentials,
                uid,
                "product.category",
                "read",
                [categoryIds],
                { fields: ["id", "name"] }
            )
            : [];
        const categoryNameById = new Map<number, string>();
        for (const category of categories) {
            const categoryId = Number(category.id ?? 0);
            const name = toDisplayString(category.name);
            if (categoryId > 0 && name) {
                categoryNameById.set(categoryId, name);
            }
        }

        const brandByProductId = new Map<number, number>();
        // Category the same product-level breakdown is further split by
        // (Gross Profit is shown per brand-and-category in the "Sales by
        // brand" breakdown, so both need resolving from the same products).
        const categoryByProductId = new Map<number, { categoryId: number; categoryName: string }>();
        for (const product of products) {
            const productId = Number(product.id ?? 0);
            const templateId = getRelationalId(product.product_tmpl_id);
            const brandId = typeof templateId === "number" ? brandByTemplateId.get(templateId) : undefined;

            if (productId > 0 && typeof brandId === "number" && brandId > 0) {
                brandByProductId.set(productId, brandId);
            }

            const categoryId = typeof templateId === "number" ? categoryIdByTemplateId.get(templateId) : undefined;
            if (productId > 0 && typeof categoryId === "number" && categoryId > 0) {
                categoryByProductId.set(productId, {
                    categoryId,
                    categoryName: categoryNameById.get(categoryId) ?? `Category #${categoryId}`,
                });
            }
        }
        productCountMappedToBrand = brandByProductId.size;

        const costByProductId = new Map<number, number>();
        for (const product of products) {
            const productId = Number(product.id ?? 0);
            const cost = Number(product.standard_price ?? 0);
            if (productId > 0 && Number.isFinite(cost)) {
                costByProductId.set(productId, cost);
            }
        }

        brandBySaleLineId = new Map<number, number>();
        costBySaleLineId = new Map<number, number>();
        categoryBySaleLineId = new Map<number, { categoryId: number; categoryName: string }>();
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

            const cost = costByProductId.get(productId);
            if (typeof cost === "number") {
                costBySaleLineId.set(saleLineId, cost);
            }

            const category = categoryByProductId.get(productId);
            if (category) {
                categoryBySaleLineId.set(saleLineId, category);
            }
        }

        const totalsByBrand = new Map<number, number>();
        const costTotalsByBrand = new Map<number, number>();
        const totalsByBrandCategory = new Map<
            string,
            { brandId: number; categoryId: number; categoryName: string; total: number; cost: number }
        >();
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

            // Cost side of the same line, for Gross Profit: the line's
            // quantity times the average live Cost across whichever
            // product(s) it's linked to (almost always exactly one), already
            // in the home/target currency so it needs no FX multiplier.
            const linkedCosts = linkedSaleLineIds
                .map((saleLineId) => costBySaleLineId.get(saleLineId))
                .filter((cost): cost is number => typeof cost === "number");
            let costSplitAmount = 0;
            if (linkedCosts.length > 0) {
                const avgUnitCost = linkedCosts.reduce((sum, cost) => sum + cost, 0) / linkedCosts.length;
                const lineQuantity = Number(line.quantity ?? 0);
                const lineCost = avgUnitCost * lineQuantity;
                costSplitAmount = Number.isFinite(lineCost) ? lineCost / linkedBrandIds.length : 0;
            }

            for (const brandId of linkedBrandIds) {
                const current = totalsByBrand.get(brandId) ?? 0;
                totalsByBrand.set(brandId, current + splitAmount);

                const currentCost = costTotalsByBrand.get(brandId) ?? 0;
                costTotalsByBrand.set(brandId, currentCost + costSplitAmount);

                accumulateBrandCategorySplit(
                    totalsByBrandCategory,
                    brandId,
                    linkedSaleLineIds,
                    splitAmount,
                    costSplitAmount,
                    brandBySaleLineId,
                    categoryBySaleLineId
                );
            }
        }

        brandTotals = Array.from(totalsByBrand.entries())
            .map(([brandId, total]) => {
                const costOfGoodsSold = costTotalsByBrand.get(brandId) ?? 0;
                return {
                    brandId,
                    totalInvoiced: Number(total.toFixed(2)),
                    costOfGoodsSold: Number(costOfGoodsSold.toFixed(2)),
                    grossProfit: Number((total - costOfGoodsSold).toFixed(2)),
                };
            })
            .sort((a, b) => b.totalInvoiced - a.totalInvoiced);

        brandCategoryTotals = Array.from(totalsByBrandCategory.values())
            .map((entry) => ({
                brandId: entry.brandId,
                categoryId: entry.categoryId,
                categoryName: entry.categoryName,
                totalInvoiced: Number(entry.total.toFixed(2)),
                costOfGoodsSold: Number(entry.cost.toFixed(2)),
                grossProfit: Number((entry.total - entry.cost).toFixed(2)),
            }))
            .sort((a, b) => b.totalInvoiced - a.totalInvoiced);
    }

    let creditNoteBrandTotals: Array<{ brandId: number; totalInvoiced: number; costOfGoodsSold: number; grossProfit: number }> = [];
    let creditNoteBrandCategoryTotals: BrandCategoryTotal[] = [];

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
                fields: ["move_id", "sale_line_ids", "price_total", "quantity", "display_type"],
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
        const creditNoteCostTotalsByBrand = new Map<number, number>();
        const creditNoteTotalsByBrandCategory = new Map<
            string,
            { brandId: number; categoryId: number; categoryName: string; total: number; cost: number }
        >();
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

            // Cost given back with the return, mirroring the invoice-side
            // calculation above.
            const linkedCosts = linkedSaleLineIds
                .map((saleLineId) => costBySaleLineId.get(saleLineId))
                .filter((cost): cost is number => typeof cost === "number");
            let costSplitAmount = 0;
            if (linkedCosts.length > 0) {
                const avgUnitCost = linkedCosts.reduce((sum, cost) => sum + cost, 0) / linkedCosts.length;
                const lineQuantity = Math.abs(Number(line.quantity ?? 0));
                const lineCost = avgUnitCost * lineQuantity;
                costSplitAmount = Number.isFinite(lineCost) ? lineCost / linkedBrandIds.length : 0;
            }

            for (const brandId of linkedBrandIds) {
                const current = creditNoteTotalsByBrand.get(brandId) ?? 0;
                creditNoteTotalsByBrand.set(brandId, current + splitAmount);

                const currentCost = creditNoteCostTotalsByBrand.get(brandId) ?? 0;
                creditNoteCostTotalsByBrand.set(brandId, currentCost + costSplitAmount);

                accumulateBrandCategorySplit(
                    creditNoteTotalsByBrandCategory,
                    brandId,
                    linkedSaleLineIds,
                    splitAmount,
                    costSplitAmount,
                    brandBySaleLineId,
                    categoryBySaleLineId
                );
            }
        }

        creditNoteBrandTotals = Array.from(creditNoteTotalsByBrand.entries())
            .map(([brandId, total]) => {
                const costOfGoodsSold = creditNoteCostTotalsByBrand.get(brandId) ?? 0;
                return {
                    brandId,
                    totalInvoiced: Number(total.toFixed(2)),
                    costOfGoodsSold: Number(costOfGoodsSold.toFixed(2)),
                    grossProfit: Number((total - costOfGoodsSold).toFixed(2)),
                };
            })
            .sort((a, b) => b.totalInvoiced - a.totalInvoiced);

        creditNoteBrandCategoryTotals = Array.from(creditNoteTotalsByBrandCategory.values())
            .map((entry) => ({
                brandId: entry.brandId,
                categoryId: entry.categoryId,
                categoryName: entry.categoryName,
                totalInvoiced: Number(entry.total.toFixed(2)),
                costOfGoodsSold: Number(entry.cost.toFixed(2)),
                grossProfit: Number((entry.total - entry.cost).toFixed(2)),
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
        brandCategoryTotals,
        creditNoteBrandCategoryTotals,
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

// Mirrors Odoo's own "Aged Receivable" report buckets (Not Due, 1-30, 31-60,
// 61-90, 91-120, Older), measured from a selectable `asOfDate` rather than
// always "today" — the same report can be re-run as of a past date.
export type PaymentFollowupAgingBucket = "notDue" | "d1_30" | "d31_60" | "d61_90" | "d91_120" | "older";

export type PaymentFollowupAgingTotals = {
    notDue: number;
    d1_30: number;
    d31_60: number;
    d61_90: number;
    d91_120: number;
    older: number;
};

function emptyAgingTotals(): PaymentFollowupAgingTotals {
    return { notDue: 0, d1_30: 0, d31_60: 0, d61_90: 0, d91_120: 0, older: 0 };
}

export type PaymentFollowupInvoiceRow = {
    invoiceId: number;
    invoiceNumber: string;
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
    // Whether the cheque has been physically deposited at the bank —
    // independent of `state`/`isPending` (a Registered cheque can be either
    // deposited or not), tracked separately as "Total Deposit".
    isDeposited: boolean;
    pendingAmount: number;
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
    // Amount of `totalPdcPending`'s cheques (and any others) already
    // physically deposited at the bank — a subset shown alongside it, not
    // netted out of it (a deposited cheque hasn't cleared yet).
    totalPdcDeposited: number;
    // Open vendor bills/refunds against this same (commercial) partner —
    // what we owe them. Informational total shown on its own; each bill is
    // separately aged onto `agingBuckets` below by its own due/invoice date,
    // which is what actually nets it against `totalInvoiceDue`/`netDue`.
    // Zero for a partner that's only ever a customer.
    totalPayableDue: number;
    netDue: number;
    oldestDueDate: string;
    maxDaysOverdue: number;
    agingBucket: PaymentFollowupAgingBucket;
    // Open-invoice residual (credit notes netted in as negative), summed into
    // each bucket independently — a customer can have money in more than one
    // bucket at once, same as Odoo's own Aged Receivable report.
    agingBuckets: PaymentFollowupAgingTotals;
    invoices: PaymentFollowupInvoiceRow[];
    unappliedPayments: PaymentFollowupUnappliedEntry[];
    cheques: PaymentFollowupCheque[];
};

export type PaymentFollowupReport = {
    scope: "salesperson" | "customer";
    salesperson: SalespersonOption | null;
    asOfDate: string;
    dateBasis: "due" | "invoice";
    agingSystem: "day" | "month";
    currencyCode: string;
    pdcModuleDetected: boolean;
    // Only populated when `pdcModuleDetected` is false — what PDC detection
    // actually found (or didn't), so a failed detection is diagnosable from
    // the report itself instead of a bare "not detected" message.
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
    // Populated whenever a PDC model WAS resolved (regardless of how many
    // cheques ended up in the report) — how many records in that model
    // matched this scope's partners before the model's own extra filters
    // (e.g. inbound/outbound) were applied, so a wrong guess about those
    // filters is diagnosable instead of looking identical to "no cheques".
    pdcRawMatchCount: number | null;
    // Human-readable form of the resolved PDC model's own `extraDomain`
    // (e.g. `payment_type = "inbound"`) — what's actually narrowing
    // `pdcRawMatchCount` down to the cheques shown, so a wrong guess about
    // that field's values is visible rather than silent.
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

/**
 * Odoo 17+ moved the receivable/payable distinction onto `account.account`'s
 * own `account_type` field (values like `asset_receivable`); older versions
 * only carry it one hop away via `user_type_id.type`. Detected once via
 * `fields_get` (same "does this field exist" pattern as
 * `getInvoiceSalespersonField`/`getPreferredBrandField`) rather than hardcoded,
 * so the unapplied-payments lookup below works on either version.
 */
async function getReceivableAccountDomainTriple(
    credentials: OdooCredentials,
    uid: number
): Promise<[string, string, string]> {
    const fields = await executeKw<Record<string, { string?: string }>>(
        credentials,
        uid,
        "account.account",
        "fields_get",
        [["account_type"]],
        { attributes: ["string"] }
    );

    return fields.account_type
        ? ["account_id.account_type", "=", "asset_receivable"]
        : ["account_id.user_type_id.type", "=", "receivable"];
}

type PdcModelInfo = {
    model: string;
    partnerField: string;
    numberField: string;
    dateField: string;
    amountField: string;
    stateField: string | null;
    bankField: string | null;
    currencyField: string | null;
    // Boolean field where `true` means the cheque already cleared/reconciled
    // (e.g. `account.payment.is_reconciled`) — a more reliable "pending"
    // signal than guessing from state text, when the model has one.
    pendingField: string | null;
    // A Selection field stores a short internal code ("draft") while
    // displaying a human label ("Registered") — verified live: every cheque
    // on one addon's model read back as the same code regardless of its real
    // status, because the record's raw stored value, not its label, was
    // being read and matched against. `null` when `stateField` isn't a
    // selection field (nothing to translate).
    stateFieldSelectionLabelByValue: Record<string, string> | null;
    // Boolean field where `true` means the cheque has been physically
    // deposited at the bank — a cross-cutting flag independent of
    // `stateField` (verified live: a cheque can be state "Registered" with
    // this either set or not), tracked as its own "Total Deposit" figure
    // rather than folded into the pending total.
    depositField: string | null;
    // Extra domain conditions this particular PDC source always needs (e.g.
    // scoping the shared `account.payment` model down to just PDC-method,
    // inbound rows) — empty for a model that's already PDC-only.
    extraDomain: unknown[];
};

// Surfaced back to the UI whenever PDC detection comes up empty, so the
// actual reason (no PDC-shaped payment method, no cheque-shaped model, or an
// outright error talking to Odoo) is visible on the page instead of a single
// unexplained "not detected" message.
type PdcDiagnostics = {
    paymentMethods: Array<{ code: string; name: string; paymentType: string }>;
    matchedPaymentMethodCode: string | null;
    candidateModels: Array<{ model: string; name: string; transient: boolean }>;
    // Every field anywhere in the database whose own technical name mentions
    // "pdc"/"cheque" — this catches an addon that tags an existing model
    // (typically `account.payment`) with a new field rather than adding a
    // whole new model (see `base_accounting_kit`'s `account.payment` fields),
    // which a model-name-only search would miss entirely.
    fieldMatches: Array<{ model: string; modelLabel: string; field: string; fieldLabel: string; transient: boolean }>;
    // What following `res.partner.pdc_ids`/`pdc_records` found, whether or
    // not it ended up usable — populated whenever that relation exists, so a
    // failure here is diagnosable (wrong/blocked target model, no field on
    // it that looks like a partner link, or no usable amount/date field)
    // instead of silently falling through to the next strategy.
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
};

/**
 * Post-dated cheques rarely get a model of their own, and different PDC
 * addons disagree on how they're stored, so this tries three
 * increasingly-broad strategies in order, stopping at the first that
 * produces a usable shape (a model with a partner-pointing field, an amount
 * field, and a date field):
 *
 * 1. A payment method whose `code` is `"pdc"` (or is otherwise obviously
 *    PDC-shaped) — the Cybrosys "Accounting Kit" convention, where a PDC
 *    cheque is just an `account.payment` tagged that way, with a few extra
 *    fields (`effective_date`, `cheque_reference`, `bank_reference`).
 * 2. Following `res.partner.pdc_ids`/`pdc_records` (a "this customer's PDC
 *    cheques" relation some addons add directly to the partner) to whatever
 *    model it actually points to, resolved authoritatively via
 *    `ir.model.fields`'s `relation`/`relation_field` rather than guessed —
 *    this is what finds an addon (e.g. one that also tags
 *    `account.move.pdc_payment_ids`/`pdc_id`) whose real cheque model has no
 *    "pdc"/"cheque" in its own name or fields at all.
 * 3. Any OTHER model (never a general-ledger model — see `NEVER_PDC_MODELS`;
 *    matching one of those risks treating every invoice/bill/payment as a
 *    pending cheque, which is worse than showing nothing) that has a field
 *    whose own name mentions "pdc"/"cheque", found via `ir.model.fields`
 *    rather than guessing the *model's* name — this is what finds an addon
 *    like Softhealer's, which tags a dedicated, oddly-named persistent model
 *    this way.
 * 4. A model whose own name mentions "cheque"/"pdc" (`ir.model`), for an
 *    addon that doesn't add any distinctively-named field either.
 *
 * All four skip transient models (Odoo's `ir.model.transient` flag) — a
 * wizard's records don't persist, so one can never hold the report's PDC
 * data no matter how promising its name looks (e.g. Softhealer's own
 * `pdc.wizard`).
 */
async function getPdcModelInfo(
    credentials: OdooCredentials,
    uid: number
): Promise<{ info: PdcModelInfo | null; debug: PdcDiagnostics }> {
    const debug: PdcDiagnostics = {
        paymentMethods: [],
        matchedPaymentMethodCode: null,
        candidateModels: [],
        fieldMatches: [],
        relationProbe: null,
        error: null,
    };

    // General-ledger/shared models can never be "the PDC model" — each is
    // already the source of a different section of this report (invoices,
    // unapplied entries, payments), holds every accounting movement for a
    // partner regardless of type, and has no notion of "customer PDC cheque"
    // on its own. Matching one here (e.g. because some addon happened to tag
    // account.move with a pdc-named custom field) would silently sweep in
    // vendor bills, vendor payments, and every other journal entry for the
    // partner as if each were a pending cheque — verified live: this is
    // exactly what inflated one customer's "pending PDC" total ~18x and
    // pulled in a vendor payment reference ("SUPP.OUT/PDC/...").
    const NEVER_PDC_MODELS = new Set([
        "account.move",
        "account.move.line",
        "account.payment",
        "account.bank.statement",
        "account.bank.statement.line",
        "res.partner",
    ]);

    function buildInfoFromFields(
        model: string,
        fields: Record<string, { string?: string; selection?: Array<[string, string]> }>,
        strict: boolean,
        partnerField = "partner_id"
    ): PdcModelInfo | null {
        if (NEVER_PDC_MODELS.has(model) || !fields[partnerField]) {
            return null;
        }

        // `strict` applies when the model was matched only because some
        // field on it happens to be pdc/cheque-named (Strategy 3 below) —
        // the model's own name gives no assurance it's actually dedicated to
        // PDC, so generic field names like "amount_total"/"date" (which any
        // ledger-ish model can have) aren't trusted as the amount/date
        // fields there. A model whose own *name* is cheque/pdc-shaped
        // (Strategy 4), or one reached by directly following a partner's own
        // `pdc_ids`/`pdc_records` relation (Strategy 2), is trustworthy
        // enough to accept those generic fallbacks.
        // `payment_amount`/`payment_date` verified live on a real addon's PDC
        // model (one whose whole field set — `payment_amount`, `payment_date`,
        // `payment_type`, `partner_id` — mirrors `account.payment`'s own
        // naming, despite the model itself being named unhelpfully
        // "pdc.wizard"), so both are trusted even in `strict` mode: neither
        // is a name generic enough to show up on an unrelated model by
        // accident the way "amount_total"/"date" are.
        const amountField = (strict
            ? ["cheque_amount", "pdc_amount", "payment_amount", "signed_amount"]
            : ["cheque_amount", "pdc_amount", "payment_amount", "signed_amount", "amount", "amount_total"]
        ).find((f) => fields[f]);
        const dateField = (strict
            ? ["cheque_date", "pdc_date", "check_date", "due_date", "payment_date"]
            : ["cheque_date", "pdc_date", "check_date", "due_date", "payment_date", "effective_date", "date"]
        ).find((f) => fields[f]);

        if (!amountField || !dateField) {
            return null;
        }

        // `state`/`status` is preferred over a PDC-specific-*named* field
        // like `cheque_status` — counterintuitively verified live: one
        // addon's `cheque_status` sat permanently at "Draft" on every
        // record regardless of its real status (effectively an unused/decoy
        // field), while the model's own generic `state` was what actually
        // carried the real lifecycle ("Done", etc.). A model can still have
        // both; only fall back to a `cheque_status`/`pdc_state`-named field
        // when there's no `state`/`status` at all to prefer instead.
        // `state`/`status` preferred over a PDC-specific-*named* field like
        // `cheque_status` — counterintuitively verified live: one addon's
        // `cheque_status` sat permanently at "Draft" on every record
        // regardless of its real status (effectively an unused/decoy
        // field), while the model's own generic `state` was what actually
        // carried the real lifecycle ("Registered", "Done", etc.).
        const stateField = ["state", "status", "cheque_status", "pdc_state"].find((f) => fields[f]) ?? null;

        function selectionLabelMapFor(fieldName: string): Record<string, string> | null {
            const selection = fields[fieldName]?.selection;
            return selection
                ? Object.fromEntries(selection.map(([value, label]) => [String(value), String(label)]))
                : null;
        }

        return {
            model,
            partnerField,
            numberField:
                ["cheque_number", "pdc_number", "check_number", "reference", "number"].find((f) => fields[f]) ??
                "name",
            dateField,
            amountField,
            stateField,
            stateFieldSelectionLabelByValue: stateField ? selectionLabelMapFor(stateField) : null,
            depositField: ["is_deposit", "is_deposited", "deposited"].find((f) => fields[f]) ?? null,
            bankField: ["bank_id", "issuer_bank", "bank_name"].find((f) => fields[f]) ?? null,
            currencyField: fields.currency_id ? "currency_id" : null,
            pendingField: fields.is_reconciled ? "is_reconciled" : null,
            // No direction filter here (unlike the account.payment strategy
            // above, where "inbound" is a load-bearing core-Odoo constant,
            // not a guess). A guessed value for an unknown model's own
            // direction-shaped field (tried: matching the field's declared
            // option labels against "receive"/"send"-ish keywords) proved
            // unreliable live — it picked a plausible-looking option that
            // matched zero of a customer's 7 real, confirmed cheque records,
            // silently hiding all of them. The partner match alone was
            // already verified to return exactly the right records for that
            // customer, so no further scoping is applied.
            extraDomain: [],
        };
    }

    // Strategy 1: payment-method code.
    try {
        const paymentMethods = await executeKw<Array<Record<string, unknown>>>(
            credentials,
            uid,
            "account.payment.method",
            "search_read",
            [[]],
            { fields: ["code", "name", "payment_type"], limit: 100 }
        );

        debug.paymentMethods = paymentMethods.map((method) => ({
            code: toDisplayString(method.code),
            name: toDisplayString(method.name),
            paymentType: toDisplayString(method.payment_type),
        }));

        const pdcMethod =
            paymentMethods.find((method) => toDisplayString(method.code).toLowerCase() === "pdc") ??
            paymentMethods.find((method) => {
                const code = toDisplayString(method.code).toLowerCase();
                const name = toDisplayString(method.name).toLowerCase();
                const paymentType = toDisplayString(method.payment_type).toLowerCase();
                return (
                    paymentType !== "outbound" &&
                    (code.includes("pdc") ||
                        code.includes("cheque") ||
                        name.includes("pdc") ||
                        name.includes("post-dated") ||
                        name.includes("post dated") ||
                        name.includes("postdated"))
                );
            });

        if (pdcMethod) {
            const matchedCode = toDisplayString(pdcMethod.code);
            debug.matchedPaymentMethodCode = matchedCode;

            const fields = await executeKw<Record<string, { string?: string }>>(
                credentials,
                uid,
                "account.payment",
                "fields_get",
                [["effective_date", "cheque_reference", "bank_reference", "check_number", "is_reconciled", "currency_id"]],
                { attributes: ["string"] }
            );

            return {
                info: {
                    model: "account.payment",
                    partnerField: "partner_id",
                    numberField: fields.cheque_reference ? "cheque_reference" : fields.check_number ? "check_number" : "name",
                    dateField: fields.effective_date ? "effective_date" : "date",
                    amountField: "amount",
                    stateField: "state",
                    stateFieldSelectionLabelByValue: null,
                    depositField: null,
                    bankField: fields.bank_reference ? "bank_reference" : null,
                    currencyField: fields.currency_id ? "currency_id" : null,
                    pendingField: fields.is_reconciled ? "is_reconciled" : null,
                    // Scope the shared account.payment model down to just
                    // inbound customer PDC cheques — everything else on this
                    // model is a regular payment/refund unrelated to PDC.
                    extraDomain: [
                        ["payment_method_id.code", "=", matchedCode],
                        ["payment_type", "=", "inbound"],
                    ],
                },
                debug,
            };
        }
    } catch (error) {
        debug.error = error instanceof Error ? error.message : String(error);
    }

    // Strategy 2: follow `res.partner`'s own `pdc_ids`/`pdc_records`
    // relation (a One2many field an addon adds directly to the partner to
    // list "this customer's PDC cheques") to whatever model it actually
    // points to, via `ir.model.fields`, which records both the target model
    // (`relation`) and the inverse field name on it (`relation_field`) for
    // any relational field — the authoritative answer, not a name/field
    // guess. This is what actually finds an addon (e.g. one that also adds
    // `account.move.pdc_payment_ids`/`pdc_id`) whose real cheque-record model
    // has no "pdc"/"cheque" in its own name or fields at all.
    try {
        // `ttype` intentionally not restricted to "one2many" — a computed
        // `pdc_ids` (very plausible for something aggregating "PDCs relevant
        // to this partner") reports the same `relation` metadata without
        // necessarily setting `relation_field`, since there's no single
        // stored inverse column for the ORM to name.
        const partnerRelationFields = await executeKw<Array<Record<string, unknown>>>(
            credentials,
            uid,
            "ir.model.fields",
            "search_read",
            [[
                ["model", "=", "res.partner"],
                ["name", "in", ["pdc_ids", "pdc_records"]],
            ]],
            { fields: ["name", "relation", "relation_field", "ttype"], limit: 5 }
        );

        const relationField = partnerRelationFields.find((field) => toDisplayString(field.relation));

        if (relationField) {
            const targetModel = toDisplayString(relationField.relation);
            const sourceFieldName = toDisplayString(relationField.name);
            let targetPartnerField = toDisplayString(relationField.relation_field);

            const targetModelMeta = targetModel
                ? await executeKw<Array<{ transient?: boolean }>>(
                    credentials,
                    uid,
                    "ir.model",
                    "search_read",
                    [[["model", "=", targetModel]]],
                    { fields: ["transient"], limit: 1 }
                )
                : [];
            const isTransient = Boolean(targetModelMeta[0]?.transient);
            const isBlocked = Boolean(targetModel) && NEVER_PDC_MODELS.has(targetModel);

            let info: PdcModelInfo | null = null;
            let targetFieldNames: string[] = [];

            if (targetModel && !isTransient && !isBlocked) {
                const targetFields = await executeKw<
                    Record<string, { string?: string; type?: string; relation?: string; selection?: Array<[string, string]> }>
                >(
                    credentials,
                    uid,
                    targetModel,
                    "fields_get",
                    [],
                    { attributes: ["string", "type", "relation", "selection"] }
                );
                targetFieldNames = Object.keys(targetFields).sort();

                // No stored inverse field name (see above) — find any
                // many2one on the target that itself points back to
                // res.partner, preferring one that reads like a partner
                // field over an incidental one (e.g. "created_by").
                if (!targetPartnerField || !targetFields[targetPartnerField]) {
                    const partnerLinkCandidates = Object.entries(targetFields)
                        .filter(([, field]) => field.type === "many2one" && field.relation === "res.partner")
                        .map(([name]) => name);
                    targetPartnerField =
                        partnerLinkCandidates.find((name) => name.includes("partner") || name.includes("customer")) ??
                        partnerLinkCandidates[0] ??
                        "";
                }

                if (targetPartnerField) {
                    info = buildInfoFromFields(targetModel, targetFields, false, targetPartnerField);
                }
            }

            debug.relationProbe = {
                sourceField: sourceFieldName,
                targetModel,
                targetPartnerField,
                targetModelBlocked: isBlocked,
                targetModelTransient: isTransient,
                resolved: Boolean(info),
                targetModelFields: targetFieldNames,
            };

            if (info) {
                return { info, debug };
            }
        }
    } catch (error) {
        debug.error = debug.error ?? (error instanceof Error ? error.message : String(error));
    }

    // Strategy 3: any field anywhere named like a cheque/PDC field, on a
    // persistent model other than account.payment.
    try {
        const fieldMatches = await executeKw<Array<Record<string, unknown>>>(
            credentials,
            uid,
            "ir.model.fields",
            "search_read",
            [["|", ["name", "ilike", "pdc"], ["name", "ilike", "cheque"]]],
            { fields: ["model", "name", "field_description"], limit: 200 }
        );

        const distinctModelNames = Array.from(
            new Set(fieldMatches.map((field) => toDisplayString(field.model)).filter(Boolean))
        );

        const modelMeta = distinctModelNames.length > 0
            ? await executeKw<Array<Record<string, unknown>>>(
                credentials,
                uid,
                "ir.model",
                "search_read",
                [[["model", "in", distinctModelNames]]],
                { fields: ["model", "name", "transient"] }
            )
            : [];
        const modelLabelByName = new Map(modelMeta.map((m) => [toDisplayString(m.model), toDisplayString(m.name)]));
        const transientByName = new Map(modelMeta.map((m) => [toDisplayString(m.model), Boolean(m.transient)]));

        debug.fieldMatches = fieldMatches.map((field) => {
            const model = toDisplayString(field.model);
            return {
                model,
                modelLabel: modelLabelByName.get(model) ?? "",
                field: toDisplayString(field.name),
                fieldLabel: toDisplayString(field.field_description),
                transient: transientByName.get(model) ?? false,
            };
        });

        const persistentCandidates = distinctModelNames.filter(
            (model) => !NEVER_PDC_MODELS.has(model) && !transientByName.get(model)
        );

        for (const model of persistentCandidates) {
            try {
                const fields = await executeKw<Record<string, { string?: string; selection?: Array<[string, string]> }>>(
                    credentials,
                    uid,
                    model,
                    "fields_get",
                    [],
                    { attributes: ["string", "type", "selection"] }
                );

                const info = buildInfoFromFields(model, fields, true);
                if (info) {
                    return { info, debug };
                }
            } catch {
                continue;
            }
        }
    } catch (error) {
        debug.error = debug.error ?? (error instanceof Error ? error.message : String(error));
    }

    // Strategy 4: a model whose own name mentions cheque/pdc.
    try {
        const candidateModels = await executeKw<Array<Record<string, unknown>>>(
            credentials,
            uid,
            "ir.model",
            "search_read",
            [["|", ["model", "ilike", "cheque"], ["model", "ilike", "pdc"]]],
            { fields: ["model", "name", "transient"], limit: 15 }
        );
        debug.candidateModels = candidateModels.map((candidate) => ({
            model: toDisplayString(candidate.model),
            name: toDisplayString(candidate.name),
            transient: Boolean(candidate.transient),
        }));

        for (const candidate of debug.candidateModels) {
            if (candidate.transient) {
                continue;
            }

            try {
                const fields = await executeKw<Record<string, { string?: string; selection?: Array<[string, string]> }>>(
                    credentials,
                    uid,
                    candidate.model,
                    "fields_get",
                    [],
                    { attributes: ["string", "type", "selection"] }
                );

                const info = buildInfoFromFields(candidate.model, fields, false);
                if (info) {
                    return { info, debug };
                }
            } catch {
                // Not a usable candidate (e.g. no read access) — try the next one.
                continue;
            }
        }
    } catch (error) {
        debug.error = debug.error ?? (error instanceof Error ? error.message : String(error));
    }

    return { info: null, debug };
}

function getAgingBucket(daysOverdue: number): PaymentFollowupAgingBucket {
    if (daysOverdue <= 0) return "notDue";
    if (daysOverdue <= 30) return "d1_30";
    if (daysOverdue <= 60) return "d31_60";
    if (daysOverdue <= 90) return "d61_90";
    if (daysOverdue <= 120) return "d91_120";
    return "older";
}

// How many calendar-month boundaries separate two "YYYY-MM-DD" dates —
// e.g. an Aug 31 reference date and a Sep 5 as-of date are 1 apart, same
// as an Aug 1 reference date, even though the two are 5 and 35 days apart
// respectively. That's the whole point of the "month" aging system below:
// group by which calendar month something fell in, not by a fixed day
// window.
function monthsElapsedBetween(referenceDateIso: string, asOfDateIso: string): number {
    const [refYear, refMonth] = referenceDateIso.split("-").map(Number);
    const [asOfYear, asOfMonth] = asOfDateIso.split("-").map(Number);
    return (asOfYear * 12 + asOfMonth) - (refYear * 12 + refMonth);
}

// Calendar-month analogue of `getAgingBucket`. Anything whose reference date
// (due or invoice date, per the report's date basis) falls in the as-of
// date's own calendar month — or later — is still "not due": it only starts
// ageing once that month has ended, then moves one bracket per month crossed
// (1 month, 2 months, ... "older" from 5 months). So an invoice due on
// Oct 3 reads as Not Due all through October and shows up under "1 Month"
// on Nov 1.
function getAgingBucketByMonth(monthsElapsed: number): PaymentFollowupAgingBucket {
    if (monthsElapsed <= 0) return "notDue";
    if (monthsElapsed === 1) return "d1_30";
    if (monthsElapsed === 2) return "d31_60";
    if (monthsElapsed === 3) return "d61_90";
    if (monthsElapsed === 4) return "d91_120";
    return "older";
}

function resolveAgingBucket(
    daysOverdue: number,
    referenceDateIso: string,
    asOfDateIso: string,
    agingSystem: "day" | "month"
): PaymentFollowupAgingBucket {
    if (agingSystem === "day") {
        return getAgingBucket(daysOverdue);
    }
    return getAgingBucketByMonth(referenceDateIso ? monthsElapsedBetween(referenceDateIso, asOfDateIso) : 0);
}

type PdcReceivableMatch = { matched: boolean; unmatchedRatio: number; unmatchedLineIds: number[] };

/**
 * For each PDC cheque record, whether its Accounts Receivable journal item is
 * matched, and how much of it is still open. Found by the cheque's own record
 * id first: any many2one on `account.move.line` pointing at the cheque's model
 * (`payment_id` for `account.payment`) is queried with the id. Cheques that way
 * finds nothing for are then resolved through their journal entry (`move_id`,
 * or a `payment_id` whose payment owns the entry). Records with no receivable
 * item at all are simply absent from the result.
 */
async function getPdcReceivableMatches(
    credentials: OdooCredentials,
    uid: number,
    model: string,
    recordIds: number[],
    receivableTriple: unknown
): Promise<Map<number, PdcReceivableMatch>> {
    const result = new Map<number, PdcReceivableMatch>();
    if (recordIds.length === 0) {
        return result;
    }

    type Totals = { balance: number; residual: number; unmatchedLineIds: number[] };
    const add = (map: Map<number, Totals>, key: number, line: Record<string, unknown>) => {
        const totals = map.get(key) ?? { balance: 0, residual: 0, unmatchedLineIds: [] };
        totals.balance += Math.abs(Number(line.balance ?? 0));
        totals.residual += Math.abs(Number(line.amount_residual ?? 0));
        if (Math.abs(Number(line.amount_residual ?? 0)) >= 0.005) totals.unmatchedLineIds.push(Number(line.id));
        map.set(key, totals);
    };
    const finish = (recordId: number, totals: Totals) => {
        const unmatchedRatio = totals.balance > 0 ? Math.min(Math.max(totals.residual / totals.balance, 0), 1) : 0;
        result.set(recordId, { matched: totals.residual < 0.005, unmatchedRatio, unmatchedLineIds: totals.unmatchedLineIds });
    };

    // 1. Direct: receivable journal items that point at the cheque record itself.
    const lineMeta = await executeKw<Record<string, { type?: string; relation?: string }>>(
        credentials,
        uid,
        "account.move.line",
        "fields_get",
        [],
        { attributes: ["type", "relation"] }
    );
    const directFields = Object.entries(lineMeta)
        .filter(([, meta]) => meta.type === "many2one" && meta.relation === model)
        .map(([name]) => name);

    for (const field of directFields) {
        const lines = await searchReadAll(
            credentials,
            uid,
            "account.move.line",
            [[field, "in", recordIds], receivableTriple, ["parent_state", "=", "posted"]],
            [field, "balance", "amount_residual"]
        );
        const byRecord = new Map<number, Totals>();
        for (const line of lines) {
            const recordId = getRelationalId(line[field]);
            if (recordId) add(byRecord, recordId, line);
        }
        for (const [recordId, totals] of byRecord) {
            if (!result.has(recordId)) finish(recordId, totals);
        }
    }

    // 2. Fallback for the rest: through the cheque's journal entry.
    const remainingIds = recordIds.filter((id) => !result.has(id));
    if (remainingIds.length === 0) {
        return result;
    }

    const candidates = ["move_id", "payment_id", "account_move_id", "journal_entry_id"];
    const meta = await executeKw<Record<string, { type?: string; relation?: string }>>(
        credentials,
        uid,
        model,
        "fields_get",
        [candidates],
        { attributes: ["type", "relation"] }
    );

    const moveIdByRecordId = new Map<number, number>();
    for (const field of candidates) {
        const relation = meta[field]?.relation;
        if (!relation || (relation !== "account.move" && relation !== "account.payment")) {
            continue;
        }

        const records = await readInBatches(credentials, uid, model, remainingIds, ["id", field]);
        if (relation === "account.move") {
            for (const record of records) {
                const moveId = getRelationalId(record[field]);
                if (moveId && !moveIdByRecordId.has(Number(record.id))) moveIdByRecordId.set(Number(record.id), moveId);
            }
            continue;
        }

        const paymentIds = Array.from(new Set(records.map((record) => getRelationalId(record[field])).filter((id): id is number => !!id)));
        const payments = paymentIds.length > 0 ? await readInBatches(credentials, uid, "account.payment", paymentIds, ["id", "move_id"]) : [];
        const moveIdByPaymentId = new Map(payments.map((payment) => [Number(payment.id), getRelationalId(payment.move_id)]));
        for (const record of records) {
            const paymentId = getRelationalId(record[field]);
            const moveId = paymentId ? moveIdByPaymentId.get(paymentId) : null;
            if (moveId && !moveIdByRecordId.has(Number(record.id))) moveIdByRecordId.set(Number(record.id), moveId);
        }
    }

    const moveIds = Array.from(new Set(moveIdByRecordId.values()));
    if (moveIds.length === 0) {
        return result;
    }

    const lines = await searchReadAll(
        credentials,
        uid,
        "account.move.line",
        [["move_id", "in", moveIds], receivableTriple, ["parent_state", "=", "posted"]],
        ["move_id", "balance", "amount_residual"]
    );
    const totalsByMoveId = new Map<number, Totals>();
    for (const line of lines) {
        const moveId = getRelationalId(line.move_id);
        if (moveId) add(totalsByMoveId, moveId, line);
    }
    for (const [recordId, moveId] of moveIdByRecordId) {
        const totals = totalsByMoveId.get(moveId);
        if (totals) finish(recordId, totals);
    }
    return result;
}

/**
 * Shared report builder behind both `getPaymentFollowupForSalesperson` and
 * `getPaymentFollowupForCustomer`. For each of the given (already-canonical,
 * i.e. commercial partner) `customerIds`, combines three independent signals
 * of what's actually still owed:
 *
 * 1. Open invoices/credit notes (`account.move`, `amount_residual` — what
 *    Odoo itself considers unpaid).
 * 2. Unreconciled receivable journal entries with no invoice attached
 *    (`account.move.line` on the receivable account, `reconciled = false`,
 *    `move_type = "entry"`) — money the customer already paid that was never
 *    applied to an invoice, which a residual-only view would miss entirely.
 * 3. Pending post-dated cheques from whichever PDC addon (if any) is
 *    installed — see `getPdcModelInfo`.
 */
async function buildPaymentFollowupReport(
    credentials: OdooCredentials,
    uid: number,
    customerIds: number[],
    scope: "salesperson" | "customer",
    salesperson: SalespersonOption | null,
    asOfDate: string,
    dateBasis: "due" | "invoice",
    agingSystem: "day" | "month"
): Promise<PaymentFollowupReport> {
    const todayStr = asOfDate;
    const todayMs = new Date(`${todayStr}T00:00:00Z`).getTime();

    if (customerIds.length === 0) {
        return {
            scope,
            salesperson,
            asOfDate: todayStr,
            dateBasis,
            agingSystem,
            currencyCode: TARGET_CURRENCY_CODE,
            pdcModuleDetected: false,
            pdcDebug: null,
            pdcRawMatchCount: null,
            pdcAppliedFilters: [],
            customers: [],
            totals: {
                totalInvoiceDue: 0,
                totalUnapplied: 0,
                totalPdcPending: 0,
                totalPdcDeposited: 0,
                totalPayableDue: 0,
                netDue: 0,
                agingBuckets: emptyAgingTotals(),
            },
        };
    }

    const partnerFields = await getAvailablePartnerFields(credentials, uid);
    const customerRecords = await readPartnersByIds(credentials, uid, customerIds, partnerFields);
    const customerRecordById = new Map<number, Record<string, unknown>>();
    for (const record of customerRecords) {
        customerRecordById.set(Number(record.id ?? 0), record);
    }

    const [invoices, payableBills, receivableTriple, pdcLookup] = await Promise.all([
        searchReadAll(
            credentials,
            uid,
            "account.move",
            [
                ["commercial_partner_id", "in", customerIds],
                ["move_type", "in", ["out_invoice", "out_refund"]],
                ["state", "=", "posted"],
                ["payment_state", "not in", ["paid", "in_payment", "reversed"]],
            ],
            [
                "id",
                "name",
                "move_type",
                "commercial_partner_id",
                "invoice_date",
                "invoice_date_due",
                "invoice_payment_term_id",
                "amount_total",
                "amount_residual",
                "currency_id",
            ],
            { order: "invoice_date_due asc" }
        ),
        // Vendor bills/refunds against the same partner — a customer who is
        // also a supplier (verified live: not unusual in this business) is
        // owed money by us on this side, which needs to offset what they owe
        // us before "net due" means anything, not just be silently ignored.
        searchReadAll(
            credentials,
            uid,
            "account.move",
            [
                ["commercial_partner_id", "in", customerIds],
                ["move_type", "in", ["in_invoice", "in_refund"]],
                ["state", "=", "posted"],
                ["payment_state", "not in", ["paid", "in_payment", "reversed"]],
            ],
            ["id", "name", "move_type", "commercial_partner_id", "invoice_date", "invoice_date_due", "invoice_payment_term_id", "amount_total", "amount_residual", "currency_id"]
        ),
        getReceivableAccountDomainTriple(credentials, uid),
        getPdcModelInfo(credentials, uid).catch((error) => ({
            info: null,
            debug: {
                paymentMethods: [],
                matchedPaymentMethodCode: null,
                candidateModels: [],
                fieldMatches: [],
                relationProbe: null,
                error: error instanceof Error ? error.message : String(error),
            },
        })),
    ]);
    const pdcInfo = pdcLookup.info;
    const pdcDebug = pdcLookup.debug;

    // Every unreconciled receivable-account line on a plain journal entry
    // (not an invoice/bill/payment — move_type "entry" covers manual
    // journals like "MISC" or "PDC"), regardless of debit/credit direction:
    // a negative balance is a credit not yet applied to an invoice (money
    // already received); a positive balance is a debit not backed by any
    // invoice at all (e.g. a carried-forward opening balance, or a bounced
    // cheque re-debited to the customer) — previously excluded entirely by
    // a `balance < 0` filter here, which silently dropped genuine debt that
    // only ever existed as a manual journal entry. Split by sign below:
    // credits keep netting against invoices as unapplied payments; debits
    // are folded in as invoice-like charges of their own.
    const unappliedLines = await searchReadAll(
        credentials,
        uid,
        "account.move.line",
        [
            ["move_id.commercial_partner_id", "in", customerIds],
            ["move_id.state", "=", "posted"],
            ["move_id.move_type", "=", "entry"],
            receivableTriple,
            ["reconciled", "=", false],
            ["balance", "!=", 0],
        ],
        ["id", "move_id", "date", "balance", "amount_currency", "currency_id"]
    );

    const unappliedMoveIds = Array.from(
        new Set(
            unappliedLines
                .map((line) => getRelationalId(line.move_id))
                .filter((id): id is number => typeof id === "number")
        )
    );
    const unappliedMoves = unappliedMoveIds.length > 0
        ? await readInBatches(credentials, uid, "account.move", unappliedMoveIds, [
            "id",
            "name",
            "ref",
            "commercial_partner_id",
            "journal_id",
        ])
        : [];
    const unappliedMoveById = new Map<number, Record<string, unknown>>();
    for (const move of unappliedMoves) {
        unappliedMoveById.set(Number(move.id ?? 0), move);
    }

    let pdcRecords: Array<Record<string, unknown>> = [];
    if (pdcInfo) {
        try {
            const pdcFields = [
                "id",
                pdcInfo.partnerField,
                pdcInfo.numberField,
                pdcInfo.dateField,
                pdcInfo.amountField,
            ];
            if (pdcInfo.stateField) pdcFields.push(pdcInfo.stateField);
            if (pdcInfo.bankField) pdcFields.push(pdcInfo.bankField);
            if (pdcInfo.currencyField) pdcFields.push(pdcInfo.currencyField);
            if (pdcInfo.pendingField) pdcFields.push(pdcInfo.pendingField);
            if (pdcInfo.depositField) pdcFields.push(pdcInfo.depositField);

            pdcRecords = await searchReadAll(
                credentials,
                uid,
                pdcInfo.model,
                [
                    // Dot-path traversal, not a domain on `partnerField`
                    // itself — the cheque's own partner can be a child
                    // contact rather than the commercial partner `customerIds`
                    // is keyed by (e.g. a PDC registered on a company's
                    // "Accounts Payable" sub-contact).
                    [`${pdcInfo.partnerField}.commercial_partner_id`, "in", customerIds],
                    ...pdcInfo.extraDomain,
                ],
                Array.from(new Set(pdcFields))
            );
        } catch {
            pdcRecords = [];
        }
    }

    // Diagnostic only, not used for the report itself — how many records in
    // the resolved PDC model match this scope's partners *before* applying
    // `extraDomain` (e.g. the `payment_type = "inbound"` guard). Lets the UI
    // tell apart "this customer/salesperson genuinely has none" from "our
    // direction/state filter is excluding real cheques", without which a
    // wrong guess about the addon's own field values (verified live: risked
    // exactly this) would look identical to a customer with none.
    let pdcRawMatchCount: number | null = null;
    if (pdcInfo) {
        try {
            pdcRawMatchCount = await executeKw<number>(
                credentials,
                uid,
                pdcInfo.model,
                "search_count",
                [[[`${pdcInfo.partnerField}.commercial_partner_id`, "in", customerIds]]]
            );
        } catch {
            pdcRawMatchCount = null;
        }
    }

    // Each cheque's Accounts Receivable journal item: if it isn't matched (or only
    // partly), that unmatched amount comes off what the customer owes.
    let receivableMatchByRecordId = new Map<number, PdcReceivableMatch>();
    if (pdcInfo && pdcRecords.length > 0) {
        try {
            receivableMatchByRecordId = await getPdcReceivableMatches(
                credentials,
                uid,
                pdcInfo.model,
                pdcRecords.map((record) => Number(record.id)).filter((id) => id > 0),
                receivableTriple
            );
        } catch {
            // No usable link on this PDC model: fall back to the cheque's own state below.
            receivableMatchByRecordId = new Map();
        }
    }

    // Resolve each cheque's own partner to the canonical (commercial)
    // customer it should be grouped under, same as the invoice/unapplied
    // sections — the query above matches on `commercial_partner_id` but
    // still returns each record's direct `partner_id`.
    const pdcPartnerIds = pdcInfo
        ? Array.from(
            new Set(
                pdcRecords
                    .map((record) => getRelationalId(record[pdcInfo.partnerField]))
                    .filter((id): id is number => typeof id === "number")
            )
        )
        : [];
    const pdcCanonicalMap = pdcPartnerIds.length > 0
        ? await getCanonicalCustomerMap(credentials, uid, pdcPartnerIds)
        : new Map<number, Record<string, unknown>>();

    // Currency conversion (to AED, the currency every other blended total in
    // this app is expressed in — see `TARGET_CURRENCY_CODE`) follows the same
    // approach as `getSalespersonMonthlyInvoices`: each amount stays in its own
    // transaction currency for display, and is only converted for the totals.
    const currencyIdsSeen = new Set<number>();
    for (const invoice of invoices) {
        const id = getRelationalId(invoice.currency_id);
        if (id) currencyIdsSeen.add(id);
    }
    for (const bill of payableBills) {
        const id = getRelationalId(bill.currency_id);
        if (id) currencyIdsSeen.add(id);
    }
    for (const line of unappliedLines) {
        const id = getRelationalId(line.currency_id);
        if (id) currencyIdsSeen.add(id);
    }
    if (pdcInfo?.currencyField) {
        for (const record of pdcRecords) {
            const id = getRelationalId(record[pdcInfo.currencyField]);
            if (id) currencyIdsSeen.add(id);
        }
    }

    const primaryCurrencyId = await getPrimaryCurrencyId(
        credentials,
        uid,
        Array.from(currencyIdsSeen).map((currencyId) => ({ currencyId }))
    );
    const homeCompanyId = await getHomeCompanyId(credentials, uid);
    const nonPrimaryCurrencyIds = Array.from(currencyIdsSeen).filter((id) => id !== primaryCurrencyId);
    const rateByCurrencyId = homeCompanyId && nonPrimaryCurrencyIds.length > 0
        ? await getCurrencyRatesToHomeCurrency(credentials, uid, homeCompanyId, nonPrimaryCurrencyIds, todayStr)
        : new Map<number, number>();
    const multiplierByCurrencyId = buildCurrencyMultipliers(primaryCurrencyId, rateByCurrencyId);

    function toHomeAmount(amount: number, currencyId: number | null): number {
        if (!currencyId) return amount;
        const multiplier = multiplierByCurrencyId.get(currencyId);
        return typeof multiplier === "number" ? amount * multiplier : amount;
    }

    const rowByCustomerId = new Map<number, PaymentFollowupCustomerRow>();
    function ensureRow(customerId: number): PaymentFollowupCustomerRow {
        const existing = rowByCustomerId.get(customerId);
        if (existing) return existing;

        const record = customerRecordById.get(customerId);
        const summary = record
            ? toCustomerSummary(record, salesperson?.name ?? "-")
            : {
                customerId,
                customerName: `Customer #${customerId}`,
                salespersonName: salesperson?.name ?? "-",
                email: "",
                phone: "",
                street: "",
                city: "",
            };

        const row: PaymentFollowupCustomerRow = {
            customerId,
            customerName: summary.customerName,
            salespersonName: summary.salespersonName,
            email: summary.email,
            phone: summary.phone,
            street: summary.street,
            city: summary.city,
            currencyCode: TARGET_CURRENCY_CODE,
            totalInvoiceDue: 0,
            totalUnapplied: 0,
            totalPdcPending: 0,
            totalPdcDeposited: 0,
            totalPayableDue: 0,
            netDue: 0,
            oldestDueDate: "",
            maxDaysOverdue: -Infinity,
            agingBucket: "notDue",
            agingBuckets: emptyAgingTotals(),
            invoices: [],
            unappliedPayments: [],
            cheques: [],
        };
        rowByCustomerId.set(customerId, row);
        return row;
    }

    // Each open invoice's residual converted to home currency, captured here
    // (rather than recomputed later) since only currency-aware code in this
    // scope knows how — used by the FIFO unapplied-credit netting below to
    // find the true oldest still-outstanding invoice.
    const invoiceHomeResidualById = new Map<number, number>();
    // Which aging-matrix bucket each invoice's net amount should land in,
    // per the selected `agingSystem` — kept separate from the invoice's own
    // `agingBucket` field (always day-based; feeds the per-invoice line
    // badge only, which stays exact-days regardless of this toggle) since
    // the two can disagree once `agingSystem === "month"`.
    const invoiceMatrixBucketById = new Map<number, PaymentFollowupAgingBucket>();

    for (const invoice of invoices) {
        const customerId = getRelationalId(invoice.commercial_partner_id);
        if (!customerId) continue;

        const currencyId = getRelationalId(invoice.currency_id);
        const currencyCode = getRelationalName(invoice.currency_id) || TARGET_CURRENCY_CODE;
        const moveType = invoice.move_type === "out_refund" ? "out_refund" : "out_invoice";
        const residual = Number(invoice.amount_residual ?? 0);
        const invoiceDate = normalizeOdooDate(invoice.invoice_date);
        const dueDate = normalizeOdooDate(invoice.invoice_date_due) || invoiceDate;
        // "Due Date" (the default, matching Odoo's own Aged Receivable) ages
        // from when payment is actually expected; "Invoice Date" ages from
        // when the invoice was raised instead — same toggle Odoo's report
        // offers, since a customer can want either view of the same data.
        const agingReferenceDate = dateBasis === "invoice" ? invoiceDate : dueDate;
        const agingMs = agingReferenceDate ? new Date(`${agingReferenceDate}T00:00:00Z`).getTime() : todayMs;
        const daysOverdue = Math.round((todayMs - agingMs) / 86400000);
        const bucket = getAgingBucket(daysOverdue);
        const matrixBucket = resolveAgingBucket(daysOverdue, agingReferenceDate, todayStr, agingSystem);

        const row = ensureRow(customerId);
        row.invoices.push({
            invoiceId: Number(invoice.id),
            invoiceNumber: toDisplayString(invoice.name),
            moveType,
            invoiceDate,
            dueDate,
            paymentTermsName: getRelationalName(invoice.invoice_payment_term_id) || "-",
            amountTotal: Number(Number(invoice.amount_total ?? 0).toFixed(2)),
            amountResidual: Number(residual.toFixed(2)),
            currencyCode,
            daysOverdue,
            agingBucket: bucket,
        });
        invoiceMatrixBucketById.set(Number(invoice.id), matrixBucket);

        if (moveType === "out_refund") {
            // Credit notes aren't touched by the FIFO credit-netting pass
            // below (that's specifically for applying *unapplied payments*
            // against open invoices) — accumulate them into their bucket
            // immediately, same as before. `totalInvoiceDue` itself is
            // derived from the buckets once everything (this, the FIFO pass,
            // and payables) has been folded in, further down.
            const signedHomeAmount = -toHomeAmount(residual, currencyId);
            row.agingBuckets[matrixBucket] = Number((row.agingBuckets[matrixBucket] + signedHomeAmount).toFixed(2));
        } else if (residual > 0) {
            // Deliberately NOT added to `agingBuckets` here — the FIFO pass
            // below adds each invoice's *net* (post unapplied-credit) amount
            // instead, oldest invoice first, so
            // "Open Invoices Due" and the aging matrix both already reflect
            // unapplied credit rather than needing it subtracted again.
            invoiceHomeResidualById.set(Number(invoice.id), toHomeAmount(residual, currencyId));
        }
    }

    // Vendor bills/refunds against the same partner — what we owe them.
    // `totalPayableDue` (below) is the informational running total shown on
    // its own stat card, same treatment as `totalUnapplied`; separately,
    // each bill is also aged by its own due/invoice date (same `dateBasis`
    // toggle as receivables) and subtracted directly from that bucket in the
    // Aged Receivables matrix, so a payable due *now* offsets a receivable
    // due *now* rather than being netted against the total as one lump sum
    // regardless of either side's own timing.
    for (const bill of payableBills) {
        const customerId = getRelationalId(bill.commercial_partner_id);
        if (!customerId) continue;

        const currencyId = getRelationalId(bill.currency_id);
        const residual = Number(bill.amount_residual ?? 0);
        const moveType = bill.move_type === "in_refund" ? -1 : 1;
        const signedHomeAmount = toHomeAmount(residual, currencyId) * moveType;

        const row = ensureRow(customerId);
        row.totalPayableDue = Number((row.totalPayableDue + signedHomeAmount).toFixed(2));

        const billInvoiceDate = normalizeOdooDate(bill.invoice_date);
        const billDueDate = normalizeOdooDate(bill.invoice_date_due) || billInvoiceDate;
        const billAgingReferenceDate = dateBasis === "invoice" ? billInvoiceDate : billDueDate;
        const billAgingMs = billAgingReferenceDate ? new Date(`${billAgingReferenceDate}T00:00:00Z`).getTime() : todayMs;
        const billDaysOverdue = Math.round((todayMs - billAgingMs) / 86400000);
        const billBucket = resolveAgingBucket(billDaysOverdue, billAgingReferenceDate, todayStr, agingSystem);

        row.agingBuckets[billBucket] = Number((row.agingBuckets[billBucket] - signedHomeAmount).toFixed(2));

        // Listed alongside the invoices, like Odoo's Aged Payable report. Display
        // only — the bucket effect is already applied just above, and these rows
        // never enter the FIFO credit-netting pass (it only takes invoices/entries).
        row.invoices.push({
            invoiceId: Number(bill.id),
            invoiceNumber: toDisplayString(bill.name) || "-",
            moveType: bill.move_type === "in_refund" ? "vendorRefund" : "vendorBill",
            invoiceDate: billInvoiceDate,
            dueDate: billDueDate,
            paymentTermsName: getRelationalName(bill.invoice_payment_term_id) || "-",
            amountTotal: Number(Number(bill.amount_total ?? 0).toFixed(2)),
            amountResidual: Number(residual.toFixed(2)),
            currencyCode: currencyId ? getRelationalName(bill.currency_id) || TARGET_CURRENCY_CODE : TARGET_CURRENCY_CODE,
            daysOverdue: billDaysOverdue,
            agingBucket: getAgingBucket(billDaysOverdue),
        });
    }

    for (const line of unappliedLines) {
        const move = unappliedMoveById.get(getRelationalId(line.move_id) ?? -1);
        const customerId = move ? getRelationalId(move.commercial_partner_id) : null;
        if (!customerId) continue;

        const currencyId = getRelationalId(line.currency_id);
        const currencyCode = currencyId ? getRelationalName(line.currency_id) || TARGET_CURRENCY_CODE : TARGET_CURRENCY_CODE;
        const amount = Math.abs(Number((currencyId ? line.amount_currency : line.balance) ?? line.balance ?? 0));
        const balance = Number(line.balance ?? 0);
        const row = ensureRow(customerId);

        if (balance < 0) {
            // Credit not yet applied to an invoice (money already received)
            // — unchanged: shown as an unapplied payment and FIFO-netted
            // against open invoices/journal-entry charges below.
            row.unappliedPayments.push({
                id: Number(line.id),
                date: normalizeOdooDate(line.date),
                journalName: getRelationalName(move?.journal_id) || "-",
                reference: toDisplayString(move?.ref) || toDisplayString(move?.name) || "-",
                amount: Number(amount.toFixed(2)),
                currencyCode,
            });
            row.totalUnapplied = Number((row.totalUnapplied + toHomeAmount(amount, currencyId)).toFixed(2));

            // Also listed with the invoices (as MISC/… or payment entries are in
            // Odoo's Aged Receivable). Display only: the FIFO pass below already
            // spends this credit against the oldest invoices, so it must not be
            // counted again — the pass only takes out_invoice / miscEntry rows.
            const creditDate = normalizeOdooDate(line.date);
            const creditMs = creditDate ? new Date(`${creditDate}T00:00:00Z`).getTime() : todayMs;
            const creditDaysOverdue = Math.round((todayMs - creditMs) / 86400000);
            row.invoices.push({
                invoiceId: -Number(line.id),
                invoiceNumber: toDisplayString(move?.name) || "-",
                moveType: "payment",
                invoiceDate: creditDate,
                dueDate: creditDate,
                paymentTermsName: toDisplayString(move?.ref) || "-",
                amountTotal: Number(amount.toFixed(2)),
                amountResidual: Number(amount.toFixed(2)),
                currencyCode,
                daysOverdue: creditDaysOverdue,
                agingBucket: getAgingBucket(creditDaysOverdue),
            });
            continue;
        }

        // Debit not backed by any invoice (e.g. a carried-forward opening
        // balance, or a bounced cheque re-debited to the customer) — folded
        // in as an invoice-like charge (`moveType: "miscEntry"`) so it
        // ages, buckets, and FIFO-nets exactly like a real invoice instead
        // of being invisible to the report, as it was before this branch
        // existed. Aged from the entry's own posting date — a plain
        // journal entry has no separate due date the way an invoice does.
        // Its id is negated so it can't collide with a real invoice's id
        // (a different Odoo table's own sequence) in the maps/keys below.
        const entryDate = normalizeOdooDate(line.date);
        const agingMs = entryDate ? new Date(`${entryDate}T00:00:00Z`).getTime() : todayMs;
        const daysOverdue = Math.round((todayMs - agingMs) / 86400000);
        const bucket = getAgingBucket(daysOverdue);
        const matrixBucket = resolveAgingBucket(daysOverdue, entryDate, todayStr, agingSystem);
        const invoiceId = -Number(line.id);

        row.invoices.push({
            invoiceId,
            invoiceNumber: toDisplayString(move?.name) || "-",
            moveType: "miscEntry",
            invoiceDate: entryDate,
            dueDate: entryDate,
            paymentTermsName: toDisplayString(move?.ref) || "-",
            amountTotal: Number(amount.toFixed(2)),
            amountResidual: Number(amount.toFixed(2)),
            currencyCode,
            daysOverdue,
            agingBucket: bucket,
        });
        invoiceMatrixBucketById.set(invoiceId, matrixBucket);
        invoiceHomeResidualById.set(invoiceId, toHomeAmount(amount, currencyId));
    }

    // The credit an unmatched cheque represents comes off what the customer owes
    // (spent against their oldest invoices, like any unapplied payment). A cheque
    // whose receivable item is already among the unapplied credits above has been
    // deducted there, so only the ones that aren't get added here — never twice.
    const unappliedCreditLineIds = new Set(
        unappliedLines.filter((line) => Number(line.balance ?? 0) < 0).map((line) => Number(line.id))
    );
    const pdcUnmatchedCreditByCustomerId = new Map<number, number>();

    if (pdcInfo) {
        for (const record of pdcRecords) {
            const rawPartnerId = getRelationalId(record[pdcInfo.partnerField]);
            if (!rawPartnerId) continue;
            const customerId = Number(pdcCanonicalMap.get(rawPartnerId)?.id ?? rawPartnerId);

            const currencyId = pdcInfo.currencyField ? getRelationalId(record[pdcInfo.currencyField]) : null;
            const currencyCode = currencyId
                ? getRelationalName(record[pdcInfo.currencyField as string]) || TARGET_CURRENCY_CODE
                : TARGET_CURRENCY_CODE;
            const amount = Number(record[pdcInfo.amountField] ?? 0);
            // A Selection field's raw stored value is a short internal code
            // ("draft") distinct from what it displays ("Registered") — read
            // and matched directly, every record looked identical regardless
            // of its real status (verified live). Translating through the
            // field's own declared options first is what actually reflects
            // reality.
            const rawStateValue = pdcInfo.stateField ? toDisplayString(record[pdcInfo.stateField]) : "";
            const stateLabel = pdcInfo.stateFieldSelectionLabelByValue?.[rawStateValue] ?? rawStateValue;
            const lowerStateLabel = stateLabel.toLowerCase();
            const isDeposited = pdcInfo.depositField ? Boolean(record[pdcInfo.depositField]) : false;
            // Prefer an explicit "already reconciled/cleared" boolean (e.g.
            // `account.payment.is_reconciled`) when the model has one.
            // Otherwise, only "Registered" counts as still pending — verified
            // live against a real addon's actual New/Registered/Deposit/
            // Bounce/Done/Cancel lifecycle. Already-deposited cheques are
            // excluded from "pending" too (tracked in `totalPdcDeposited`
            // instead) — "Pending" specifically means not yet handed to the
            // bank at all, so `totalPdcPending` never double-counts what
            // `totalPdcDeposited` already shows.
            const isPending =
                (pdcInfo.pendingField ? !record[pdcInfo.pendingField] : lowerStateLabel.includes("regist")) &&
                !isDeposited;
            // Whether the cheque's receivable journal item is matched only drives the
            // deduction from what the customer owes (see `pdcUnmatchedCreditByCustomerId`);
            // it never changes whether the cheque counts as pending.
            const receivableMatch = receivableMatchByRecordId.get(Number(record.id));
            const pendingAmount = isPending ? amount : 0;
            // `is_deposit` is independent of `state` (a Registered cheque can
            // be either deposited or not) — shown as a compound label rather
            // than replacing the real state, so "still Registered but not
            // yet deposited" stays distinguishable from "Registered and
            // Deposited".
            const displayState = isDeposited ? "Registered & Deposited" : stateLabel || "-";

            const row = ensureRow(customerId);
            if (receivableMatch && !receivableMatch.matched && !receivableMatch.unmatchedLineIds.some((id) => unappliedCreditLineIds.has(id))) {
                pdcUnmatchedCreditByCustomerId.set(
                    customerId,
                    Number(
                        ((pdcUnmatchedCreditByCustomerId.get(customerId) ?? 0) + toHomeAmount(amount * receivableMatch.unmatchedRatio, currencyId)).toFixed(2)
                    )
                );
            }
            row.cheques.push({
                id: Number(record.id),
                number: toDisplayString(record[pdcInfo.numberField]) || `#${record.id}`,
                date: normalizeOdooDate(record[pdcInfo.dateField]),
                amount: Number(amount.toFixed(2)),
                currencyCode,
                state: displayState,
                bankName: pdcInfo.bankField ? getRelationalName(record[pdcInfo.bankField]) || toDisplayString(record[pdcInfo.bankField]) : "",
                isPending,
                isDeposited,
                pendingAmount: Number(pendingAmount.toFixed(2)),
                receivableMatched: receivableMatch ? receivableMatch.matched : null,
            });

            if (isPending) {
                row.totalPdcPending = Number((row.totalPdcPending + toHomeAmount(pendingAmount, currencyId)).toFixed(2));
            }
            if (isDeposited) {
                row.totalPdcDeposited = Number((row.totalPdcDeposited + toHomeAmount(amount, currencyId)).toFixed(2));
            }
        }
    }

    for (const row of rowByCustomerId.values()) {
        // FIFO-apply unapplied credit against open invoices oldest-first
        // (same order as the aging buckets themselves: Older before 91-120
        // before ... before Not Due) — a customer who already sent payment
        // that just isn't formally allocated to an invoice yet shouldn't
        // still read as owing it, and the credit has to come off their
        // oldest debt first, not their most recent. This single pass is
        // what both "Open Invoices Due" (`totalInvoiceDue`, credit notes'
        // own negative contribution already folded in above) and the aging
        // matrix's bucket amounts are built from, so a bucket only shows
        // what's genuinely still outstanding after that credit is spent —
        // e.g. all of it comes off "Older" before touching "1-30" if that's
        // where the oldest debt actually is.
        const openInvoicesOldestFirst = row.invoices
            .filter(
                (invoice) =>
                    (invoice.moveType === "out_invoice" || invoice.moveType === "miscEntry") &&
                    invoice.amountResidual > 0
            )
            .slice()
            .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));

        let remainingCredit = Number((row.totalUnapplied + (pdcUnmatchedCreditByCustomerId.get(row.customerId) ?? 0)).toFixed(2));
        row.oldestDueDate = "";
        row.maxDaysOverdue = 0;
        row.agingBucket = "notDue";
        for (const invoice of openInvoicesOldestFirst) {
            const homeResidual = invoiceHomeResidualById.get(invoice.invoiceId) ?? invoice.amountResidual;
            const appliedCredit = Math.min(Math.max(remainingCredit, 0), homeResidual);
            const netHomeAmount = Number((homeResidual - appliedCredit).toFixed(2));
            remainingCredit = Number((remainingCredit - appliedCredit).toFixed(2));
            const matrixBucket = invoiceMatrixBucketById.get(invoice.invoiceId) ?? invoice.agingBucket;

            row.agingBuckets[matrixBucket] = Number(
                (row.agingBuckets[matrixBucket] + netHomeAmount).toFixed(2)
            );

            if (!row.oldestDueDate && netHomeAmount > 0.01) {
                row.oldestDueDate = invoice.dueDate;
                row.maxDaysOverdue = invoice.daysOverdue;
                row.agingBucket = matrixBucket;
            }
        }

        // `totalInvoiceDue` ("Open Invoices Due") is derived from the aging
        // buckets rather than tracked in parallel, now that three different
        // things feed into them (credit notes, FIFO-netted invoices, and
        // payables aged onto the same buckets above) — a single source of
        // truth so the matrix's own "Total" column and this stat can never
        // drift apart.
        row.totalInvoiceDue = Number(
            (
                row.agingBuckets.notDue +
                row.agingBuckets.d1_30 +
                row.agingBuckets.d31_60 +
                row.agingBuckets.d61_90 +
                row.agingBuckets.d91_120 +
                row.agingBuckets.older
            ).toFixed(2)
        );

        // Credit left over once every open invoice is fully covered is a
        // genuine credit balance (they've paid more than they currently
        // owe) — still reduces net due, just with nothing left to net it
        // against inside `totalInvoiceDue` (which is already floored at 0
        // per invoice by the pass above, so subtracting it again there would
        // double-count). Payables are not subtracted again here either —
        // they're already inside `totalInvoiceDue` via the buckets.
        row.netDue = Number((row.totalInvoiceDue - Math.max(remainingCredit, 0)).toFixed(2));

        row.invoices.sort((a, b) => b.daysOverdue - a.daysOverdue);
        row.unappliedPayments.sort((a, b) => (b.date > a.date ? 1 : -1));
        row.cheques.sort((a, b) => (a.date > b.date ? 1 : -1));
    }

    const customers = Array.from(rowByCustomerId.values())
        .filter((row) => row.invoices.length > 0 || row.unappliedPayments.length > 0 || row.cheques.length > 0)
        .sort((a, b) => b.maxDaysOverdue - a.maxDaysOverdue || b.netDue - a.netDue);

    const totals = customers.reduce(
        (acc, row) => ({
            totalInvoiceDue: Number((acc.totalInvoiceDue + row.totalInvoiceDue).toFixed(2)),
            totalUnapplied: Number((acc.totalUnapplied + row.totalUnapplied).toFixed(2)),
            totalPdcPending: Number((acc.totalPdcPending + row.totalPdcPending).toFixed(2)),
            totalPdcDeposited: Number((acc.totalPdcDeposited + row.totalPdcDeposited).toFixed(2)),
            totalPayableDue: Number((acc.totalPayableDue + row.totalPayableDue).toFixed(2)),
            netDue: Number((acc.netDue + row.netDue).toFixed(2)),
            agingBuckets: {
                notDue: Number((acc.agingBuckets.notDue + row.agingBuckets.notDue).toFixed(2)),
                d1_30: Number((acc.agingBuckets.d1_30 + row.agingBuckets.d1_30).toFixed(2)),
                d31_60: Number((acc.agingBuckets.d31_60 + row.agingBuckets.d31_60).toFixed(2)),
                d61_90: Number((acc.agingBuckets.d61_90 + row.agingBuckets.d61_90).toFixed(2)),
                d91_120: Number((acc.agingBuckets.d91_120 + row.agingBuckets.d91_120).toFixed(2)),
                older: Number((acc.agingBuckets.older + row.agingBuckets.older).toFixed(2)),
            },
        }),
        {
            totalInvoiceDue: 0,
            totalUnapplied: 0,
            totalPdcPending: 0,
            totalPdcDeposited: 0,
            totalPayableDue: 0,
            netDue: 0,
            agingBuckets: emptyAgingTotals(),
        }
    );

    return {
        scope,
        salesperson,
        asOfDate: todayStr,
        dateBasis,
        agingSystem,
        currencyCode: TARGET_CURRENCY_CODE,
        pdcModuleDetected: Boolean(pdcInfo),
        pdcDebug: pdcInfo ? null : pdcDebug,
        pdcRawMatchCount,
        pdcAppliedFilters: pdcInfo
            ? pdcInfo.extraDomain
                .filter((clause): clause is [string, string, unknown] => Array.isArray(clause) && clause.length === 3)
                .map((clause) => `${clause[0]} ${clause[1]} ${JSON.stringify(clause[2])}`)
            : [],
        customers,
        totals,
    };
}

export async function getPaymentFollowupForSalesperson(
    credentials: OdooCredentials,
    input: {
        salespersonId: number;
        asOfDate?: string;
        dateBasis?: "due" | "invoice";
        agingSystem?: "day" | "month";
    }
): Promise<PaymentFollowupReport> {
    const uid = await authenticate(credentials);
    const salespersonId = Number(input.salespersonId);

    if (!Number.isFinite(salespersonId) || salespersonId <= 0) {
        throw new Error("A valid salesperson is required.");
    }

    const salespeople = await getSalespeople(credentials);
    const salesperson = salespeople.find((item) => item.id === salespersonId);
    if (!salesperson) {
        throw new Error("Selected salesperson was not found in Odoo.");
    }

    const assignedPartners = await executeKw<Array<{ id: number }>>(
        credentials,
        uid,
        "res.partner",
        "search_read",
        [[
            ["user_id", "=", salespersonId],
            ["customer_rank", ">", 0],
        ]],
        { fields: ["id"], limit: 5000 }
    );

    const canonicalMap = await getCanonicalCustomerMap(
        credentials,
        uid,
        assignedPartners.map((partner) => Number(partner.id))
    );
    const customerIds = Array.from(
        new Set(Array.from(canonicalMap.values()).map((customer) => Number(customer.id ?? 0)))
    ).filter((id) => id > 0);

    return buildPaymentFollowupReport(
        credentials,
        uid,
        customerIds,
        "salesperson",
        salesperson,
        resolveAsOfDate(input.asOfDate),
        input.dateBasis === "invoice" ? "invoice" : "due",
        input.agingSystem === "month" ? "month" : "day"
    );
}

export async function getPaymentFollowupForCustomer(
    credentials: OdooCredentials,
    input: {
        customerId: number;
        asOfDate?: string;
        dateBasis?: "due" | "invoice";
        agingSystem?: "day" | "month";
    }
): Promise<PaymentFollowupReport> {
    const uid = await authenticate(credentials);
    const customerId = Number(input.customerId);

    if (!Number.isFinite(customerId) || customerId <= 0) {
        throw new Error("A valid customer is required.");
    }

    const customer = await getCommercialPartner(credentials, uid, customerId);
    const canonicalId = Number(customer.id ?? 0);

    return buildPaymentFollowupReport(
        credentials,
        uid,
        [canonicalId],
        "customer",
        null,
        resolveAsOfDate(input.asOfDate),
        input.dateBasis === "invoice" ? "invoice" : "due",
        input.agingSystem === "month" ? "month" : "day"
    );
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
    const timeZone = await getUserTimezone(credentials, uid);

    const { startDate, endDate } = getMonthDateRange(year, month);
    const from = toOdooDateBoundary(startDate, false, timeZone);
    const to = toOdooDateBoundary(endDate, true, timeZone);

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
                // Filled in below, once every product in this brand/period is known.
                categoryId: null,
                categoryName: "Uncategorized",
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

    const categoryByProductId = await getProductCategoriesByProductIds(
        credentials,
        Array.from(productsById.keys())
    );

    const products = Array.from(productsById.values())
        .map((product) => {
            const category = categoryByProductId.get(product.productId);
            return {
                ...product,
                orderCount: orderIdsByProductId.get(product.productId)?.size ?? 0,
                categoryId: category?.categoryId ?? null,
                categoryName: category?.categoryName ?? "Uncategorized",
            };
        })
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
        /** Leave out sales fulfilled by a dropship operation. */
        excludeDropshipping?: boolean | null;
        /** Leave out sales to, and purchases from, the company's own internal companies. */
        excludeInternalCompanies?: boolean | null;
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

    const timeZone = await getUserTimezone(credentials, uid);
    const from = toOdooDateBoundary(startDate, false, timeZone);
    const to = toOdooDateBoundary(endDate, true, timeZone);

    const dropshipTypeIds = await findDropshipPickingTypeIds(credentials, uid);

    // Partners that are the company's own internal companies: orders with them
    // are internal transfers, not real purchases or sales.
    let internalCompanyPartnerIds: number[] = [];
    if (input.excludeInternalCompanies) {
        const companies = await executeKw<Array<Record<string, unknown>>>(
            credentials,
            uid,
            "res.company",
            "search_read",
            [[]],
            { fields: ["partner_id"], context: { active_test: false } }
        );
        internalCompanyPartnerIds = companies.map((company) => getRelationalId(company.partner_id)).filter((id): id is number => !!id);

        // A sister company is often also set up as a separate vendor/customer
        // record carrying the company's name, so those count as internal too.
        const companyNames = companies.map((company) => getRelationalName(company.partner_id)).filter(Boolean);
        if (companyNames.length > 0) {
            const namedPartners = await executeKw<number[]>(
                credentials,
                uid,
                "res.partner",
                "search",
                [[["name", "in", companyNames]]],
                { context: { active_test: false } }
            );
            internalCompanyPartnerIds = Array.from(new Set([...internalCompanyPartnerIds, ...namedPartners]));
        }
    }

    // A purchase order sent to a delivery address (dest_address_id) is a dropship
    // too, even when its operation type isn't named/coded "dropship".
    const hasDropshipAddressField = await executeKw<Record<string, unknown>>(
        credentials,
        uid,
        "purchase.order",
        "fields_get",
        [["dest_address_id"]],
        { attributes: ["type"] }
    )
        .then((fields) => Boolean(fields.dest_address_id))
        .catch(() => false);

    // Sale lines delivered through a dropship operation (supplier straight to customer).
    let dropshipSaleLineIds: number[] = [];
    if (input.excludeDropshipping && dropshipTypeIds.length > 0) {
        const dropshipMoves = await searchReadAll(
            credentials,
            uid,
            "stock.move",
            [
                ["picking_type_id", "in", dropshipTypeIds],
                ["sale_line_id", "!=", false],
                ["product_id", "in", productIds],
                ["state", "!=", "cancel"],
            ],
            ["sale_line_id"]
        );
        dropshipSaleLineIds = Array.from(new Set(dropshipMoves.map((move) => getRelationalId(move.sale_line_id)).filter((id): id is number => !!id)));
    }

    const saleLineDomain: unknown[] = [
        ["product_id", "in", productIds],
        ["display_type", "=", false],
        ["order_id.state", "in", ["sale", "done"]],
        ["order_id.date_order", ">=", from],
        ["order_id.date_order", "<=", to],
    ];
    if (dropshipSaleLineIds.length > 0) {
        saleLineDomain.push(["id", "not in", dropshipSaleLineIds]);
    }
    if (internalCompanyPartnerIds.length > 0) {
        saleLineDomain.push(["order_id.partner_id.commercial_partner_id", "not in", internalCompanyPartnerIds]);
    }

    const lines = await executeKw<Array<{ product_id?: [number, string]; product_uom_qty?: number }>>(
        credentials,
        uid,
        "sale.order.line",
        "search_read",
        [saleLineDomain],
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

    // "On the way": what confirmed purchase orders still owe us. With "Exclude
    // dropshipping" on, dropship orders are left out (that stock goes straight to
    // a customer); with "Exclude internal companies" on, so are orders from sister companies.
    const incomingDomain: unknown[] = [
        ["product_id", "in", productIds],
        ["display_type", "=", false],
        ["order_id.state", "in", ["purchase", "done"]],
    ];
    if (input.excludeDropshipping) {
        if (dropshipTypeIds.length > 0) {
            incomingDomain.push(["order_id.picking_type_id", "not in", dropshipTypeIds]);
        }
        if (hasDropshipAddressField) {
            incomingDomain.push(["order_id.dest_address_id", "=", false]);
        }
    }
    if (internalCompanyPartnerIds.length > 0) {
        incomingDomain.push(["order_id.partner_id.commercial_partner_id", "not in", internalCompanyPartnerIds]);
    }
    const incomingLines = await searchReadAll(
        credentials,
        uid,
        "purchase.order.line",
        incomingDomain,
        ["product_id", "order_id", "product_qty", "qty_received", "date_planned"]
    );

    const incomingByProductId = new Map<number, Map<string, { quantity: number; expectedDate: string }>>();
    for (const line of incomingLines) {
        const productId = getRelationalId(line.product_id);
        const orderName = getRelationalName(line.order_id);
        const open = Number(line.product_qty ?? 0) - Number(line.qty_received ?? 0);
        if (!productId || !orderName || open <= 0) {
            continue;
        }
        const orders = incomingByProductId.get(productId) ?? new Map<string, { quantity: number; expectedDate: string }>();
        const existing = orders.get(orderName);
        orders.set(orderName, {
            quantity: (existing?.quantity ?? 0) + open,
            expectedDate: existing?.expectedDate || normalizeOdooDate(line.date_planned),
        });
        incomingByProductId.set(productId, orders);
    }

    // What the exclusion toggles actually removed, per product, so it can be shown
    // (and checked) instead of silently disappearing from the figures.
    const excludedItemsByProductId = new Map<number, Map<string, PurchaseOrderExcludedItem>>();
    const addExcluded = (productId: number, key: string, item: PurchaseOrderExcludedItem) => {
        const items = excludedItemsByProductId.get(productId) ?? new Map<string, PurchaseOrderExcludedItem>();
        const existing = items.get(key);
        if (existing) {
            for (const reason of item.reasons) if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
        } else {
            items.set(key, item);
        }
        excludedItemsByProductId.set(productId, items);
    };

    const partnerNameByOrder = async (model: "sale.order" | "purchase.order", orderIds: number[]) => {
        const orders = orderIds.length > 0 ? await readInBatches(credentials, uid, model, orderIds, ["id", "partner_id"]) : [];
        return new Map(orders.map((order) => [Number(order.id), getRelationalName(order.partner_id)]));
    };

    const saleBase: unknown[] = [
        ["product_id", "in", productIds],
        ["display_type", "=", false],
        ["order_id.state", "in", ["sale", "done"]],
        ["order_id.date_order", ">=", from],
        ["order_id.date_order", "<=", to],
    ];
    const saleLegs: Array<{ leaf: unknown; reason: string }> = [];
    if (dropshipSaleLineIds.length > 0) saleLegs.push({ leaf: ["id", "in", dropshipSaleLineIds], reason: "Dropshipping" });
    if (internalCompanyPartnerIds.length > 0) {
        saleLegs.push({ leaf: ["order_id.partner_id.commercial_partner_id", "in", internalCompanyPartnerIds], reason: "Internal company" });
    }
    for (const leg of saleLegs) {
        const removed = await searchReadAll(credentials, uid, "sale.order.line", [...saleBase, leg.leaf], ["product_id", "order_id", "product_uom_qty"]);
        const partners = await partnerNameByOrder(
            "sale.order",
            Array.from(new Set(removed.map((line) => getRelationalId(line.order_id)).filter((id): id is number => !!id)))
        );
        for (const line of removed) {
            const productId = getRelationalId(line.product_id);
            const orderId = getRelationalId(line.order_id);
            if (!productId || !orderId) continue;
            addExcluded(productId, `sale-${line.id}`, {
                kind: "sale",
                reasons: [leg.reason],
                document: getRelationalName(line.order_id),
                partner: partners.get(orderId) ?? "",
                quantity: Number(line.product_uom_qty ?? 0),
            });
        }
    }

    const purchaseBase: unknown[] = [
        ["product_id", "in", productIds],
        ["display_type", "=", false],
        ["order_id.state", "in", ["purchase", "done"]],
    ];
    const purchaseLegs: Array<{ leaf: unknown; reason: string }> = [];
    if (input.excludeDropshipping) {
        if (dropshipTypeIds.length > 0) {
            purchaseLegs.push({ leaf: ["order_id.picking_type_id", "in", dropshipTypeIds], reason: "Dropshipping" });
        }
        if (hasDropshipAddressField) {
            purchaseLegs.push({ leaf: ["order_id.dest_address_id", "!=", false], reason: "Dropshipping" });
        }
    }
    if (internalCompanyPartnerIds.length > 0) {
        purchaseLegs.push({ leaf: ["order_id.partner_id.commercial_partner_id", "in", internalCompanyPartnerIds], reason: "Internal company" });
    }
    for (const leg of purchaseLegs) {
        const removed = await searchReadAll(
            credentials,
            uid,
            "purchase.order.line",
            [...purchaseBase, leg.leaf],
            ["product_id", "order_id", "product_qty", "qty_received"]
        );
        const partners = await partnerNameByOrder(
            "purchase.order",
            Array.from(new Set(removed.map((line) => getRelationalId(line.order_id)).filter((id): id is number => !!id)))
        );
        for (const line of removed) {
            const productId = getRelationalId(line.product_id);
            const orderId = getRelationalId(line.order_id);
            const open = Number(line.product_qty ?? 0) - Number(line.qty_received ?? 0);
            if (!productId || !orderId || open <= 0) continue;
            addExcluded(productId, `purchase-${line.id}`, {
                kind: "purchase",
                reasons: [leg.reason],
                document: getRelationalName(line.order_id),
                partner: partners.get(orderId) ?? "",
                quantity: open,
            });
        }
    }

    // Where today's stock sits: per product, per lot, per warehouse.
    const quants = await searchReadAll(
        credentials,
        uid,
        "stock.quant",
        [["product_id", "in", productIds], ["location_id.usage", "=", "internal"], ["quantity", "!=", 0]],
        ["product_id", "lot_id", "location_id", "quantity"]
    );
    const locationIds = Array.from(new Set(quants.map((quant) => getRelationalId(quant.location_id)).filter((id): id is number => !!id)));
    const locations = locationIds.length > 0 ? await readInBatches(credentials, uid, "stock.location", locationIds, ["id", "complete_name", "warehouse_id"]) : [];
    const warehouseNameByLocationId = new Map<number, string>();
    for (const location of locations) {
        warehouseNameByLocationId.set(
            Number(location.id),
            getRelationalName(location.warehouse_id) || toDisplayString(location.complete_name) || `Location #${location.id}`
        );
    }
    const stockByProductId = new Map<number, Map<string, Map<string, number>>>();
    for (const quant of quants) {
        const productId = getRelationalId(quant.product_id);
        if (!productId) continue;
        const lotName = getRelationalName(quant.lot_id) || "No lot";
        const locationId = getRelationalId(quant.location_id);
        const warehouse = (locationId ? warehouseNameByLocationId.get(locationId) : undefined) ?? "Unknown location";
        const lots = stockByProductId.get(productId) ?? new Map<string, Map<string, number>>();
        const warehouses = lots.get(lotName) ?? new Map<string, number>();
        warehouses.set(warehouse, (warehouses.get(warehouse) ?? 0) + Number(quant.quantity ?? 0));
        lots.set(lotName, warehouses);
        stockByProductId.set(productId, lots);
    }

    const monthsInRange = monthsBetweenInclusive(startDate, endDate);
    const rows = products
        .map((product) => {
            const productId = Number(product.id);
            const incomingOrders = Array.from(incomingByProductId.get(productId) ?? [])
                .map(([name, entry]) => ({ name, quantity: Number(entry.quantity.toFixed(2)), expectedDate: entry.expectedDate }))
                .sort((a, b) => a.expectedDate.localeCompare(b.expectedDate) || a.name.localeCompare(b.name));
            const incomingQty = Number(incomingOrders.reduce((sum, order) => sum + order.quantity, 0).toFixed(2));
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
                incomingQty,
                incomingOrders,
                ...(() => {
                    const excludedItems = Array.from(excludedItemsByProductId.get(productId)?.values() ?? [])
                        .map((item) => ({ ...item, quantity: Number(item.quantity.toFixed(2)) }))
                        .sort((a, b) => a.kind.localeCompare(b.kind) || a.document.localeCompare(b.document));
                    const total = (kind: "sale" | "purchase") =>
                        Number(excludedItems.filter((item) => item.kind === kind).reduce((sum, item) => sum + item.quantity, 0).toFixed(2));
                    return { excludedItems, excludedSoldQty: total("sale"), excludedIncomingQty: total("purchase") };
                })(),
                stockByLot: Array.from(stockByProductId.get(productId) ?? [])
                    .map(([lotName, warehouses]) => {
                        const list = Array.from(warehouses)
                            .map(([name, quantity]) => ({ name, quantity: Number(quantity.toFixed(2)) }))
                            .filter((entry) => entry.quantity !== 0)
                            .sort((a, b) => b.quantity - a.quantity);
                        return { lotName, quantity: Number(list.reduce((sum, entry) => sum + entry.quantity, 0).toFixed(2)), warehouses: list };
                    })
                    .filter((lot) => lot.quantity !== 0)
                    .sort((a, b) => b.lotName.localeCompare(a.lotName)),
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
        /**
         * "order" (default): scope by the purchase/sales order's own Order
         * Date. "transaction": scope purchases by the date each receipt was
         * actually validated (stock.move's own date) and sales by the
         * customer invoice's own Invoice Date — see the identical mode in
         * `getMarginAnalyticsReport`.
         */
        dateBasis?: "order" | "transaction" | null;
    }
): Promise<ProductsPerformanceReport> {
    const uid = await authenticate(credentials);
    const dateBasis = input.dateBasis === "transaction" ? "transaction" : "order";

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
    const timeZone = await getUserTimezone(credentials, uid);
    const from = toOdooDateBoundary(startDate, false, timeZone);
    const to = toOdooDateBoundary(endDate, true, timeZone);

    const primaryCurrencyId = await getPrimaryCurrencyId(credentials, uid, []);
    const homeCompanyId = await getHomeCompanyId(credentials, uid);
    const todayStr = new Date().toISOString().slice(0, 10);

    // A single running currency -> AED multiplier map shared by sales and
    // purchases, extended on demand as each side introduces a currency we
    // haven't seen yet (see the identical pattern in
    // `getMarginAnalyticsReport`).
    const multiplierByCurrencyId = buildCurrencyMultipliers(primaryCurrencyId, new Map());
    async function ensureCurrencyMultipliers(currencyIds: Array<number | null | undefined>) {
        const missing = Array.from(
            new Set(
                currencyIds.filter(
                    (id): id is number => typeof id === "number" && id > 0 && !multiplierByCurrencyId.has(id)
                )
            )
        );
        if (missing.length === 0 || !homeCompanyId) {
            return;
        }
        const rates = await getCurrencyRatesToHomeCurrency(credentials, uid, homeCompanyId, missing, todayStr);
        for (const [currencyId, rate] of rates) {
            multiplierByCurrencyId.set(currencyId, 1 / rate);
        }
    }

    const unconvertedCurrencyCodes = new Set<string>();
    const soldQtyByProductId = new Map<number, number>();
    const salesValueByProductId = new Map<number, number>();

    if (dateBasis === "transaction") {
        // Same "product"-only display_type filter as margin analytics:
        // Anglo-Saxon COGS contra-lines get posted on the invoice's own
        // move, tagged with the same product — excluding them is required,
        // not optional.
        const invoiceLines = await executeKw<Array<Record<string, unknown>>>(
            credentials,
            uid,
            "account.move.line",
            "search_read",
            [[
                ["product_id", "in", finalProductIds],
                ["display_type", "=", "product"],
                ["move_id.move_type", "=", "out_invoice"],
                ["move_id.state", "=", "posted"],
                ["move_id.invoice_date", ">=", startDate],
                ["move_id.invoice_date", "<=", endDate],
            ]],
            {
                fields: ["product_id", "quantity", "price_subtotal", "currency_id"],
                limit: 50000,
            }
        );

        await ensureCurrencyMultipliers(invoiceLines.map((line) => getRelationalId(line.currency_id)));

        for (const line of invoiceLines) {
            const id = getRelationalId(line.product_id);
            if (!id) {
                continue;
            }

            const qty = Number(line.quantity ?? 0);
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
    } else {
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

        await ensureCurrencyMultipliers(saleLines.map((line) => getRelationalId(line.currency_id)));

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
    }

    // Purchased qty/value, same currency-safe conversion as sales — vendor POs
    // are just as often raised in a foreign currency as customer invoices.
    const purchasedQtyByProductId = new Map<number, number>();
    const purchaseValueByProductId = new Map<number, number>();

    if (dateBasis === "transaction") {
        // Scoped by the actual goods-receipt date (stock.move.date) instead
        // of the PO's order date — see the identical mode in
        // `getMarginAnalyticsReport` for the full rationale.
        const receiptMoves = await executeKw<Array<Record<string, unknown>>>(
            credentials,
            uid,
            "stock.move",
            "search_read",
            [[
                ["product_id", "in", finalProductIds],
                ["state", "=", "done"],
                ["purchase_line_id", "!=", false],
                ["date", ">=", from],
                ["date", "<=", to],
            ]],
            { fields: ["id", "product_id", "product_qty", "purchase_line_id"], limit: 50000 }
        );

        const purchaseLineIds = Array.from(
            new Set(
                receiptMoves
                    .map((move) => getRelationalId(move.purchase_line_id))
                    .filter((id): id is number => typeof id === "number" && id > 0)
            )
        );

        const purchaseLinesRaw = purchaseLineIds.length > 0
            ? await executeKw<Array<Record<string, unknown>>>(
                credentials,
                uid,
                "purchase.order.line",
                "read",
                [purchaseLineIds],
                { fields: ["id", "product_qty", "price_subtotal", "currency_id"] }
            )
            : [];
        const lineInfoById = new Map(purchaseLinesRaw.map((line) => [Number(line.id ?? 0), line]));

        await ensureCurrencyMultipliers(purchaseLinesRaw.map((line) => getRelationalId(line.currency_id)));

        for (const move of receiptMoves) {
            const id = getRelationalId(move.product_id);
            if (!id) {
                continue;
            }

            const lineId = getRelationalId(move.purchase_line_id);
            const lineInfo = lineId ? lineInfoById.get(lineId) : undefined;
            if (!lineInfo) {
                continue;
            }

            const lineQty = Number(lineInfo.product_qty ?? 0);
            const lineSubtotal = Number(lineInfo.price_subtotal ?? 0);
            const unitPrice = lineQty > 0 ? lineSubtotal / lineQty : 0;
            const moveQty = Number(move.product_qty ?? 0);
            purchasedQtyByProductId.set(id, (purchasedQtyByProductId.get(id) ?? 0) + moveQty);

            const currencyId = getRelationalId(lineInfo.currency_id);
            const multiplier = currencyId ? multiplierByCurrencyId.get(currencyId) : undefined;
            if (multiplier === undefined) {
                if (currencyId) {
                    unconvertedCurrencyCodes.add(getRelationalName(lineInfo.currency_id) || "?");
                }
                continue;
            }

            const value = unitPrice * moveQty * multiplier;
            purchaseValueByProductId.set(id, (purchaseValueByProductId.get(id) ?? 0) + value);
        }
    } else {
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

        await ensureCurrencyMultipliers(purchaseLines.map((line) => getRelationalId(line.currency_id)));

        for (const line of purchaseLines) {
            const id = getRelationalId(line.product_id);
            if (!id) {
                continue;
            }

            const qty = Number(line.product_qty ?? 0);
            purchasedQtyByProductId.set(id, (purchasedQtyByProductId.get(id) ?? 0) + qty);

            const currencyId = getRelationalId(line.currency_id);
            const multiplier = currencyId ? multiplierByCurrencyId.get(currencyId) : undefined;
            if (multiplier === undefined) {
                if (currencyId) {
                    unconvertedCurrencyCodes.add(getRelationalName(line.currency_id) || "?");
                }
                continue;
            }

            const value = Number(line.price_subtotal ?? 0) * multiplier;
            purchaseValueByProductId.set(id, (purchaseValueByProductId.get(id) ?? 0) + value);
        }
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

type MarginAnalyticsProductRow = {
    productId: number;
    productName: string;
    brandName: string;
    categoryName: string;
    originName: string;
    rimDiameterName: string;
    purchasedQty: number;
    avgPurchasePrice: number;
    avgLandedCostPerUnit: number;
    /** Odoo valuation basis only: Odoo's own current cost per unit (0 otherwise). */
    avgOdooCostPerUnit: number;
    avgOperationCostPerUnit: number;
    /** Quantity-less valuation layers with no source document/reference (signed, per purchased unit). */
    avgUnlinkedAdjustmentPerUnit: number;
    /** Landed cost adjusted by the operation cost correction (landed cost + operation cost — the sign of the operation cost already tells whether that's an increase or a decrease). */
    avgFinalLandedCostPerUnit: number;
    avgTotalCostPerUnit: number;
    soldQty: number;
    avgSalesPrice: number;
    hasSalesData: boolean;
    avgMarginPerUnit: number;
    marginPercent: number;
    estimatedProfitLoss: number;
    currentStock: number;
    /** On-hand quantity per lot (newest lot name first); empty lots omitted. */
    stockByLot: Array<{ lotName: string; quantity: number }>;
    flags: MarginAnalyticsRowFlag[];
    /**
     * Non-AED currencies that actually contributed to this row's purchase
     * price, landed cost, operation cost, or sales price before conversion
     * — e.g. ["USD"] for a product priced through a USD company. Empty when
     * everything behind this row was already in AED.
     */
    originalCurrencies: string[];
};

type MarginAnalyticsRowFlag =
    | "never-sold"
    | "sold-without-purchase"
    | "no-landed-cost"
    | "negative-margin"
    | "has-cost-correction";

type MarginAnalyticsHighlights = {
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

type MarginAnalyticsReport = {
    startDate: string;
    endDate: string;
    currencyCode: string;
    valuationBasis?: "average" | "odoo";
    matchedProductCount: number;
    rows: MarginAnalyticsProductRow[];
    highlights: MarginAnalyticsHighlights;
    unconvertedCurrencyCodes: string[];
};

function emptyMarginAnalyticsReport(startDate: string, endDate: string): MarginAnalyticsReport {
    return {
        startDate,
        endDate,
        currencyCode: TARGET_CURRENCY_CODE,
        matchedProductCount: 0,
        rows: [],
        highlights: {
            productsWithPurchases: 0,
            productsWithSales: 0,
            productsWithoutSales: 0,
            productsWithoutLandedCost: 0,
            totalPurchasedQty: 0,
            totalSoldQty: 0,
            totalCurrentStock: 0,
            avgPurchasePrice: 0,
            avgLandedCostPerUnit: 0,
            avgOperationCostPerUnit: 0,
            avgUnlinkedAdjustmentPerUnit: 0,
            avgFinalLandedCostPerUnit: 0,
            avgTotalCostPerUnit: 0,
            avgSalesPrice: 0,
            avgMarginPercent: 0,
            totalEstimatedProfitLoss: 0,
        },
        unconvertedCurrencyCodes: [],
    };
}

const MARGIN_ANALYTICS_MAX_PRODUCTS = 3000;
const MARGIN_ANALYTICS_OPERATION_COST_JOURNAL_NAME = "Miscellaneous Operations";
const MARGIN_ANALYTICS_LANDED_COST_DIFFERENCES_ACCOUNT_CODE = "400001.1";

type UnlinkedValuationLayer = {
    productId: number;
    /** Signed value in the layer's own (company) currency. */
    value: number;
    currencyId: number | null;
    currencyCode: string;
    date: string;
    reference: string;
    description: string;
};

/**
 * For a Unified Lot report: what share of each purchase line's (and each
 * receipt's) incoming quantity went into the selected lots. A single PO line is
 * routinely received into several lots at once (e.g. L-2025 and L-2026), so
 * counting the whole line whenever ANY of it landed in the selected lot
 * overstates quantity, value, landed cost and corrections for that lot.
 * Receipts add; returns to the vendor subtract; internal moves are ignored.
 * A line or move with no incoming quantity at all gets no entry (treated as 0).
 */
async function getPurchaseLotFractions(
    credentials: OdooCredentials,
    uid: number,
    purchaseLineIds: number[],
    lotIds: number[]
): Promise<{ byLineId: Map<number, number>; byMoveId: Map<number, number> }> {
    const byLineId = new Map<number, number>();
    const byMoveId = new Map<number, number>();
    if (purchaseLineIds.length === 0 || lotIds.length === 0) {
        return { byLineId, byMoveId };
    }

    const moves = await searchReadAll(
        credentials,
        uid,
        "stock.move",
        [["purchase_line_id", "in", purchaseLineIds], ["state", "=", "done"]],
        ["purchase_line_id"]
    );
    const lineIdByMoveId = new Map<number, number>();
    for (const move of moves) {
        const lineId = getRelationalId(move.purchase_line_id);
        if (lineId) lineIdByMoveId.set(Number(move.id), lineId);
    }
    if (lineIdByMoveId.size === 0) {
        return { byLineId, byMoveId };
    }

    const moveLines = await searchReadAll(
        credentials,
        uid,
        "stock.move.line",
        [["move_id", "in", Array.from(lineIdByMoveId.keys())], ["state", "=", "done"]],
        ["move_id", "quantity", "qty_done", "lot_id", "location_id", "location_dest_id"]
    );

    const locationIds = Array.from(
        new Set(
            moveLines
                .flatMap((line) => [getRelationalId(line.location_id), getRelationalId(line.location_dest_id)])
                .filter((id): id is number => typeof id === "number" && id > 0)
        )
    );
    const usageById = new Map<number, string>();
    if (locationIds.length > 0) {
        for (const location of await readInBatches(credentials, uid, "stock.location", locationIds, ["id", "usage"])) {
            usageById.set(Number(location.id), toDisplayString(location.usage));
        }
    }

    const lotSet = new Set(lotIds);
    const perMove = new Map<number, { lot: number; total: number }>();
    for (const line of moveLines) {
        const moveId = getRelationalId(line.move_id);
        if (!moveId) continue;
        const sourceUsage = usageById.get(getRelationalId(line.location_id) ?? 0);
        const destUsage = usageById.get(getRelationalId(line.location_dest_id) ?? 0);
        const rawQty = Number(line.quantity ?? line.qty_done ?? 0);
        const signed = destUsage === "internal" && sourceUsage !== "internal" ? rawQty : sourceUsage === "internal" && destUsage !== "internal" ? -rawQty : 0;
        if (signed === 0) continue;

        const entry = perMove.get(moveId) ?? { lot: 0, total: 0 };
        entry.total += signed;
        const lotId = getRelationalId(line.lot_id);
        if (lotId && lotSet.has(lotId)) entry.lot += signed;
        perMove.set(moveId, entry);
    }

    const perLine = new Map<number, { lot: number; total: number }>();
    for (const [moveId, entry] of perMove) {
        byMoveId.set(moveId, entry.total > 0 ? Math.min(Math.max(entry.lot / entry.total, 0), 1) : 0);
        const lineId = lineIdByMoveId.get(moveId);
        if (!lineId) continue;
        const lineEntry = perLine.get(lineId) ?? { lot: 0, total: 0 };
        lineEntry.lot += entry.lot;
        lineEntry.total += entry.total;
        perLine.set(lineId, lineEntry);
    }
    for (const [lineId, entry] of perLine) {
        byLineId.set(lineId, entry.total > 0 ? Math.min(Math.max(entry.lot / entry.total, 0), 1) : 0);
    }
    return { byLineId, byMoveId };
}

/**
 * "Unlinked valuation adjustments": stock.valuation.layer rows that change a
 * product's inventory value (e.g. a manual cost correction posted through a
 * vendor bill) but have no quantity, no stock move, no landed cost and
 * therefore no source document / reference. None of the PO-anchored cost
 * components (purchase price, landed cost, operation cost) can ever see them.
 *
 * Scoped by the layer's own creation date. When a Unified Lot filter is
 * active, only layers tied to those lots are returned; if this Odoo
 * database's valuation layer has no lot field to scope by, nothing is
 * returned (rather than wrongly spreading a lot-specific correction across
 * the whole product).
 */
async function fetchUnlinkedValuationLayers(
    credentials: OdooCredentials,
    uid: number,
    productIds: number[],
    lotIds: number[] | null,
    startDate: string,
    endDate: string
): Promise<UnlinkedValuationLayer[]> {
    if (productIds.length === 0) {
        return [];
    }

    const layerFields = await executeKw<Record<string, unknown>>(
        credentials,
        uid,
        "stock.valuation.layer",
        "fields_get",
        [],
        { attributes: ["type"] }
    );
    const has = (name: string) => Object.prototype.hasOwnProperty.call(layerFields, name);

    const domain: unknown[] = [
        ["product_id", "in", productIds],
        ["quantity", "=", 0],
        ["stock_move_id", "=", false],
        ["create_date", ">=", `${startDate} 00:00:00`],
        ["create_date", "<=", `${endDate} 23:59:59`],
    ];
    if (has("stock_landed_cost_id")) {
        domain.push(["stock_landed_cost_id", "=", false]);
    }

    if (lotIds) {
        const lotField = ["lot_id", "lot_ids"].find(has);
        if (!lotField || lotIds.length === 0) {
            return [];
        }
        domain.push([lotField, "in", lotIds]);
    }

    const fields = ["product_id", "value", "currency_id", "create_date", "description"].filter(has);
    if (has("account_move_id")) {
        fields.push("account_move_id");
    }

    const layers = await searchReadAll(credentials, uid, "stock.valuation.layer", domain, fields);

    return layers.flatMap((layer) => {
        const productId = getRelationalId(layer.product_id);
        if (!productId) {
            return [];
        }
        return [{
            productId,
            value: Number(layer.value ?? 0),
            currencyId: getRelationalId(layer.currency_id),
            currencyCode: getRelationalName(layer.currency_id) || "?",
            date: normalizeOdooDate(layer.create_date),
            reference: getRelationalName(layer.account_move_id) || "",
            description: toDisplayString(layer.description),
        }];
    });
}

/**
 * Margin Analytics: for products matching the given filters, computes the
 * average purchase price (from purchase.order.line), average landed cost per
 * unit (from Odoo's own stock.landed.cost allocation in
 * stock.valuation.adjustment.lines), average "operation cost" per unit, and
 * average selling price (from sale.order.line) — all restricted to exactly
 * the matched products, never a broader/general total.
 *
 * "Operation cost" comes from Miscellaneous Operations journal entries
 * posted to the Landed Cost Differences account (found by account code —
 * `MARGIN_ANALYTICS_LANDED_COST_DIFFERENCES_ACCOUNT_CODE`, since its name
 * can vary by company). These lines never set the structured `product_id`
 * field (verified live) — the only thing on the line that says which
 * purchase order it's for is that PO's name appearing as plain text inside
 * the line's own label, e.g. "P09479 - ...". Each such line is a single
 * total for the *whole purchase order*, which can carry several different
 * products, so there is no literal per-product amount to read off — it has
 * to be computed: allocate that line's total value across the order's own
 * lines in proportion to each line's own value (price_subtotal share of the
 * order total), never divided equally, then take the matched product's
 * share. The Landed Cost journal and the goods vendor bill itself are
 * deliberately excluded from "operation cost" because that money is
 * already counted in the landed cost and purchase price figures
 * respectively (verified live: a Landed Cost journal entry duplicates the
 * exact amount already on its stock.valuation.adjustment.lines record, so
 * also scanning that journal for "operation cost" would double-count it).
 *
 * This system spans multiple companies with different base currencies (see
 * Accounting > Currencies), and every one of these four amount sources can
 * be denominated in a currency other than the home company's AED —
 * including per-line on stock.valuation.adjustment.lines (confirmed live:
 * landed cost posted under a USD-currency company stores the amount in
 * USD) and via each journal entry's own company on the operation-cost
 * side. All four are converted to AED through one shared, incrementally
 * built currency multiplier map (`ensureCurrencyMultipliers`) rather than
 * assuming AED anywhere.
 */
export async function getMarginAnalyticsReport(
    credentials: OdooCredentials,
    input: {
        categoryId?: number | null;
        brandId?: number | null;
        originId?: number | null;
        rimDiameterIds?: number[] | null;
        unifiedLotIds?: number[] | null;
        productId?: number | null;
        /** Purchase orders of these types (Odoo's own "Purchase Type" field
         * values) are excluded from the purchase-side figures entirely. */
        excludePurchaseTypeValues?: string[] | null;
        /** Sale orders of this type (Odoo's own "Sale Type"/"Sales Type"
         * field) are excluded from the sales-side figures entirely. */
        excludeSaleTypeValue?: string | null;
        /** Sales to these customers are excluded from the sales-side figures. */
        excludeCustomerIds?: number[] | null;
        /** Purchase orders whose Deliver To is a Dropship operation type are
         * excluded from the purchase-side figures entirely. */
        excludeDropshipPurchases?: boolean | null;
        startDate: string;
        endDate: string;
        /**
         * Both modes scope the PURCHASE side by the order's own Order Date —
         * they differ only in which of Odoo's own PO-line quantity fields is
         * counted: "order" (default) counts `qty_to_invoice + qty_invoiced`
         * (everything billable off the line — still to be billed, plus what's
         * already been billed); "transaction" ("Receiving") counts just
         * `qty_invoiced` (what's actually been billed by the vendor).
         * The SALES side still differs by date: "order" scopes by the sale
         * order's own Order Date, "transaction" by the customer invoice's
         * own Invoice Date — an SO confirmed in January but invoiced in
         * March counts toward March.
         */
        dateBasis?: "order" | "transaction" | null;
        /**
         * "average" (default): cost = purchase price + landed + operation +
         * unlinked adjustments, averaged over purchased qty. "odoo": cost per
         * unit is Odoo's own current cost: total stock.valuation.layer value
         * over total layer quantity (remaining stock value / remaining qty),
         * which already includes landed costs and valuation corrections.
         */
        valuationBasis?: "average" | "odoo" | null;
    }
): Promise<MarginAnalyticsReport> {
    const uid = await authenticate(credentials);
    const dateBasis = input.dateBasis === "transaction" ? "transaction" : "order";
    const valuationBasis = input.valuationBasis === "odoo" ? "odoo" : "average";

    const categoryId = Number(input.categoryId);
    const hasCategory = Number.isFinite(categoryId) && categoryId > 0;
    const brandId = Number(input.brandId);
    const hasBrand = Number.isFinite(brandId) && brandId > 0;
    const originId = Number(input.originId);
    const hasOrigin = Number.isFinite(originId) && originId > 0;
    const rimDiameterIds = Array.isArray(input.rimDiameterIds)
        ? Array.from(new Set(input.rimDiameterIds.map(Number).filter((id) => Number.isFinite(id) && id > 0)))
        : [];
    const hasRimDiameter = rimDiameterIds.length > 0;
    const unifiedLotIds = Array.isArray(input.unifiedLotIds)
        ? Array.from(new Set(input.unifiedLotIds.map(Number).filter((id) => Number.isFinite(id) && id > 0)))
        : [];
    const hasUnifiedLot = unifiedLotIds.length > 0;
    const productId = Number(input.productId);
    const hasProduct = Number.isFinite(productId) && productId > 0;

    if (!hasCategory && !hasBrand && !hasOrigin && !hasRimDiameter && !hasUnifiedLot && !hasProduct) {
        throw new Error("Select at least one filter: category, brand, origin, rim diameter, unified lot, or product.");
    }

    const excludePurchaseTypeValues = Array.isArray(input.excludePurchaseTypeValues)
        ? Array.from(new Set(input.excludePurchaseTypeValues.map((value) => String(value)).filter(Boolean)))
        : [];
    const excludeSaleTypeValue = toDisplayString(input.excludeSaleTypeValue).trim() || null;
    const excludeCustomerIds = Array.isArray(input.excludeCustomerIds)
        ? Array.from(new Set(input.excludeCustomerIds.map(Number).filter((id) => Number.isFinite(id) && id > 0)))
        : [];
    const excludeDropshipPurchases = Boolean(input.excludeDropshipPurchases);

    const startDate = input.startDate;
    const endDate = input.endDate;
    ensureDateRange(startDate, endDate);

    const templateDomain: unknown[] = [];
    if (hasCategory) {
        templateDomain.push(["categ_id", "child_of", categoryId]);
    }
    if (hasBrand) {
        templateDomain.push(["tire_brand", "=", brandId]);
    }
    if (hasOrigin) {
        templateDomain.push(["origin", "=", originId]);
    }
    if (hasRimDiameter) {
        templateDomain.push(["rim_diameter", "in", rimDiameterIds]);
    }

    const idSets: Array<Set<number>> = [];

    if (templateDomain.length > 0) {
        const ids = await getProductIdsForTemplateDomain(credentials, uid, templateDomain);
        if (ids.length === 0) {
            return emptyMarginAnalyticsReport(startDate, endDate);
        }
        idSets.push(new Set(ids));
    }

    // A Unified Lot is one specific shipment/batch (`stock.unified.lot`,
    // grouping the individual `stock.lot` records it brought in per product).
    // Picking one must scope every figure below — purchase price, landed
    // cost, operation cost, AND sales — to just that shipment's own purchase
    // order(s) and the deliveries that actually shipped from it, not the
    // matched product's entire history.
    //
    // This resolves in two phases on purpose. Phase A (here) only needs the
    // product ids the shipment covers, so they can join the filter
    // intersection. The expensive move-line trace is deferred to Phase B,
    // AFTER `finalProductIds` is known, so it can be restricted to just the
    // products actually being reported on. A single shipment routinely spans
    // hundreds of products with thousands of movements each; tracing all of
    // them to answer a question about one product both wasted the work and
    // blew past the row cap, and a capped `search_read` silently returns only
    // the OLDEST page — which made recent deliveries vanish and a lot with
    // real activity report zero (verified live). Phase B is also fully
    // paginated via `searchReadAll` so nothing is dropped either way.
    let unifiedLotProductLots: Array<{ lotId: number; productId: number }> | null = null;

    if (hasUnifiedLot) {
        const lots = await searchReadAll(
            credentials,
            uid,
            "stock.lot",
            [["unified_lot_id", "in", unifiedLotIds]],
            ["id", "product_id"]
        );

        const ids = new Set<number>();
        unifiedLotProductLots = [];
        for (const lot of lots) {
            const lotProductId = getRelationalId(lot.product_id);
            const lotId = Number(lot.id ?? 0);
            if (lotProductId) {
                ids.add(lotProductId);
                if (lotId > 0) {
                    unifiedLotProductLots.push({ lotId, productId: lotProductId });
                }
            }
        }

        if (ids.size === 0) {
            return emptyMarginAnalyticsReport(startDate, endDate);
        }
        idSets.push(ids);
    }

    if (hasProduct) {
        idSets.push(new Set([productId]));
    }

    const finalProductIds = intersectIdSets(idSets).slice(0, MARGIN_ANALYTICS_MAX_PRODUCTS);
    if (finalProductIds.length === 0) {
        return emptyMarginAnalyticsReport(startDate, endDate);
    }

    // Phase B of the Unified Lot resolution (see Phase A above): now that the
    // reported products are known, trace only THEIR lots from this shipment
    // through to the purchase order that received them and the sale order
    // lines that shipped them out. `stock.move.line.lot_id` links both
    // directions — the receiving move carries `purchase_line_id`, the
    // delivery move carries `sale_line_id` — so one paginated pass covers
    // both.
    let unifiedLotOrderIds: Set<number> | null = null;
    let unifiedLotSaleLineIds: Set<number> | null = null;
    // How many units of each sale order line actually shipped from THIS
    // shipment. A single order line is frequently filled from more than one
    // lot, so counting the whole line whenever any part of it came from the
    // selected lot overstates both quantity and value (verified live:
    // reported 128 units where only 112 really came from the lot). Deliveries
    // add, customer returns subtract.
    let unifiedLotQtyBySaleLineId: Map<number, number> | null = null;

    if (hasUnifiedLot && unifiedLotProductLots) {
        const finalProductIdSetForLots = new Set(finalProductIds);
        const relevantLotIds = unifiedLotProductLots
            .filter((entry) => finalProductIdSetForLots.has(entry.productId))
            .map((entry) => entry.lotId);

        unifiedLotOrderIds = new Set<number>();
        unifiedLotSaleLineIds = new Set<number>();
        unifiedLotQtyBySaleLineId = new Map<number, number>();

        if (relevantLotIds.length > 0) {
            const lotMoveLines = await searchReadAll(
                credentials,
                uid,
                "stock.move.line",
                [
                    ["lot_id", "in", relevantLotIds],
                    ["product_id", "in", finalProductIds],
                    ["state", "=", "done"],
                ],
                ["move_id", "quantity", "qty_done", "location_id", "location_dest_id"]
            );

            const moveIds = Array.from(
                new Set(
                    lotMoveLines
                        .map((line) => getRelationalId(line.move_id))
                        .filter((id): id is number => typeof id === "number" && id > 0)
                )
            );

            if (moveIds.length > 0) {
                const moves = await readInBatches(
                    credentials,
                    uid,
                    "stock.move",
                    moveIds,
                    ["id", "purchase_line_id", "sale_line_id"]
                );

                const purchaseLineIds = Array.from(
                    new Set(
                        moves
                            .map((move) => getRelationalId(move.purchase_line_id))
                            .filter((id): id is number => typeof id === "number" && id > 0)
                    )
                );

                if (purchaseLineIds.length > 0) {
                    const purchaseLines = await readInBatches(
                        credentials,
                        uid,
                        "purchase.order.line",
                        purchaseLineIds,
                        ["id", "order_id"]
                    );

                    for (const line of purchaseLines) {
                        const orderId = getRelationalId(line.order_id);
                        if (orderId) {
                            unifiedLotOrderIds.add(orderId);
                        }
                    }
                }

                const saleLineIdByMoveId = new Map<number, number>();
                for (const move of moves) {
                    const moveId = Number(move.id ?? 0);
                    const saleLineId = getRelationalId(move.sale_line_id);
                    if (moveId > 0 && saleLineId) {
                        saleLineIdByMoveId.set(moveId, saleLineId);
                        unifiedLotSaleLineIds.add(saleLineId);
                    }
                }

                // Direction comes from the move line's own locations: a unit
                // leaving stock for a customer location is a sale; one coming
                // back from a customer is a return and must net off.
                const locationIds = Array.from(
                    new Set(
                        lotMoveLines
                            .flatMap((line) => [getRelationalId(line.location_id), getRelationalId(line.location_dest_id)])
                            .filter((id): id is number => typeof id === "number" && id > 0)
                    )
                );
                const locationUsageById = new Map<number, string>();
                if (locationIds.length > 0) {
                    const locations = await readInBatches(
                        credentials,
                        uid,
                        "stock.location",
                        locationIds,
                        ["id", "usage"]
                    );
                    for (const location of locations) {
                        const locationId = Number(location.id ?? 0);
                        if (locationId > 0) {
                            locationUsageById.set(locationId, toDisplayString(location.usage));
                        }
                    }
                }

                for (const line of lotMoveLines) {
                    const moveId = getRelationalId(line.move_id);
                    const saleLineId = moveId ? saleLineIdByMoveId.get(moveId) : undefined;
                    if (!saleLineId) {
                        continue;
                    }

                    const sourceUsage = locationUsageById.get(getRelationalId(line.location_id) ?? 0);
                    const destUsage = locationUsageById.get(getRelationalId(line.location_dest_id) ?? 0);
                    const rawQty = Number(line.quantity ?? line.qty_done ?? 0);
                    const signedQty = destUsage === "customer" ? rawQty : sourceUsage === "customer" ? -rawQty : 0;
                    if (signedQty === 0) {
                        continue;
                    }

                    unifiedLotQtyBySaleLineId.set(
                        saleLineId,
                        (unifiedLotQtyBySaleLineId.get(saleLineId) ?? 0) + signedQty
                    );
                }
            }
        }
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
            { fields: ["id", "tire_brand", "categ_id", "origin", "rim_diameter"] }
        )
        : [];

    const templateInfoById = new Map<
        number,
        { brandName: string; categoryName: string; originName: string; rimDiameterName: string }
    >();
    for (const template of templates) {
        const templateId = Number(template.id ?? 0);
        if (templateId <= 0) {
            continue;
        }

        templateInfoById.set(templateId, {
            brandName: getRelationalName(template.tire_brand) || "No Brand",
            categoryName: getRelationalName(template.categ_id) || "Uncategorized",
            originName: getRelationalName(template.origin) || "Unknown Origin",
            rimDiameterName: getRelationalName(template.rim_diameter) || "-",
        });
    }

    const productInfoById = new Map<
        number,
        { name: string; brandName: string; categoryName: string; originName: string; rimDiameterName: string }
    >();
    for (const product of products) {
        const id = Number(product.id ?? 0);
        if (id <= 0) {
            continue;
        }

        const templateId = getRelationalId(product.product_tmpl_id);
        const templateInfo = typeof templateId === "number" ? templateInfoById.get(templateId) : undefined;

        productInfoById.set(id, {
            name: toDisplayString(product.display_name) || `Product #${id}`,
            brandName: templateInfo?.brandName ?? "No Brand",
            categoryName: templateInfo?.categoryName ?? "Uncategorized",
            originName: templateInfo?.originName ?? "Unknown Origin",
            rimDiameterName: templateInfo?.rimDiameterName ?? "-",
        });
    }

    const timeZone = await getUserTimezone(credentials, uid);
    const from = toOdooDateBoundary(startDate, false, timeZone);
    const to = toOdooDateBoundary(endDate, true, timeZone);

    const primaryCurrencyId = await getPrimaryCurrencyId(credentials, uid, []);
    const homeCompanyId = await getHomeCompanyId(credentials, uid);
    const todayStr = new Date().toISOString().slice(0, 10);

    // A single running currency -> AED multiplier map shared across every
    // amount source in this report (purchase price, landed cost, operation
    // cost, sales). This system spans multiple companies with different
    // base currencies (see Accounting > Currencies — e.g. AED vs USD
    // companies), and each of those amount sources can independently
    // introduce a currency we haven't seen yet, so the map is extended
    // on demand via `ensureCurrencyMultipliers` rather than computed once
    // up front from only the purchase lines.
    const multiplierByCurrencyId = buildCurrencyMultipliers(primaryCurrencyId, new Map());
    async function ensureCurrencyMultipliers(currencyIds: Array<number | null | undefined>) {
        const missing = Array.from(
            new Set(
                currencyIds.filter(
                    (id): id is number => typeof id === "number" && id > 0 && !multiplierByCurrencyId.has(id)
                )
            )
        );
        if (missing.length === 0 || !homeCompanyId) {
            return;
        }
        const rates = await getCurrencyRatesToHomeCurrency(credentials, uid, homeCompanyId, missing, todayStr);
        for (const [currencyId, rate] of rates) {
            multiplierByCurrencyId.set(currencyId, 1 / rate);
        }
    }

    const unconvertedCurrencyCodes = new Set<string>();

    // Per-product heads-up: which non-AED currencies actually fed into this
    // row's numbers (from any of the four sources below), so the UI can flag
    // "this was originally in USD" etc. instead of the conversion being
    // invisible once everything lands in AED.
    const sourceCurrencyCodesByProductId = new Map<number, Set<string>>();
    function recordSourceCurrency(productId: number, currencyId: number | null, currencyCode: string) {
        if (!currencyId || currencyId === primaryCurrencyId || !currencyCode) {
            return;
        }
        const existing = sourceCurrencyCodesByProductId.get(productId);
        if (existing) {
            existing.add(currencyCode);
        } else {
            sourceCurrencyCodesByProductId.set(productId, new Set([currencyCode]));
        }
    }

    const purchasedQtyByProductId = new Map<number, number>();
    const purchaseValueByProductId = new Map<number, number>();
    const orderIdSet = new Set<number>();
    // The stock moves landed cost gets pulled from in Step 1a — every done
    // move tied to a purchase line matched below, regardless of `dateBasis`.
    let landedCostMoveIds: number[] = [];

    // When a Unified Lot filter is active, every purchase-side query below
    // is additionally pinned to just that shipment's own purchase order(s)
    // (`unifiedLotOrderIds`, resolved above) instead of the matched
    // product's entire purchase history.
    const unifiedLotOrderIdsArray = unifiedLotOrderIds ? Array.from(unifiedLotOrderIds) : null;

    // Exclusion filters resolve to plain id lists up front — unambiguous
    // whether a domain later reaches the order directly (purchase.order.line
    // -> order_id) or through a one2many hop (an invoice line's own
    // sale_line_ids -> order_id), unlike a dotted field-value comparison
    // which behaves differently across those two shapes.
    const [excludedPurchaseOrderIds, excludedSaleOrderIds, dropshipPickingTypeIds] = await Promise.all([
        findOrderIdsMatchingTypeField(credentials, uid, "purchase.order", PURCHASE_TYPE_FIELD_SPEC, excludePurchaseTypeValues),
        excludeSaleTypeValue
            ? findOrderIdsMatchingTypeField(credentials, uid, "sale.order", SALE_TYPE_FIELD_SPEC, [excludeSaleTypeValue])
            : Promise.resolve(null),
        excludeDropshipPurchases ? findDropshipPickingTypeIds(credentials, uid) : Promise.resolve([]),
    ]);

    // Step 1: purchase order lines for matched products, scoped by the
    // ORDER's own date range in both modes — they differ only in which of
    // Odoo's own PO-line quantity fields gets counted:
    //   - "order" (default): `qty_to_invoice + qty_invoiced` — everything
    //     that's actually billable off the line (still to be billed, plus
    //     what's already been billed), which tracks real receiving even
    //     when `qty_received` itself lags or is stale on this deployment.
    //   - "transaction" ("Receiving"): `qty_invoiced` — what's actually been
    //     billed by the vendor, not just received.
    // Per-unit price always comes from the line's own average
    // (price_subtotal / product_qty, the ORDERED qty) so a partial
    // receipt/bill is still priced at the line's real rate.
    const purchaseLineDomain: unknown[] = [
        ["product_id", "in", finalProductIds],
        // Confirmed only — draft/cancelled POs don't belong in a cost report.
        // Deliberately NOT gated on `invoice_status` here: that would only
        // keep orders that are fully billed end-to-end, and since you can't
        // reach that state without also having received everything on the
        // order, it collapses `qty_received` and `qty_invoiced` down to
        // (almost) the same number for whatever's left — silently erasing
        // the exact distinction this report exists to show (received but
        // not yet billed, verified live).
        ["order_id.state", "in", ["purchase", "done"]],
        ["order_id.date_order", ">=", from],
        ["order_id.date_order", "<=", to],
    ];
    if (unifiedLotOrderIdsArray) {
        purchaseLineDomain.push(["order_id", "in", unifiedLotOrderIdsArray]);
    }
    if (excludedPurchaseOrderIds && excludedPurchaseOrderIds.length > 0) {
        purchaseLineDomain.push(["order_id", "not in", excludedPurchaseOrderIds]);
    }
    if (excludeDropshipPurchases && dropshipPickingTypeIds.length > 0) {
        purchaseLineDomain.push(["order_id.picking_type_id", "not in", dropshipPickingTypeIds]);
    }
    const purchaseLines = await executeKw<Array<Record<string, unknown>>>(
        credentials,
        uid,
        "purchase.order.line",
        "search_read",
        [purchaseLineDomain],
        {
            fields: [
                "id",
                "product_id",
                "product_qty",
                "qty_received",
                "qty_invoiced",
                "qty_to_invoice",
                "price_subtotal",
                "currency_id",
                "order_id",
            ],
            limit: 50000,
        }
    );

    await ensureCurrencyMultipliers(purchaseLines.map((line) => getRelationalId(line.currency_id)));

    // With a Unified Lot selected, only the share of each line received into the
    // selected lot(s) counts — not the whole line (see `getPurchaseLotFractions`).
    const selectedLotIds = unifiedLotProductLots
        ? unifiedLotProductLots.filter((entry) => finalProductIds.includes(entry.productId)).map((entry) => entry.lotId)
        : null;
    const lotFractions = selectedLotIds
        ? await getPurchaseLotFractions(credentials, uid, purchaseLines.map((line) => Number(line.id)).filter((id) => id > 0), selectedLotIds)
        : null;

    const purchaseLineIds: number[] = [];

    for (const line of purchaseLines) {
        const id = getRelationalId(line.product_id);
        if (!id) {
            continue;
        }

        const lineId = Number(line.id ?? 0);
        if (lineId > 0) {
            purchaseLineIds.push(lineId);
        }
        const orderId = getRelationalId(line.order_id);
        if (orderId) {
            orderIdSet.add(orderId);
        }

        const orderedQty = Number(line.product_qty ?? 0);
        const lineSubtotal = Number(line.price_subtotal ?? 0);
        const unitPrice = orderedQty > 0 ? lineSubtotal / orderedQty : 0;
        const billableQty =
            dateBasis === "transaction"
                ? Number(line.qty_invoiced ?? 0)
                : Number(line.qty_to_invoice ?? 0) + Number(line.qty_invoiced ?? 0);
        const qty = lotFractions ? billableQty * (lotFractions.byLineId.get(lineId) ?? 0) : billableQty;
        if (qty <= 0) {
            continue;
        }

        purchasedQtyByProductId.set(id, (purchasedQtyByProductId.get(id) ?? 0) + qty);

        const currencyId = getRelationalId(line.currency_id);
        const currencyCode = getRelationalName(line.currency_id) || "?";
        recordSourceCurrency(id, currencyId, currencyCode);
        const multiplier = currencyId ? multiplierByCurrencyId.get(currencyId) : undefined;
        if (multiplier === undefined) {
            if (currencyId) {
                unconvertedCurrencyCodes.add(currencyCode);
            }
            continue;
        }

        const value = unitPrice * qty * multiplier;
        purchaseValueByProductId.set(id, (purchaseValueByProductId.get(id) ?? 0) + value);
    }

    if (purchaseLineIds.length > 0) {
        const moves = await executeKw<Array<Record<string, unknown>>>(
            credentials,
            uid,
            "stock.move",
            "search_read",
            [[
                ["purchase_line_id", "in", purchaseLineIds],
                ["state", "=", "done"],
            ]],
            { fields: ["id"], limit: 50000 }
        );

        landedCostMoveIds = moves.map((move) => Number(move.id ?? 0)).filter((id) => id > 0);
    }

    // Step 1a: landed cost already allocated per product by Odoo's own
    // stock.landed.cost feature. `additional_landed_cost` is a monetary
    // field with its own `currency_id` — it is NOT guaranteed to be in AED
    // (verified live: a landed cost record posted under a USD-currency
    // company stores it in USD) — so it needs the same per-line currency
    // conversion as purchase and sale amounts, not a raw sum.
    const landedCostByProductId = new Map<number, number>();

    if (landedCostMoveIds.length > 0) {
        const valuationLines = await executeKw<Array<Record<string, unknown>>>(
            credentials,
            uid,
            "stock.valuation.adjustment.lines",
            "search_read",
            [[["move_id", "in", landedCostMoveIds]]],
            { fields: ["product_id", "move_id", "additional_landed_cost", "currency_id"], limit: 50000 }
        );

        await ensureCurrencyMultipliers(valuationLines.map((line) => getRelationalId(line.currency_id)));

        for (const line of valuationLines) {
            const id = getRelationalId(line.product_id);
            if (!id) {
                continue;
            }
            // Only the share of this receipt that went into the selected lot(s).
            const moveFraction = lotFractions ? lotFractions.byMoveId.get(getRelationalId(line.move_id) ?? 0) ?? 0 : 1;
            if (moveFraction <= 0) {
                continue;
            }

            const currencyId = getRelationalId(line.currency_id);
            const currencyCode = getRelationalName(line.currency_id) || "?";
            recordSourceCurrency(id, currencyId, currencyCode);
            const multiplier = currencyId ? multiplierByCurrencyId.get(currencyId) : undefined;
            if (multiplier === undefined) {
                if (currencyId) {
                    unconvertedCurrencyCodes.add(currencyCode);
                }
                continue;
            }

            const amount = Number(line.additional_landed_cost ?? 0) * multiplier * moveFraction;
            landedCostByProductId.set(id, (landedCostByProductId.get(id) ?? 0) + amount);
        }
    }

    // Step 1b: "operation cost" — Miscellaneous Operations journal entries
    // posted to the Landed Cost Differences account (found by code, not
    // name, since the name can vary by company). These lines never set the
    // structured `product_id` field (verified live) — the only thing
    // identifying which purchase order a line is for is that PO's
    // plain-text name appearing inside the line's own label (e.g.
    // "P09479 - ..."). Each such line is a single total for the *whole*
    // purchase order — there is no per-product amount recorded anywhere, it
    // has to be computed — so once a line is matched to its order, that
    // order's own lines are fetched and the total is allocated across them
    // in proportion to each line's own price_subtotal share of the order —
    // never divided equally — before a matched product's share is counted.
    //
    // A broad report can easily span thousands of distinct purchase orders.
    // Building one giant "name ilike P00001 OR name ilike P00002 OR ..."
    // domain (and capping how many orders it covers, to keep the domain
    // bounded) would silently drop whichever orders got sliced off —
    // including whichever one actually had a correction. Instead: fetch the
    // candidate journal lines directly (bounded by account, not by how many
    // orders exist), then confirm each candidate line's label against the
    // full set of order names in JS.
    const operationCostByProductId = new Map<number, number>();

    if (orderIdSet.size > 0 && finalProductIds.length > 0) {
        const orderIdsForNames = Array.from(orderIdSet);
        const orderNameById = new Map<number, string>();
        for (let index = 0; index < orderIdsForNames.length; index += 2000) {
            const batch = orderIdsForNames.slice(index, index + 2000);
            const orders = await executeKw<Array<Record<string, unknown>>>(
                credentials,
                uid,
                "purchase.order",
                "read",
                [batch],
                { fields: ["id", "name"] }
            );
            for (const order of orders) {
                const orderId = Number(order.id ?? 0);
                const name = toDisplayString(order.name);
                if (orderId > 0 && name) {
                    orderNameById.set(orderId, name);
                }
            }
        }

        // Longest name first so that if one order's name happens to be a
        // prefix of another's, the more specific (longer) one wins.
        const orderNameEntries = Array.from(orderNameById.entries()).sort(
            (a, b) => b[1].length - a[1].length
        );

        // Finds which known order name (if any) appears in `label` as a
        // whole token — bounded by non-alphanumeric characters or the
        // string edges — so "P0947" can't spuriously match inside "P09479".
        function matchOrderIdInLabel(label: string): number | null {
            for (const [orderId, name] of orderNameEntries) {
                const index = label.indexOf(name);
                if (index === -1) {
                    continue;
                }
                const before = index > 0 ? label[index - 1] : "";
                const after = index + name.length < label.length ? label[index + name.length] : "";
                const isAlnum = (ch: string) => /[A-Za-z0-9]/.test(ch);
                if (!isAlnum(before) && !isAlnum(after)) {
                    return orderId;
                }
            }
            return null;
        }

        const journals = await executeKw<Array<{ id: number }>>(
            credentials,
            uid,
            "account.journal",
            "search_read",
            [[["name", "=", MARGIN_ANALYTICS_OPERATION_COST_JOURNAL_NAME]]],
            { fields: ["id"], limit: 100 }
        );
        const journalIds = journals.map((journal) => Number(journal.id)).filter((id) => id > 0);

        const landedCostDiffAccounts = await executeKw<Array<{ id: number }>>(
            credentials,
            uid,
            "account.account",
            "search_read",
            [[["code", "=", MARGIN_ANALYTICS_LANDED_COST_DIFFERENCES_ACCOUNT_CODE]]],
            { fields: ["id"], limit: 100 }
        );
        const landedCostDiffAccountIds = landedCostDiffAccounts.map((account) => Number(account.id)).filter((id) => id > 0);

        if (journalIds.length > 0 && landedCostDiffAccountIds.length > 0 && orderNameEntries.length > 0) {
            const candidateLines = await executeKw<Array<Record<string, unknown>>>(
                credentials,
                uid,
                "account.move.line",
                "search_read",
                [[
                    ["move_id.journal_id", "in", journalIds],
                    ["move_id.state", "=", "posted"],
                    ["account_id", "in", landedCostDiffAccountIds],
                ]],
                { fields: ["move_id", "name", "debit", "credit"], limit: 20000 }
            );

            // Match each candidate line to the specific order it corrects
            // (via its label), and also pick up the parent move's own
            // company so debit/credit — always expressed in that move's
            // company currency, not necessarily AED — can be converted.
            const orderIdByLineIndex: Array<number | null> = candidateLines.map((line) =>
                matchOrderIdInLabel(toDisplayString(line.name))
            );

            const qualifyingMoveIds = Array.from(
                new Set(
                    candidateLines
                        .filter((_, index) => orderIdByLineIndex[index] !== null)
                        .map((line) => getRelationalId(line.move_id))
                        .filter((id): id is number => typeof id === "number" && id > 0)
                )
            );

            const companyIdByMoveId = new Map<number, number>();
            for (let index = 0; index < qualifyingMoveIds.length; index += 2000) {
                const batch = qualifyingMoveIds.slice(index, index + 2000);
                const moves = await executeKw<Array<Record<string, unknown>>>(
                    credentials,
                    uid,
                    "account.move",
                    "read",
                    [batch],
                    { fields: ["id", "company_id"] }
                );
                for (const move of moves) {
                    const moveId = Number(move.id ?? 0);
                    const companyId = getRelationalId(move.company_id);
                    if (moveId > 0 && companyId) {
                        companyIdByMoveId.set(moveId, companyId);
                    }
                }
            }

            const qualifyingCompanyIds = Array.from(new Set(Array.from(companyIdByMoveId.values())));
            const currencyIdByCompanyId = new Map<number, number>();
            const currencyCodeById = new Map<number, string>();
            if (qualifyingCompanyIds.length > 0) {
                const companies = await executeKw<Array<Record<string, unknown>>>(
                    credentials,
                    uid,
                    "res.company",
                    "read",
                    [qualifyingCompanyIds],
                    { fields: ["id", "currency_id"] }
                );
                for (const company of companies) {
                    const companyId = Number(company.id ?? 0);
                    const currencyId = getRelationalId(company.currency_id);
                    if (companyId > 0 && currencyId) {
                        currencyIdByCompanyId.set(companyId, currencyId);
                        currencyCodeById.set(currencyId, getRelationalName(company.currency_id) || "?");
                    }
                }
                await ensureCurrencyMultipliers(Array.from(currencyIdByCompanyId.values()));
            }

            // Total correction amount per matched order, in AED.
            const correctionByOrderId = new Map<number, number>();
            for (let i = 0; i < candidateLines.length; i++) {
                const orderId = orderIdByLineIndex[i];
                if (orderId === null) {
                    continue;
                }
                const line = candidateLines[i];
                const moveId = getRelationalId(line.move_id);
                const companyId = moveId ? companyIdByMoveId.get(moveId) : undefined;
                const currencyId = companyId ? currencyIdByCompanyId.get(companyId) : undefined;
                const multiplier = currencyId ? multiplierByCurrencyId.get(currencyId) : undefined;
                if (multiplier === undefined) {
                    if (currencyId) {
                        unconvertedCurrencyCodes.add(currencyCodeById.get(currencyId) || "?");
                    }
                    continue;
                }

                const net = (Number(line.debit ?? 0) - Number(line.credit ?? 0)) * multiplier;
                correctionByOrderId.set(orderId, (correctionByOrderId.get(orderId) ?? 0) + net);
            }

            // Split each order's total correction across its own lines in
            // proportion to each line's price_subtotal share of the order
            // total — the only way a whole-order total can be attributed to
            // a specific matched product at all.
            const matchedOrderIds = Array.from(correctionByOrderId.keys());
            if (matchedOrderIds.length > 0) {
                const allOrderLines = await executeKw<Array<Record<string, unknown>>>(
                    credentials,
                    uid,
                    "purchase.order.line",
                    "search_read",
                    [[["order_id", "in", matchedOrderIds]]],
                    { fields: ["order_id", "product_id", "price_subtotal"], limit: 20000 }
                );

                const orderTotalById = new Map<number, number>();
                for (const line of allOrderLines) {
                    const orderId = getRelationalId(line.order_id);
                    if (!orderId) {
                        continue;
                    }
                    const subtotal = Number(line.price_subtotal ?? 0);
                    orderTotalById.set(orderId, (orderTotalById.get(orderId) ?? 0) + subtotal);
                }

                const finalProductIdSet = new Set(finalProductIds);
                for (const line of allOrderLines) {
                    const orderId = getRelationalId(line.order_id);
                    const productId = getRelationalId(line.product_id);
                    if (!orderId || !productId || !finalProductIdSet.has(productId)) {
                        continue;
                    }

                    const orderTotal = orderTotalById.get(orderId) ?? 0;
                    const orderCorrection = correctionByOrderId.get(orderId) ?? 0;
                    if (orderTotal === 0 || orderCorrection === 0) {
                        continue;
                    }

                    // With a Unified Lot, only the share of the line received into it.
                    const lineFraction = lotFractions ? lotFractions.byLineId.get(Number(line.id ?? 0)) ?? 0 : 1;
                    const share = (Number(line.price_subtotal ?? 0) / orderTotal) * lineFraction;
                    const allocated = orderCorrection * share;
                    operationCostByProductId.set(productId, (operationCostByProductId.get(productId) ?? 0) + allocated);
                }
            }
        }
    }

    // Step 1c: "unlinked valuation adjustments" — quantity-less valuation
    // layers with no source document (see `fetchUnlinkedValuationLayers`).
    // Not anchored to any purchase order, so they are added product-wide
    // (or lot-wide when a Unified Lot filter is active).
    const unlinkedAdjustmentByProductId = new Map<number, number>();

    if (finalProductIds.length > 0) {
        const lotIdsForLayers = unifiedLotProductLots
            ? unifiedLotProductLots
                .filter((entry) => finalProductIds.includes(entry.productId))
                .map((entry) => entry.lotId)
            : null;
        const layers = await fetchUnlinkedValuationLayers(
            credentials,
            uid,
            finalProductIds,
            lotIdsForLayers,
            startDate,
            endDate
        );

        await ensureCurrencyMultipliers(layers.map((layer) => layer.currencyId));

        for (const layer of layers) {
            recordSourceCurrency(layer.productId, layer.currencyId, layer.currencyCode);
            const multiplier = layer.currencyId ? multiplierByCurrencyId.get(layer.currencyId) : undefined;
            if (multiplier === undefined) {
                if (layer.currencyId) {
                    unconvertedCurrencyCodes.add(layer.currencyCode);
                }
                continue;
            }
            unlinkedAdjustmentByProductId.set(
                layer.productId,
                (unlinkedAdjustmentByProductId.get(layer.productId) ?? 0) + layer.value * multiplier
            );
        }
    }

    // Step 3: sales in the same period, same currency-safe conversion.
    const soldQtyByProductId = new Map<number, number>();
    const salesValueByProductId = new Map<number, number>();

    if (dateBasis === "transaction") {
        // Transaction basis: scope by the customer invoice's own Invoice
        // Date (a plain Date field, not Datetime — compared against
        // startDate/endDate directly, unlike date_order above) instead of
        // the sale order's date. Reads straight from the invoice's own
        // lines (account.move.line) rather than sale.order.line, which is
        // itself more accurate for "what was actually sold in this period"
        // since a confirmed SO can sit uninvoiced for a while.
        //
        // `display_type` must be filtered to exactly "product" — verified
        // live that with automated (Anglo-Saxon) inventory valuation, Odoo
        // posts the COGS/Stock-Output contra-entries as extra lines on the
        // very same invoice move, tagged with the same product_id and
        // `display_type: "cogs"`; without this filter those exactly-
        // offsetting lines would double the line count for no net value
        // (or corrupt it, since their sign/account differs from the real
        // revenue line).
        const invoiceLineDomain: unknown[] = [
            ["product_id", "in", finalProductIds],
            ["display_type", "=", "product"],
            ["move_id.move_type", "=", "out_invoice"],
            ["move_id.state", "=", "posted"],
            ["move_id.invoice_date", ">=", startDate],
            ["move_id.invoice_date", "<=", endDate],
        ];
        if (unifiedLotSaleLineIds) {
            invoiceLineDomain.push(["sale_line_ids", "in", Array.from(unifiedLotSaleLineIds)]);
        }
        if (excludedSaleOrderIds && excludedSaleOrderIds.length > 0) {
            invoiceLineDomain.push(["sale_line_ids.order_id", "not in", excludedSaleOrderIds]);
        }
        if (excludeCustomerIds.length > 0) {
            invoiceLineDomain.push(["partner_id", "not in", excludeCustomerIds]);
        }
        const invoiceLines = await executeKw<Array<Record<string, unknown>>>(
            credentials,
            uid,
            "account.move.line",
            "search_read",
            [invoiceLineDomain],
            {
                fields: ["product_id", "quantity", "price_subtotal", "currency_id"],
                limit: 50000,
            }
        );

        await ensureCurrencyMultipliers(invoiceLines.map((line) => getRelationalId(line.currency_id)));

        for (const line of invoiceLines) {
            const id = getRelationalId(line.product_id);
            if (!id) {
                continue;
            }

            const qty = Number(line.quantity ?? 0);
            soldQtyByProductId.set(id, (soldQtyByProductId.get(id) ?? 0) + qty);

            const currencyId = getRelationalId(line.currency_id);
            const currencyCode = getRelationalName(line.currency_id) || "?";
            recordSourceCurrency(id, currencyId, currencyCode);
            const multiplier = currencyId ? multiplierByCurrencyId.get(currencyId) : undefined;
            if (multiplier === undefined) {
                if (currencyId) {
                    unconvertedCurrencyCodes.add(currencyCode);
                }
                continue;
            }

            const value = Number(line.price_subtotal ?? 0) * multiplier;
            salesValueByProductId.set(id, (salesValueByProductId.get(id) ?? 0) + value);
        }
    } else {
        const saleLineDomain: unknown[] = [
            ["product_id", "in", finalProductIds],
            ["display_type", "=", false],
            ["order_id.state", "in", ["sale", "done"]],
            ["order_id.date_order", ">=", from],
            ["order_id.date_order", "<=", to],
        ];
        if (unifiedLotSaleLineIds) {
            saleLineDomain.push(["id", "in", Array.from(unifiedLotSaleLineIds)]);
        }
        if (excludedSaleOrderIds && excludedSaleOrderIds.length > 0) {
            saleLineDomain.push(["order_id", "not in", excludedSaleOrderIds]);
        }
        if (excludeCustomerIds.length > 0) {
            saleLineDomain.push(["order_id.partner_id", "not in", excludeCustomerIds]);
        }
        const saleLines = await executeKw<Array<Record<string, unknown>>>(
            credentials,
            uid,
            "sale.order.line",
            "search_read",
            [saleLineDomain],
            {
                fields: ["id", "product_id", "product_uom_qty", "price_subtotal", "currency_id"],
                limit: 50000,
            }
        );

        await ensureCurrencyMultipliers(saleLines.map((line) => getRelationalId(line.currency_id)));

        for (const line of saleLines) {
            const id = getRelationalId(line.product_id);
            if (!id) {
                continue;
            }

            const lineQty = Number(line.product_uom_qty ?? 0);
            const lineSubtotal = Number(line.price_subtotal ?? 0);

            // Under a Unified Lot filter, count only the units of this line
            // that actually shipped from that shipment, priced at the line's
            // own per-unit rate — not the whole line.
            let qty = lineQty;
            let subtotal = lineSubtotal;
            if (unifiedLotQtyBySaleLineId) {
                const lotQty = unifiedLotQtyBySaleLineId.get(Number(line.id ?? 0)) ?? 0;
                if (lotQty <= 0) {
                    continue;
                }
                const unitPrice = lineQty > 0 ? lineSubtotal / lineQty : 0;
                qty = Math.min(lotQty, lineQty);
                subtotal = unitPrice * qty;
            }

            soldQtyByProductId.set(id, (soldQtyByProductId.get(id) ?? 0) + qty);

            const currencyId = getRelationalId(line.currency_id);
            const currencyCode = getRelationalName(line.currency_id) || "?";
            recordSourceCurrency(id, currencyId, currencyCode);
            const multiplier = currencyId ? multiplierByCurrencyId.get(currencyId) : undefined;
            if (multiplier === undefined) {
                if (currencyId) {
                    unconvertedCurrencyCodes.add(currencyCode);
                }
                continue;
            }

            const value = subtotal * multiplier;
            salesValueByProductId.set(id, (salesValueByProductId.get(id) ?? 0) + value);
        }
    }

    // Current stock on hand — a present-day snapshot, not bound to the
    // selected date range.
    const quants = await executeKw<Array<Record<string, unknown>>>(
        credentials,
        uid,
        "stock.quant",
        "search_read",
        [[
            ["product_id", "in", finalProductIds],
            ["location_id.usage", "=", "internal"],
        ]],
        { fields: ["product_id", "lot_id", "quantity"], limit: 50000 }
    );

    const currentStockByProductId = new Map<number, number>();
    const stockByLotByProductId = new Map<number, Map<string, number>>();
    for (const quant of quants) {
        const id = getRelationalId(quant.product_id);
        if (!id) {
            continue;
        }

        const quantity = Number(quant.quantity ?? 0);
        currentStockByProductId.set(id, (currentStockByProductId.get(id) ?? 0) + quantity);

        const lotName = getRelationalName(quant.lot_id) || "No lot";
        const lotMap = stockByLotByProductId.get(id) ?? new Map<string, number>();
        lotMap.set(lotName, (lotMap.get(lotName) ?? 0) + quantity);
        stockByLotByProductId.set(id, lotMap);
    }

    // Step 3b (Odoo valuation basis only): Odoo's own current cost per unit
    // = total value of every valuation layer / total quantity of every layer
    // (receipts, deliveries, returns, landed costs and quantity-less
    // revaluations alike) — i.e. remaining stock value over remaining qty,
    // which is exactly how AVCO arrives at the product's cost after the
    // latest receipt or revaluation. Deliberately NOT date-scoped: a
    // correction posted after the period still moves what Odoo says the
    // stock costs now. Lot-scoped when a Unified Lot filter is active.
    const odooCostPerUnitByProductId = new Map<number, number>();

    if (valuationBasis === "odoo" && finalProductIds.length > 0) {
        const layerFields = await executeKw<Record<string, unknown>>(
            credentials,
            uid,
            "stock.valuation.layer",
            "fields_get",
            [],
            { attributes: ["type"] }
        );
        const layerHas = (name: string) => Object.prototype.hasOwnProperty.call(layerFields, name);

        const layerDomain: unknown[] = [["product_id", "in", finalProductIds]];
        if (unifiedLotProductLots) {
            const lotIdsForCost = unifiedLotProductLots
                .filter((entry) => finalProductIds.includes(entry.productId))
                .map((entry) => entry.lotId);
            const lotField = ["lot_id", "lot_ids"].find(layerHas);
            // Layers tied to a stock move reach their lot through the move's
            // lines; move-less revaluations only through the layer's own lot
            // field (when this database has one).
            if (lotField) {
                layerDomain.push(
                    "|",
                    ["stock_move_id.move_line_ids.lot_id", "in", lotIdsForCost],
                    [lotField, "in", lotIdsForCost]
                );
            } else {
                layerDomain.push(["stock_move_id.move_line_ids.lot_id", "in", lotIdsForCost]);
            }
        }

        const costLayers = await searchReadAll(
            credentials,
            uid,
            "stock.valuation.layer",
            layerDomain,
            ["product_id", "quantity", "value", "currency_id"]
        );
        await ensureCurrencyMultipliers(costLayers.map((layer) => getRelationalId(layer.currency_id)));

        const netQtyByProductId = new Map<number, number>();
        const netValueByProductId = new Map<number, number>();
        for (const layer of costLayers) {
            const id = getRelationalId(layer.product_id);
            if (!id) {
                continue;
            }
            const currencyId = getRelationalId(layer.currency_id);
            const currencyCode = getRelationalName(layer.currency_id) || "?";
            recordSourceCurrency(id, currencyId, currencyCode);
            const multiplier = currencyId ? multiplierByCurrencyId.get(currencyId) : undefined;
            if (multiplier === undefined) {
                if (currencyId) {
                    unconvertedCurrencyCodes.add(currencyCode);
                }
                continue;
            }
            netQtyByProductId.set(id, (netQtyByProductId.get(id) ?? 0) + Number(layer.quantity ?? 0));
            netValueByProductId.set(id, (netValueByProductId.get(id) ?? 0) + Number(layer.value ?? 0) * multiplier);
        }
        for (const [id, qty] of netQtyByProductId) {
            // No stock left means no "remaining value / remaining qty";
            // those products fall back to the averaged components.
            if (qty > 0) {
                odooCostPerUnitByProductId.set(id, (netValueByProductId.get(id) ?? 0) / qty);
            }
        }
    }

    // Step 2 & 4: per-product averages, then report-level highlights.
    const rows: MarginAnalyticsProductRow[] = finalProductIds
        .map((id) => {
            const info = productInfoById.get(id);
            const purchasedQty = Number((purchasedQtyByProductId.get(id) ?? 0).toFixed(2));
            const purchaseValue = purchaseValueByProductId.get(id) ?? 0;
            const landedCostValue = landedCostByProductId.get(id) ?? 0;
            const operationCostValue = operationCostByProductId.get(id) ?? 0;
            const unlinkedAdjustmentValue = unlinkedAdjustmentByProductId.get(id) ?? 0;

            const avgPurchasePrice = purchasedQty > 0 ? purchaseValue / purchasedQty : 0;
            const avgLandedCostPerUnit = purchasedQty > 0 ? landedCostValue / purchasedQty : 0;
            const avgOperationCostPerUnit = purchasedQty > 0 ? operationCostValue / purchasedQty : 0;
            // Operation cost is already signed (positive = debit = increases
            // cost, negative = credit = decreases cost), so combining it
            // with landed cost is a plain sum either way.
            const avgFinalLandedCostPerUnit = avgLandedCostPerUnit + avgOperationCostPerUnit;
            // Unlinked valuation adjustments are signed too (a negative
            // layer lowers cost), so they join the total as a plain sum.
            const avgUnlinkedAdjustmentPerUnit = purchasedQty > 0 ? unlinkedAdjustmentValue / purchasedQty : 0;
            const avgComponentsCostPerUnit =
                avgPurchasePrice + avgLandedCostPerUnit + avgOperationCostPerUnit + avgUnlinkedAdjustmentPerUnit;
            // Odoo valuation basis: use Odoo's current cost per unit; fall
            // back to the averaged components when no stock remains.
            const odooCostPerUnit = odooCostPerUnitByProductId.get(id);
            const usesOdooCost = valuationBasis === "odoo" && odooCostPerUnit !== undefined;
            // Operation corrections are journal entries that never create a
            // valuation layer, so Odoo's own cost doesn't include them —
            // they are added on top as a separate line.
            const avgTotalCostPerUnit = usesOdooCost
                ? (odooCostPerUnit as number) + avgOperationCostPerUnit
                : avgComponentsCostPerUnit;

            const soldQty = Number((soldQtyByProductId.get(id) ?? 0).toFixed(2));
            const salesValue = salesValueByProductId.get(id) ?? 0;
            const avgSalesPrice = soldQty > 0 ? salesValue / soldQty : 0;

            const hasSalesData = soldQty > 0 && purchasedQty > 0;
            const avgMarginPerUnit = hasSalesData ? avgSalesPrice - avgTotalCostPerUnit : 0;
            const marginPercent = hasSalesData && avgSalesPrice > 0 ? (avgMarginPerUnit / avgSalesPrice) * 100 : 0;
            const estimatedProfitLoss = hasSalesData ? avgMarginPerUnit * soldQty : 0;

            const flags: MarginAnalyticsRowFlag[] = [];
            if (purchasedQty > 0 && soldQty === 0) {
                flags.push("never-sold");
            }
            if (soldQty > 0 && purchasedQty === 0) {
                flags.push("sold-without-purchase");
            }
            if (purchasedQty > 0 && avgLandedCostPerUnit === 0) {
                flags.push("no-landed-cost");
            }
            if (hasSalesData && marginPercent < 0) {
                flags.push("negative-margin");
            }
            if (avgOperationCostPerUnit !== 0 || avgUnlinkedAdjustmentPerUnit !== 0) {
                flags.push("has-cost-correction");
            }

            return {
                productId: id,
                productName: info?.name ?? `Product #${id}`,
                brandName: info?.brandName ?? "No Brand",
                categoryName: info?.categoryName ?? "Uncategorized",
                originName: info?.originName ?? "Unknown Origin",
                rimDiameterName: info?.rimDiameterName ?? "-",
                purchasedQty,
                avgPurchasePrice: Number(avgPurchasePrice.toFixed(2)),
                avgLandedCostPerUnit: Number(avgLandedCostPerUnit.toFixed(2)),
                avgOdooCostPerUnit: usesOdooCost ? Number((odooCostPerUnit as number).toFixed(2)) : 0,
                avgOperationCostPerUnit: Number(avgOperationCostPerUnit.toFixed(2)),
                avgUnlinkedAdjustmentPerUnit: Number(avgUnlinkedAdjustmentPerUnit.toFixed(2)),
                avgFinalLandedCostPerUnit: Number(avgFinalLandedCostPerUnit.toFixed(2)),
                avgTotalCostPerUnit: Number(avgTotalCostPerUnit.toFixed(2)),
                soldQty,
                avgSalesPrice: Number(avgSalesPrice.toFixed(2)),
                hasSalesData,
                avgMarginPerUnit: Number(avgMarginPerUnit.toFixed(2)),
                marginPercent: Number(marginPercent.toFixed(2)),
                estimatedProfitLoss: Number(estimatedProfitLoss.toFixed(2)),
                currentStock: Number((currentStockByProductId.get(id) ?? 0).toFixed(2)),
                stockByLot: Array.from(stockByLotByProductId.get(id) ?? [])
                    .map(([lotName, quantity]) => ({ lotName, quantity: Number(quantity.toFixed(2)) }))
                    .filter((entry) => entry.quantity !== 0)
                    .sort((a, b) => b.lotName.localeCompare(a.lotName)),
                flags,
                originalCurrencies: Array.from(sourceCurrencyCodesByProductId.get(id) ?? []).sort(),
            };
        })
        .sort((a, b) => b.estimatedProfitLoss - a.estimatedProfitLoss);

    const productsWithPurchases = rows.filter((row) => row.purchasedQty > 0).length;
    const rowsWithSalesData = rows.filter((row) => row.hasSalesData);
    const productsWithoutSales = rows.filter((row) => row.purchasedQty > 0 && row.soldQty === 0).length;
    const productsWithoutLandedCost = rows.filter(
        (row) => row.purchasedQty > 0 && row.avgLandedCostPerUnit === 0
    ).length;

    const totalPurchasedQty = rows.reduce((sum, row) => sum + row.purchasedQty, 0);
    const totalPurchaseValue = rows.reduce((sum, row) => sum + row.avgPurchasePrice * row.purchasedQty, 0);
    const totalLandedCostValue = rows.reduce((sum, row) => sum + row.avgLandedCostPerUnit * row.purchasedQty, 0);
    const totalOperationCostValue = rows.reduce((sum, row) => sum + row.avgOperationCostPerUnit * row.purchasedQty, 0);
    const totalUnlinkedAdjustmentValue = rows.reduce(
        (sum, row) => sum + row.avgUnlinkedAdjustmentPerUnit * row.purchasedQty,
        0
    );
    const totalSoldQty = rows.reduce((sum, row) => sum + row.soldQty, 0);
    const totalSalesValue = rowsWithSalesData.reduce((sum, row) => sum + row.avgSalesPrice * row.soldQty, 0);
    const totalEstimatedProfitLoss = rows.reduce((sum, row) => sum + row.estimatedProfitLoss, 0);
    const totalCurrentStock = rows.reduce((sum, row) => sum + row.currentStock, 0);

    return {
        startDate,
        endDate,
        currencyCode: TARGET_CURRENCY_CODE,
        valuationBasis,
        matchedProductCount: finalProductIds.length,
        rows,
        highlights: {
            productsWithPurchases,
            productsWithSales: rowsWithSalesData.length,
            productsWithoutSales,
            productsWithoutLandedCost,
            totalPurchasedQty: Number(totalPurchasedQty.toFixed(2)),
            totalSoldQty: Number(totalSoldQty.toFixed(2)),
            totalCurrentStock: Number(totalCurrentStock.toFixed(2)),
            avgPurchasePrice: totalPurchasedQty > 0 ? Number((totalPurchaseValue / totalPurchasedQty).toFixed(2)) : 0,
            avgLandedCostPerUnit: totalPurchasedQty > 0
                ? Number((totalLandedCostValue / totalPurchasedQty).toFixed(2))
                : 0,
            avgOperationCostPerUnit: totalPurchasedQty > 0
                ? Number((totalOperationCostValue / totalPurchasedQty).toFixed(2))
                : 0,
            avgUnlinkedAdjustmentPerUnit: totalPurchasedQty > 0
                ? Number((totalUnlinkedAdjustmentValue / totalPurchasedQty).toFixed(2))
                : 0,
            avgFinalLandedCostPerUnit: totalPurchasedQty > 0
                ? Number(((totalLandedCostValue + totalOperationCostValue) / totalPurchasedQty).toFixed(2))
                : 0,
            avgTotalCostPerUnit: totalPurchasedQty > 0
                ? Number(
                    (valuationBasis === "odoo"
                        ? rows.reduce((sum, row) => sum + row.avgTotalCostPerUnit * row.purchasedQty, 0) / totalPurchasedQty
                        : (totalPurchaseValue + totalLandedCostValue + totalOperationCostValue + totalUnlinkedAdjustmentValue) /
                        totalPurchasedQty
                    ).toFixed(2)
                )
                : 0,
            avgSalesPrice: totalSoldQty > 0 ? Number((totalSalesValue / totalSoldQty).toFixed(2)) : 0,
            avgMarginPercent: totalSalesValue > 0
                ? Number(((totalEstimatedProfitLoss / totalSalesValue) * 100).toFixed(2))
                : 0,
            totalEstimatedProfitLoss: Number(totalEstimatedProfitLoss.toFixed(2)),
        },
        unconvertedCurrencyCodes: Array.from(unconvertedCurrencyCodes),
    };
}

export type MarginAnalyticsBreakdownRow = {
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
     * PO line (via its receipt move), and the resulting per-unit price. */
    landedCostAmount?: number;
    finalUnitPrice?: number;
};

export type MarginAnalyticsBreakdown = {
    productId: number;
    productName: string;
    currencyCode: string;
    startDate: string;
    endDate: string;
    dateBasis: "order" | "transaction";
    unifiedLotNames: string[];
    purchases: MarginAnalyticsBreakdownRow[];
    landedCosts: MarginAnalyticsBreakdownRow[];
    operationCosts: MarginAnalyticsBreakdownRow[];
    unlinkedAdjustments: MarginAnalyticsBreakdownRow[];
    sales: MarginAnalyticsBreakdownRow[];
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

/**
 * The record-level evidence behind ONE product's row in the margin analytics
 * report: every purchase order line, landed-cost allocation, operation-cost
 * correction and sale that fed its numbers, each tagged with the stock lot(s)
 * actually involved.
 *
 * This deliberately re-runs the same queries, in the same order, with the same
 * filters and the same currency conversion as `getMarginAnalyticsReport` — so
 * the rows shown are literally the ones that produced the aggregate, and the
 * returned `totals` can be compared against the report row to prove it. Where
 * that function sums, this one also keeps the individual rows.
 */
export async function getMarginAnalyticsBreakdown(
    credentials: OdooCredentials,
    input: {
        productId: number;
        unifiedLotIds?: number[] | null;
        excludePurchaseTypeValues?: string[] | null;
        excludeSaleTypeValue?: string | null;
        excludeCustomerIds?: number[] | null;
        excludeDropshipPurchases?: boolean | null;
        startDate: string;
        endDate: string;
        dateBasis?: "order" | "transaction" | null;
    }
): Promise<MarginAnalyticsBreakdown> {
    const uid = await authenticate(credentials);
    const dateBasis = input.dateBasis === "transaction" ? "transaction" : "order";
    const productId = Number(input.productId);
    if (!Number.isFinite(productId) || productId <= 0) {
        throw new Error("A valid product is required.");
    }

    const startDate = input.startDate;
    const endDate = input.endDate;
    ensureDateRange(startDate, endDate);

    const unifiedLotIds = Array.isArray(input.unifiedLotIds)
        ? Array.from(new Set(input.unifiedLotIds.map(Number).filter((id) => Number.isFinite(id) && id > 0)))
        : [];
    const hasUnifiedLot = unifiedLotIds.length > 0;

    const excludePurchaseTypeValues = Array.isArray(input.excludePurchaseTypeValues)
        ? Array.from(new Set(input.excludePurchaseTypeValues.map((value) => String(value)).filter(Boolean)))
        : [];
    const excludeSaleTypeValue = toDisplayString(input.excludeSaleTypeValue).trim() || null;
    const excludeCustomerIds = Array.isArray(input.excludeCustomerIds)
        ? Array.from(new Set(input.excludeCustomerIds.map(Number).filter((id) => Number.isFinite(id) && id > 0)))
        : [];
    const excludeDropshipPurchases = Boolean(input.excludeDropshipPurchases);

    const [excludedPurchaseOrderIds, excludedSaleOrderIds, dropshipPickingTypeIds] = await Promise.all([
        findOrderIdsMatchingTypeField(credentials, uid, "purchase.order", PURCHASE_TYPE_FIELD_SPEC, excludePurchaseTypeValues),
        excludeSaleTypeValue
            ? findOrderIdsMatchingTypeField(credentials, uid, "sale.order", SALE_TYPE_FIELD_SPEC, [excludeSaleTypeValue])
            : Promise.resolve(null),
        excludeDropshipPurchases ? findDropshipPickingTypeIds(credentials, uid) : Promise.resolve([]),
    ]);

    const productRows = await executeKw<Array<Record<string, unknown>>>(
        credentials,
        uid,
        "product.product",
        "read",
        [[productId]],
        { fields: ["id", "display_name"] }
    );
    const productName = toDisplayString(productRows[0]?.display_name) || `Product #${productId}`;

    const timeZone = await getUserTimezone(credentials, uid);
    const from = toOdooDateBoundary(startDate, false, timeZone);
    const to = toOdooDateBoundary(endDate, true, timeZone);

    const primaryCurrencyId = await getPrimaryCurrencyId(credentials, uid, []);
    const homeCompanyId = await getHomeCompanyId(credentials, uid);
    const todayStr = new Date().toISOString().slice(0, 10);
    const multiplierByCurrencyId = buildCurrencyMultipliers(primaryCurrencyId, new Map());
    async function ensureCurrencyMultipliers(currencyIds: Array<number | null | undefined>) {
        const missing = Array.from(
            new Set(
                currencyIds.filter(
                    (id): id is number => typeof id === "number" && id > 0 && !multiplierByCurrencyId.has(id)
                )
            )
        );
        if (missing.length === 0 || !homeCompanyId) {
            return;
        }
        const rates = await getCurrencyRatesToHomeCurrency(credentials, uid, homeCompanyId, missing, todayStr);
        for (const [currencyId, rate] of rates) {
            multiplierByCurrencyId.set(currencyId, 1 / rate);
        }
    }
    // Mirrors the report exactly: a currency with no configured exchange
    // rate is EXCLUDED, not silently treated as 1:1. Converting it at par
    // would make this panel disagree with the very total it exists to
    // justify (verified live: doing so overstated sales value by ~1 000 AED).
    const rateFor = (currencyId: number | null) =>
        currencyId ? multiplierByCurrencyId.get(currencyId) : undefined;

    // Same Unified Lot resolution as the report (paginated, product-scoped).
    let unifiedLotNames: string[] = [];
    let unifiedLotOrderIds: number[] | null = null;
    let unifiedLotSaleLineIds: number[] | null = null;
    let unifiedLotIdsForProduct: number[] | null = null;
    const unifiedLotQtyBySaleLineId = new Map<number, number>();

    if (hasUnifiedLot) {
        const unifiedLots = await executeKw<Array<Record<string, unknown>>>(
            credentials,
            uid,
            "stock.unified.lot",
            "read",
            [unifiedLotIds],
            { fields: ["id", "name"] }
        );
        unifiedLotNames = unifiedLots
            .map((lot) => toDisplayString(lot.name))
            .filter((name): name is string => Boolean(name));

        const lots = await searchReadAll(
            credentials,
            uid,
            "stock.lot",
            [["unified_lot_id", "in", unifiedLotIds], ["product_id", "=", productId]],
            ["id"]
        );
        const lotIds = lots.map((lot) => Number(lot.id ?? 0)).filter((id) => id > 0);
        unifiedLotIdsForProduct = lotIds;

        unifiedLotOrderIds = [];
        unifiedLotSaleLineIds = [];

        if (lotIds.length > 0) {
            const lotMoveLines = await searchReadAll(
                credentials,
                uid,
                "stock.move.line",
                [["lot_id", "in", lotIds], ["product_id", "=", productId], ["state", "=", "done"]],
                ["move_id", "quantity", "qty_done", "location_id", "location_dest_id"]
            );

            const moveIds = Array.from(
                new Set(
                    lotMoveLines
                        .map((line) => getRelationalId(line.move_id))
                        .filter((id): id is number => typeof id === "number" && id > 0)
                )
            );

            if (moveIds.length > 0) {
                const moves = await readInBatches(
                    credentials,
                    uid,
                    "stock.move",
                    moveIds,
                    ["id", "purchase_line_id", "sale_line_id"]
                );

                const purchaseLineIds = Array.from(
                    new Set(
                        moves
                            .map((move) => getRelationalId(move.purchase_line_id))
                            .filter((id): id is number => typeof id === "number" && id > 0)
                    )
                );
                if (purchaseLineIds.length > 0) {
                    const poLines = await readInBatches(
                        credentials,
                        uid,
                        "purchase.order.line",
                        purchaseLineIds,
                        ["id", "order_id"]
                    );
                    const orderIds = new Set<number>();
                    for (const line of poLines) {
                        const orderId = getRelationalId(line.order_id);
                        if (orderId) {
                            orderIds.add(orderId);
                        }
                    }
                    unifiedLotOrderIds = Array.from(orderIds);
                }

                const saleLineIdByMoveId = new Map<number, number>();
                const saleLineIds = new Set<number>();
                for (const move of moves) {
                    const moveId = Number(move.id ?? 0);
                    const saleLineId = getRelationalId(move.sale_line_id);
                    if (moveId > 0 && saleLineId) {
                        saleLineIdByMoveId.set(moveId, saleLineId);
                        saleLineIds.add(saleLineId);
                    }
                }
                unifiedLotSaleLineIds = Array.from(saleLineIds);

                const locationIds = Array.from(
                    new Set(
                        lotMoveLines
                            .flatMap((line) => [getRelationalId(line.location_id), getRelationalId(line.location_dest_id)])
                            .filter((id): id is number => typeof id === "number" && id > 0)
                    )
                );
                const locationUsageById = new Map<number, string>();
                if (locationIds.length > 0) {
                    const locations = await readInBatches(credentials, uid, "stock.location", locationIds, ["id", "usage"]);
                    for (const location of locations) {
                        const locationId = Number(location.id ?? 0);
                        if (locationId > 0) {
                            locationUsageById.set(locationId, toDisplayString(location.usage));
                        }
                    }
                }

                for (const line of lotMoveLines) {
                    const moveId = getRelationalId(line.move_id);
                    const saleLineId = moveId ? saleLineIdByMoveId.get(moveId) : undefined;
                    if (!saleLineId) {
                        continue;
                    }
                    const sourceUsage = locationUsageById.get(getRelationalId(line.location_id) ?? 0);
                    const destUsage = locationUsageById.get(getRelationalId(line.location_dest_id) ?? 0);
                    const rawQty = Number(line.quantity ?? line.qty_done ?? 0);
                    const signedQty = destUsage === "customer" ? rawQty : sourceUsage === "customer" ? -rawQty : 0;
                    if (signedQty !== 0) {
                        unifiedLotQtyBySaleLineId.set(
                            saleLineId,
                            (unifiedLotQtyBySaleLineId.get(saleLineId) ?? 0) + signedQty
                        );
                    }
                }
            }
        }
    }

    const purchases: MarginAnalyticsBreakdownRow[] = [];
    const landedCosts: MarginAnalyticsBreakdownRow[] = [];
    const operationCosts: MarginAnalyticsBreakdownRow[] = [];
    const unlinkedAdjustments: MarginAnalyticsBreakdownRow[] = [];
    const sales: MarginAnalyticsBreakdownRow[] = [];

    // ---- Purchases (mirrors Step 1 of the report) ----
    const orderIdSet = new Set<number>();
    let landedCostMoveIds: number[] = [];

    // Mirrors the report: scoped by the ORDER's own date range in both
    // modes, differing only in which quantity field is read off the line —
    // `qty_to_invoice + qty_invoiced` for "order" (default), `qty_invoiced`
    // for "transaction" ("Receiving"). Per-unit price always comes from the
    // line's own average.
    const purchaseDomain: unknown[] = [
        ["product_id", "=", productId],
        // See the report's identical domain for why `invoice_status` is
        // deliberately not gated here.
        ["order_id.state", "in", ["purchase", "done"]],
        ["order_id.date_order", ">=", from],
        ["order_id.date_order", "<=", to],
    ];
    if (unifiedLotOrderIds) {
        purchaseDomain.push(["order_id", "in", unifiedLotOrderIds]);
    }
    if (excludedPurchaseOrderIds && excludedPurchaseOrderIds.length > 0) {
        purchaseDomain.push(["order_id", "not in", excludedPurchaseOrderIds]);
    }
    if (excludeDropshipPurchases && dropshipPickingTypeIds.length > 0) {
        purchaseDomain.push(["order_id.picking_type_id", "not in", dropshipPickingTypeIds]);
    }
    const poLines = await searchReadAll(
        credentials,
        uid,
        "purchase.order.line",
        purchaseDomain,
        ["id", "product_qty", "qty_received", "qty_invoiced", "qty_to_invoice", "price_subtotal", "currency_id", "order_id"]
    );
    await ensureCurrencyMultipliers(poLines.map((line) => getRelationalId(line.currency_id)));

    // With a Unified Lot, only the share of each line received into it counts.
    const lotFractions = unifiedLotIdsForProduct
        ? await getPurchaseLotFractions(credentials, uid, poLines.map((line) => Number(line.id)).filter((id) => id > 0), unifiedLotIdsForProduct)
        : null;

    const orderIds = Array.from(
        new Set(
            poLines
                .map((line) => getRelationalId(line.order_id))
                .filter((id): id is number => typeof id === "number" && id > 0)
        )
    );
    const orders = orderIds.length
        ? await readInBatches(credentials, uid, "purchase.order", orderIds, ["id", "name", "partner_id", "date_order"])
        : [];
    const orderById = new Map(orders.map((order) => [Number(order.id ?? 0), order]));

    const poLineIds: number[] = [];
    // Lets the landed-cost pass below (Step 1a) write each PO line's matched
    // landed cost / final unit price back onto the exact row it belongs to,
    // instead of only having the aggregate total available.
    const purchaseRowByLineId = new Map<number, MarginAnalyticsBreakdownRow>();
    for (const line of poLines) {
        const lineId = Number(line.id ?? 0);
        if (lineId > 0) {
            poLineIds.push(lineId);
        }
        const orderId = getRelationalId(line.order_id);
        if (orderId) {
            orderIdSet.add(orderId);
        }
        const order = orderId ? orderById.get(orderId) : undefined;
        const orderedQty = Number(line.product_qty ?? 0);
        const subtotal = Number(line.price_subtotal ?? 0);
        const unitPrice = orderedQty > 0 ? subtotal / orderedQty : 0;
        const billableQty =
            dateBasis === "transaction"
                ? Number(line.qty_invoiced ?? 0)
                : Number(line.qty_to_invoice ?? 0) + Number(line.qty_invoiced ?? 0);
        const qty = lotFractions ? billableQty * (lotFractions.byLineId.get(lineId) ?? 0) : billableQty;
        if (qty <= 0) {
            continue;
        }
        const currencyId = getRelationalId(line.currency_id);
        const multiplier = rateFor(currencyId);
        if (multiplier === undefined) {
            continue;
        }

        const purchaseRow: MarginAnalyticsBreakdownRow = {
            reference: toDisplayString(order?.name) || `PO #${orderId ?? "?"}`,
            date: normalizeOdooDate(order?.date_order),
            partnerName: getRelationalName(order?.partner_id) || "",
            lots: [],
            quantity: qty,
            unitPrice: unitPrice * multiplier,
            currencyCode: getRelationalName(line.currency_id) || TARGET_CURRENCY_CODE,
            amount: unitPrice * qty * multiplier,
            note:
                dateBasis === "transaction"
                    ? "Purchase order line (qty billed)"
                    : "Purchase order line (qty to be billed + qty billed)",
            landedCostAmount: 0,
            finalUnitPrice: unitPrice * multiplier,
        };
        purchases.push(purchaseRow);
        if (lineId > 0) {
            purchaseRowByLineId.set(lineId, purchaseRow);
        }
    }

    // Which purchase line each receipt move came from, so the landed cost
    // allocated to that move (below) can be matched back to the one PO line
    // row it actually landed on instead of only the product-wide total.
    const purchaseLineIdByMoveId = new Map<number, number>();

    if (poLineIds.length > 0) {
        const moves = await searchReadAll(
            credentials,
            uid,
            "stock.move",
            [["purchase_line_id", "in", poLineIds], ["state", "=", "done"]],
            ["id", "purchase_line_id"]
        );
        landedCostMoveIds = moves.map((move) => Number(move.id ?? 0)).filter((id) => id > 0);
        for (const move of moves) {
            const moveId = Number(move.id ?? 0);
            const purchaseLineId = getRelationalId(move.purchase_line_id);
            if (moveId > 0 && purchaseLineId) {
                purchaseLineIdByMoveId.set(moveId, purchaseLineId);
            }
        }
    }

    // Which lots each receipt actually brought in, so a purchase row can say
    // "this is the batch it landed as".
    if (landedCostMoveIds.length > 0) {
        const receiptLotLines = await searchReadAll(
            credentials,
            uid,
            "stock.move.line",
            [
                ["move_id", "in", landedCostMoveIds],
                unifiedLotIdsForProduct ? ["lot_id", "in", unifiedLotIdsForProduct] : ["lot_id", "!=", false],
            ],
            ["move_id", "lot_id"]
        );
        const lotNames = Array.from(
            new Set(receiptLotLines.map((line) => getRelationalName(line.lot_id)).filter(Boolean))
        );
        for (const row of purchases) {
            row.lots = lotNames;
        }
    }

    // ---- Landed costs (Step 1a) ----
    if (landedCostMoveIds.length > 0) {
        const valuationLines = await searchReadAll(
            credentials,
            uid,
            "stock.valuation.adjustment.lines",
            [["move_id", "in", landedCostMoveIds], ["product_id", "=", productId]],
            ["move_id", "cost_id", "additional_landed_cost", "currency_id", "quantity"]
        );
        await ensureCurrencyMultipliers(valuationLines.map((line) => getRelationalId(line.currency_id)));

        const costIds = Array.from(
            new Set(
                valuationLines
                    .map((line) => getRelationalId(line.cost_id))
                    .filter((id): id is number => typeof id === "number" && id > 0)
            )
        );
        const costs = costIds.length
            ? await readInBatches(credentials, uid, "stock.landed.cost", costIds, ["id", "name", "date"])
            : [];
        const costById = new Map(costs.map((cost) => [Number(cost.id ?? 0), cost]));

        for (const line of valuationLines) {
            const costId = getRelationalId(line.cost_id);
            const cost = costId ? costById.get(costId) : undefined;
            const currencyId = getRelationalId(line.currency_id);
            const multiplier = rateFor(currencyId);
            if (multiplier === undefined) {
                continue;
            }
            // Only the share of this receipt that went into the selected lot(s).
            const moveFraction = lotFractions ? lotFractions.byMoveId.get(getRelationalId(line.move_id) ?? 0) ?? 0 : 1;
            if (moveFraction <= 0) {
                continue;
            }
            const amount = Number(line.additional_landed_cost ?? 0) * multiplier * moveFraction;
            const qty = Number(line.quantity ?? 0) * moveFraction;

            landedCosts.push({
                reference: toDisplayString(cost?.name) || `Landed cost #${costId ?? "?"}`,
                date: normalizeOdooDate(cost?.date),
                partnerName: "",
                lots: [],
                quantity: qty,
                unitPrice: qty > 0 ? amount / qty : 0,
                currencyCode: getRelationalName(line.currency_id) || TARGET_CURRENCY_CODE,
                amount,
                note: "Odoo landed-cost allocation",
            });

            // Match this allocation back to the one PO line row it landed
            // against (via the receipt move it was posted on), so that row
            // can show its own "Landed Cost" and "Final Unit Price" instead
            // of only the product-wide total.
            const moveId = getRelationalId(line.move_id);
            const purchaseLineId = moveId ? purchaseLineIdByMoveId.get(moveId) : undefined;
            const purchaseRow = purchaseLineId ? purchaseRowByLineId.get(purchaseLineId) : undefined;
            if (purchaseRow) {
                purchaseRow.landedCostAmount = (purchaseRow.landedCostAmount ?? 0) + amount;
            }
        }

        for (const row of purchaseRowByLineId.values()) {
            const landedCostAmount = row.landedCostAmount ?? 0;
            const perUnitLandedCost = row.quantity > 0 ? landedCostAmount / row.quantity : 0;
            row.finalUnitPrice = row.unitPrice + perUnitLandedCost;
        }
    }

    // ---- Operation costs (Step 1b) ----
    if (orderIdSet.size > 0) {
        const orderIdsForNames = Array.from(orderIdSet);
        const orderNameById = new Map<number, string>();
        const orders = await readInBatches(credentials, uid, "purchase.order", orderIdsForNames, ["id", "name"]);
        for (const order of orders) {
            const orderId = Number(order.id ?? 0);
            const name = toDisplayString(order.name);
            if (orderId > 0 && name) {
                orderNameById.set(orderId, name);
            }
        }
        const orderNameEntries = Array.from(orderNameById.entries()).sort((a, b) => b[1].length - a[1].length);

        function matchOrderIdInLabel(label: string): number | null {
            for (const [orderId, name] of orderNameEntries) {
                const index = label.indexOf(name);
                if (index === -1) {
                    continue;
                }
                const before = index > 0 ? label[index - 1] : "";
                const after = index + name.length < label.length ? label[index + name.length] : "";
                const isAlnum = (ch: string) => /[A-Za-z0-9]/.test(ch);
                if (!isAlnum(before) && !isAlnum(after)) {
                    return orderId;
                }
            }
            return null;
        }

        const journals = await executeKw<Array<{ id: number }>>(
            credentials,
            uid,
            "account.journal",
            "search_read",
            [[["name", "=", MARGIN_ANALYTICS_OPERATION_COST_JOURNAL_NAME]]],
            { fields: ["id"], limit: 100 }
        );
        const journalIds = journals.map((journal) => Number(journal.id)).filter((id) => id > 0);

        const accounts = await executeKw<Array<{ id: number }>>(
            credentials,
            uid,
            "account.account",
            "search_read",
            [[["code", "=", MARGIN_ANALYTICS_LANDED_COST_DIFFERENCES_ACCOUNT_CODE]]],
            { fields: ["id"], limit: 100 }
        );
        const accountIds = accounts.map((account) => Number(account.id)).filter((id) => id > 0);

        if (journalIds.length > 0 && accountIds.length > 0 && orderNameEntries.length > 0) {
            const candidateLines = await searchReadAll(
                credentials,
                uid,
                "account.move.line",
                [
                    ["move_id.journal_id", "in", journalIds],
                    ["move_id.state", "=", "posted"],
                    ["account_id", "in", accountIds],
                ],
                ["move_id", "name", "debit", "credit", "date"]
            );

            const matched = candidateLines
                .map((line) => ({ line, orderId: matchOrderIdInLabel(toDisplayString(line.name)) }))
                .filter((entry) => entry.orderId !== null);

            const moveIds = Array.from(
                new Set(
                    matched
                        .map((entry) => getRelationalId(entry.line.move_id))
                        .filter((id): id is number => typeof id === "number" && id > 0)
                )
            );
            const moves = moveIds.length
                ? await readInBatches(credentials, uid, "account.move", moveIds, ["id", "name", "company_id"])
                : [];
            const moveById = new Map(moves.map((move) => [Number(move.id ?? 0), move]));

            const companyIds = Array.from(
                new Set(
                    moves
                        .map((move) => getRelationalId(move.company_id))
                        .filter((id): id is number => typeof id === "number" && id > 0)
                )
            );
            const currencyIdByCompanyId = new Map<number, number>();
            const currencyCodeById = new Map<number, string>();
            if (companyIds.length > 0) {
                const companies = await readInBatches(credentials, uid, "res.company", companyIds, ["id", "currency_id"]);
                for (const company of companies) {
                    const companyId = Number(company.id ?? 0);
                    const currencyId = getRelationalId(company.currency_id);
                    if (companyId > 0 && currencyId) {
                        currencyIdByCompanyId.set(companyId, currencyId);
                        currencyCodeById.set(currencyId, getRelationalName(company.currency_id) || "?");
                    }
                }
                await ensureCurrencyMultipliers(Array.from(currencyIdByCompanyId.values()));
            }

            // Each correction is a whole-order total; it has to be allocated
            // across that order's lines by value share before this product's
            // portion can be read off. Showing both the raw entry and the
            // allocated share is the whole point of this panel.
            const matchedOrderIds = Array.from(new Set(matched.map((entry) => entry.orderId as number)));
            const orderLineRows = matchedOrderIds.length
                ? await searchReadAll(
                    credentials,
                    uid,
                    "purchase.order.line",
                    [["order_id", "in", matchedOrderIds]],
                    ["order_id", "product_id", "price_subtotal"]
                )
                : [];
            const orderTotalById = new Map<number, number>();
            const productShareById = new Map<number, number>();
            for (const line of orderLineRows) {
                const orderId = getRelationalId(line.order_id);
                if (!orderId) {
                    continue;
                }
                const subtotal = Number(line.price_subtotal ?? 0);
                orderTotalById.set(orderId, (orderTotalById.get(orderId) ?? 0) + subtotal);
                if (getRelationalId(line.product_id) === productId) {
                    // With a Unified Lot, only the share of the line received into it.
                    const lineFraction = lotFractions ? lotFractions.byLineId.get(Number(line.id ?? 0)) ?? 0 : 1;
                    productShareById.set(orderId, (productShareById.get(orderId) ?? 0) + subtotal * lineFraction);
                }
            }

            for (const entry of matched) {
                const orderId = entry.orderId as number;
                const orderTotal = orderTotalById.get(orderId) ?? 0;
                const productValue = productShareById.get(orderId) ?? 0;
                if (orderTotal === 0 || productValue === 0) {
                    continue;
                }

                const moveId = getRelationalId(entry.line.move_id);
                const move = moveId ? moveById.get(moveId) : undefined;
                const companyId = move ? getRelationalId(move.company_id) : null;
                const currencyId = companyId ? currencyIdByCompanyId.get(companyId) ?? null : null;
                const multiplier = rateFor(currencyId);
                if (multiplier === undefined) {
                    continue;
                }

                const net = (Number(entry.line.debit ?? 0) - Number(entry.line.credit ?? 0)) * multiplier;
                const share = productValue / orderTotal;

                operationCosts.push({
                    reference: toDisplayString(move?.name) || orderNameById.get(orderId) || "",
                    date: normalizeOdooDate(entry.line.date),
                    partnerName: orderNameById.get(orderId) ?? "",
                    lots: [],
                    quantity: share * 100,
                    unitPrice: net,
                    currencyCode: currencyId ? currencyCodeById.get(currencyId) || TARGET_CURRENCY_CODE : TARGET_CURRENCY_CODE,
                    amount: net * share,
                    note: toDisplayString(entry.line.name),
                });
            }
        }
    }

    // ---- Unlinked valuation adjustments (Step 1c) ----
    const unlinkedLayers = await fetchUnlinkedValuationLayers(
        credentials,
        uid,
        [productId],
        unifiedLotIdsForProduct,
        startDate,
        endDate
    );
    await ensureCurrencyMultipliers(unlinkedLayers.map((layer) => layer.currencyId));
    for (const layer of unlinkedLayers) {
        const multiplier = rateFor(layer.currencyId);
        if (multiplier === undefined) {
            continue;
        }
        unlinkedAdjustments.push({
            reference: layer.reference || "(no reference)",
            date: layer.date,
            partnerName: "",
            lots: [],
            quantity: 0,
            unitPrice: 0,
            currencyCode: layer.currencyCode,
            amount: layer.value * multiplier,
            note: layer.description || "Valuation adjustment with no source document",
        });
    }

    // ---- Sales (Step 3) ----
    if (dateBasis === "transaction") {
        const invoiceDomain: unknown[] = [
            ["product_id", "=", productId],
            ["display_type", "=", "product"],
            ["move_id.move_type", "=", "out_invoice"],
            ["move_id.state", "=", "posted"],
            ["move_id.invoice_date", ">=", startDate],
            ["move_id.invoice_date", "<=", endDate],
        ];
        if (unifiedLotSaleLineIds) {
            invoiceDomain.push(["sale_line_ids", "in", unifiedLotSaleLineIds]);
        }
        if (excludedSaleOrderIds && excludedSaleOrderIds.length > 0) {
            invoiceDomain.push(["sale_line_ids.order_id", "not in", excludedSaleOrderIds]);
        }
        if (excludeCustomerIds.length > 0) {
            invoiceDomain.push(["partner_id", "not in", excludeCustomerIds]);
        }
        const invoiceLines = await searchReadAll(
            credentials,
            uid,
            "account.move.line",
            invoiceDomain,
            ["move_id", "quantity", "price_subtotal", "currency_id", "date", "partner_id"]
        );
        await ensureCurrencyMultipliers(invoiceLines.map((line) => getRelationalId(line.currency_id)));

        for (const line of invoiceLines) {
            const qty = Number(line.quantity ?? 0);
            const subtotal = Number(line.price_subtotal ?? 0);
            const currencyId = getRelationalId(line.currency_id);
            const multiplier = rateFor(currencyId);
            if (multiplier === undefined) {
                continue;
            }

            sales.push({
                reference: getRelationalName(line.move_id) || "",
                date: normalizeOdooDate(line.date),
                partnerName: getRelationalName(line.partner_id) || "",
                lots: [],
                quantity: qty,
                unitPrice: qty > 0 ? (subtotal / qty) * multiplier : 0,
                currencyCode: getRelationalName(line.currency_id) || TARGET_CURRENCY_CODE,
                amount: subtotal * multiplier,
                note: "Customer invoice line",
            });
        }
    } else {
        const saleDomain: unknown[] = [
            ["product_id", "=", productId],
            ["display_type", "=", false],
            ["order_id.state", "in", ["sale", "done"]],
            ["order_id.date_order", ">=", from],
            ["order_id.date_order", "<=", to],
        ];
        if (unifiedLotSaleLineIds) {
            saleDomain.push(["id", "in", unifiedLotSaleLineIds]);
        }
        if (excludedSaleOrderIds && excludedSaleOrderIds.length > 0) {
            saleDomain.push(["order_id", "not in", excludedSaleOrderIds]);
        }
        if (excludeCustomerIds.length > 0) {
            saleDomain.push(["order_id.partner_id", "not in", excludeCustomerIds]);
        }
        const saleLines = await searchReadAll(
            credentials,
            uid,
            "sale.order.line",
            saleDomain,
            ["id", "product_uom_qty", "price_subtotal", "currency_id", "order_id"]
        );
        await ensureCurrencyMultipliers(saleLines.map((line) => getRelationalId(line.currency_id)));

        const orderIds = Array.from(
            new Set(
                saleLines
                    .map((line) => getRelationalId(line.order_id))
                    .filter((id): id is number => typeof id === "number" && id > 0)
            )
        );
        const orders = orderIds.length
            ? await readInBatches(credentials, uid, "sale.order", orderIds, ["id", "name", "partner_id", "date_order"])
            : [];
        const orderById = new Map(orders.map((order) => [Number(order.id ?? 0), order]));

        // Which lots each of these sale lines actually shipped from — this is
        // what makes a sales row verifiable against Odoo's own delivery record
        // rather than just asserting a number.
        const saleLineIds = saleLines.map((line) => Number(line.id ?? 0)).filter((id) => id > 0);
        const lotNamesBySaleLineId = new Map<number, Set<string>>();
        if (saleLineIds.length > 0) {
            const deliveryMoves = await searchReadAll(
                credentials,
                uid,
                "stock.move",
                [["sale_line_id", "in", saleLineIds], ["state", "=", "done"]],
                ["id", "sale_line_id"]
            );
            const saleLineIdByMoveId = new Map<number, number>();
            for (const move of deliveryMoves) {
                const moveId = Number(move.id ?? 0);
                const saleLineId = getRelationalId(move.sale_line_id);
                if (moveId > 0 && saleLineId) {
                    saleLineIdByMoveId.set(moveId, saleLineId);
                }
            }
            const deliveryMoveIds = Array.from(saleLineIdByMoveId.keys());
            if (deliveryMoveIds.length > 0) {
                const deliveryLines = await searchReadAll(
                    credentials,
                    uid,
                    "stock.move.line",
                    [["move_id", "in", deliveryMoveIds], ["lot_id", "!=", false]],
                    ["move_id", "lot_id"]
                );
                for (const line of deliveryLines) {
                    const moveId = getRelationalId(line.move_id);
                    const saleLineId = moveId ? saleLineIdByMoveId.get(moveId) : undefined;
                    const lotName = getRelationalName(line.lot_id);
                    if (saleLineId && lotName) {
                        const existing = lotNamesBySaleLineId.get(saleLineId);
                        if (existing) {
                            existing.add(lotName);
                        } else {
                            lotNamesBySaleLineId.set(saleLineId, new Set([lotName]));
                        }
                    }
                }
            }
        }

        for (const line of saleLines) {
            const lineId = Number(line.id ?? 0);
            const orderId = getRelationalId(line.order_id);
            const order = orderId ? orderById.get(orderId) : undefined;
            const lineQty = Number(line.product_uom_qty ?? 0);
            const lineSubtotal = Number(line.price_subtotal ?? 0);

            // Take the line's own `price_subtotal` rather than rebuilding it
            // from a per-unit rate: a line can legitimately carry value with
            // zero quantity (free-of-charge, rounding and adjustment lines),
            // and reconstructing `unitPrice * qty` silently drops that value,
            // making this panel disagree with the report total it is meant to
            // justify (verified live: 1 020.60 AED went missing that way).
            let qty = lineQty;
            let subtotal = lineSubtotal;
            let note = "Sale order line";
            if (hasUnifiedLot) {
                const lotQty = unifiedLotQtyBySaleLineId.get(lineId) ?? 0;
                if (lotQty <= 0) {
                    continue;
                }
                qty = Math.min(lotQty, lineQty);
                subtotal = lineQty > 0 ? (lineSubtotal / lineQty) * qty : 0;
                note = qty < lineQty
                    ? `${qty} of ${lineQty} on this line shipped from this lot`
                    : "Whole line shipped from this lot";
            }

            const currencyId = getRelationalId(line.currency_id);
            const multiplier = rateFor(currencyId);
            if (multiplier === undefined) {
                continue;
            }

            sales.push({
                reference: toDisplayString(order?.name) || `SO #${orderId ?? "?"}`,
                date: normalizeOdooDate(order?.date_order),
                partnerName: getRelationalName(order?.partner_id) || "",
                lots: Array.from(lotNamesBySaleLineId.get(lineId) ?? []).sort(),
                quantity: qty,
                unitPrice: (qty > 0 ? subtotal / qty : 0) * multiplier,
                currencyCode: getRelationalName(line.currency_id) || TARGET_CURRENCY_CODE,
                amount: subtotal * multiplier,
                note,
            });
        }
    }

    const sumBy = (rows: MarginAnalyticsBreakdownRow[], key: "quantity" | "amount") =>
        rows.reduce((total, row) => total + row[key], 0);

    return {
        productId,
        productName,
        currencyCode: TARGET_CURRENCY_CODE,
        startDate,
        endDate,
        dateBasis,
        unifiedLotNames,
        purchases: purchases.sort((a, b) => a.date.localeCompare(b.date)),
        landedCosts: landedCosts.sort((a, b) => a.date.localeCompare(b.date)),
        operationCosts: operationCosts.sort((a, b) => a.date.localeCompare(b.date)),
        unlinkedAdjustments: unlinkedAdjustments.sort((a, b) => a.date.localeCompare(b.date)),
        sales: sales.sort((a, b) => a.date.localeCompare(b.date)),
        totals: {
            purchasedQty: sumBy(purchases, "quantity"),
            purchaseValue: sumBy(purchases, "amount"),
            landedCostValue: sumBy(landedCosts, "amount"),
            operationCostValue: sumBy(operationCosts, "amount"),
            unlinkedAdjustmentValue: sumBy(unlinkedAdjustments, "amount"),
            soldQty: sumBy(sales, "quantity"),
            salesValue: sumBy(sales, "amount"),
        },
    };
}

/**
 * Companies the API user has access to (for the sidebar company selector).
 * `res.company` carries its own multi-company record rule, so a plain
 * search_read as this uid already returns only the companies granted to
 * them — no need to cross-check against `res.users.company_ids` separately.
 */
export async function getCompanies(credentials: OdooCredentials): Promise<Array<{ id: number; name: string }>> {
    const uid = await authenticate(credentials);

    const companies = await executeKw<Array<{ id: number; name: string }>>(
        credentials,
        uid,
        "res.company",
        "search_read",
        [[]],
        { fields: ["id", "name"], order: "id asc", limit: 200 }
    );

    return companies.map((company) => ({ id: company.id, name: company.name }));
}

export async function getProductOrigins(credentials: OdooCredentials): Promise<Array<{ id: number; name: string }>> {
    const uid = await authenticate(credentials);

    const grouped = await executeKw<Array<Record<string, unknown>>>(
        credentials,
        uid,
        "product.template",
        "read_group",
        [[["origin", "!=", false]], ["origin"], ["origin"]],
        { lazy: false }
    );

    return grouped
        .map((row) => ({ id: getRelationalId(row.origin) ?? 0, name: getRelationalName(row.origin) }))
        .filter((origin) => origin.id > 0 && origin.name)
        .sort((left, right) => left.name.localeCompare(right.name));
}

export async function getRimDiameters(credentials: OdooCredentials): Promise<Array<{ id: number; name: string }>> {
    const uid = await authenticate(credentials);

    const rimDiameters = await executeKw<Array<{ id: number; name: string }>>(
        credentials,
        uid,
        "tire.rim.diameter",
        "search_read",
        [[]],
        { fields: ["id", "name"], order: "id asc", limit: 500 }
    );

    return rimDiameters
        .map((rimDiameter) => ({ id: Number(rimDiameter.id), name: String(rimDiameter.name ?? "") }))
        .filter((rimDiameter) => rimDiameter.id > 0 && rimDiameter.name);
}

export async function getPurchaseOrderTypes(
    credentials: OdooCredentials
): Promise<{ options: Array<{ value: string; label: string }> }> {
    const uid = await authenticate(credentials);
    const options = await getTypeFieldOptions(credentials, uid, "purchase.order", PURCHASE_TYPE_FIELD_SPEC);
    return { options };
}

export async function getSaleOrderTypes(
    credentials: OdooCredentials
): Promise<{ options: Array<{ value: string; label: string }> }> {
    const uid = await authenticate(credentials);
    const options = await getTypeFieldOptions(credentials, uid, "sale.order", SALE_TYPE_FIELD_SPEC);
    return { options };
}

export async function getUnifiedLots(
    credentials: OdooCredentials,
    input?: { query?: string; limit?: number; offset?: number }
): Promise<{ unifiedLots: Array<{ id: number; name: string }>; totalCount: number }> {
    const uid = await authenticate(credentials);
    const query = (input?.query ?? "").trim();
    const limit = Number.isFinite(input?.limit) ? Math.max(1, Math.min(100, Number(input?.limit))) : 20;
    const offset = Number.isFinite(input?.offset) ? Math.max(0, Number(input?.offset)) : 0;

    const domain: unknown[] = query ? [["name", "ilike", query]] : [];

    const totalCount = await executeKw<number>(credentials, uid, "stock.unified.lot", "search_count", [domain]);

    const unifiedLots = await executeKw<Array<{ id: number; name: string }>>(
        credentials,
        uid,
        "stock.unified.lot",
        "search_read",
        [domain],
        { fields: ["id", "name"], order: "name desc", limit, offset }
    );

    return {
        totalCount,
        unifiedLots: unifiedLots
            .map((lot) => ({ id: Number(lot.id), name: String(lot.name ?? "") }))
            .filter((lot) => lot.id > 0 && lot.name),
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

export type PoTrackingContainer = {
    index: number;
    containerNo: string;
    sealNo: string;
    blNumber: string;
    /** Sum of the product quantities listed under this container's section row. */
    quantity: number;
    /** The section row exactly as typed in Odoo. */
    label: string;
};

export type PoTrackingOrder = {
    id: number;
    name: string;
    vendorName: string;
    vendorRef: string;
    orderDate: string;
    expectedArrival: string;
    currencyCode: string;
    types: string[];
    fullyReceived: boolean;
    /** Total ordered quantity on the PO (the container text doesn't say how it splits). */
    totalQty: number;
    containers: PoTrackingContainer[];
};

// "Container 1:SEKU4329929  Seal No:J2989174  B/L:QGD3507124" — the spacing,
// colons and case vary between entries, so each piece is matched on its own.
function parsePoTrackingSection(label: string): Omit<PoTrackingContainer, "quantity" | "label"> | null {
    const container = /Container\s*(\d+)?\s*[:\-]?\s*([A-Za-z0-9]+)/i.exec(label);
    const bl = /(?:\bB\s*\/\s*L|\bB\.\s*L\.?|\bBL(?![A-Za-z])|\bBill\s+of\s+Lading)\s*(?:No\.?|number|#)?\s*[:\-#]?\s*([A-Za-z0-9\-]+)/i.exec(label);
    if (!container || !bl) {
        return null;
    }
    const seal = /Seal\s*(?:No\.?)?\s*[:\-]?\s*([A-Za-z0-9\-]+)/i.exec(label);
    return {
        index: container[1] ? Number(container[1]) : 0,
        containerNo: container[2].toUpperCase(),
        sealNo: seal ? seal[1].toUpperCase() : "",
        blNumber: bl[1].toUpperCase(),
    };
}

/** Notes is an HTML field: turn it into plain lines of text. */
function htmlToPlainText(value: string) {
    return value
        .replace(/<\s*br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|li|tr)>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&#0?39;|&apos;/gi, "'")
        .replace(/[ \t]+/g, " ");
}

type ParsedTrackingEntry = Omit<PoTrackingContainer, "quantity"> & { quantity: number };

/**
 * Shipment details typed into a PO's Source Document / Notes. Two shapes are
 * understood:
 *   1. "Container 1:SEKU4329929  Seal No:J2989174  B/L:QGD3507124"
 *      (one entry per container, split wherever a new "Container" label starts)
 *   2. "ALAT260803 - B/L:177GATATQ3923V - MEDU4698037 - MEDU8525451 - … - 5 - 1827 - UAE"
 *      (one line per B/L: the B/L, its container numbers, then the container
 *      count and the total units). The units are put on the line's first container.
 */
function parsePoTrackingText(text: string): ParsedTrackingEntry[] {
    const found: ParsedTrackingEntry[] = [];

    for (const chunk of text.split(/(?=Container\s*\d*\s*[:\-])/i)) {
        const label = chunk.replace(/\s+/g, " ").trim();
        const parsed = parsePoTrackingSection(label);
        if (parsed) {
            found.push({ ...parsed, quantity: 0, label });
        }
    }
    if (found.length > 0) {
        return found;
    }

    for (const line of text.split(/\n+/)) {
        const label = line.replace(/\s+/g, " ").trim();
        const segments = label.split(/\s+-\s+/).map((segment) => segment.trim());

        // ISO 6346 container numbers: 4 letters (owner + category) + 6 digits + check digit.
        const containerNos = Array.from(new Set((label.match(/\b[A-Za-z]{4}\d{7}\b/g) ?? []).map((value) => value.toUpperCase())));

        // The B/L is the one labelled "B/L:…"; otherwise it is the line's second part
        // ("REF - BLNUMBER - CONTAINER - … - count - units - country"), which only
        // counts when the line also lists containers so ordinary notes aren't misread.
        const labelled = /(?:\bB\s*\/\s*L|\bB\.\s*L\.?|\bBL(?![A-Za-z])|\bBill\s+of\s+Lading)\s*(?:No\.?|number|#)?\s*[:\-#]?\s*([A-Za-z0-9\-]+)/i.exec(label);
        const second = segments[1] ?? "";
        const secondLooksLikeBl =
            segments.length >= 3 &&
            containerNos.length > 0 &&
            /^[A-Za-z0-9\-]{6,}$/.test(second) &&
            !/^[A-Za-z]{4}\d{7}$/.test(second) &&
            !/^\d{1,5}$/.test(second);
        const blNumber = labelled ? labelled[1].toUpperCase() : secondLooksLikeBl ? second.toUpperCase() : "";
        if (!blNumber) {
            continue;
        }

        // After the last container the line lists the container count, then the units.
        let lastContainerIndex = -1;
        segments.forEach((segment, index) => {
            if (/^[A-Za-z]{4}\d{7}$/.test(segment)) lastContainerIndex = index;
        });
        const numbers = segments
            .slice(lastContainerIndex + 1)
            .filter((segment) => /^[\d,]+$/.test(segment))
            .map((segment) => Number(segment.replace(/,/g, "")));
        const units = numbers.length >= 2 ? numbers[1] : 0;

        if (containerNos.length === 0) {
            found.push({ index: 1, containerNo: "", sealNo: "", blNumber, quantity: units, label });
            continue;
        }
        containerNos.forEach((containerNo, position) => {
            found.push({ index: position + 1, containerNo, sealNo: "", blNumber, quantity: position === 0 ? units : 0, label });
        });
    }
    return found;
}

/**
 * Confirmed purchase orders whose Purchase Type name contains "Import",
 * with the container / seal / B/L read from the section rows on their
 * product lines. By default only orders still awaiting receipt are returned.
 */
export async function getImportedPurchaseOrdersForTracking(
    credentials: OdooCredentials,
    input?: { includeReceived?: boolean }
): Promise<{ orders: PoTrackingOrder[]; importedTypeNames: string[] }> {
    const uid = await authenticate(credentials);
    const includeReceived = Boolean(input?.includeReceived);

    const typeField = await discoverTypeField(credentials, uid, "purchase.order", PURCHASE_TYPE_FIELD_SPEC);
    if (!typeField) {
        throw new Error("Could not find the Purchase Type field on purchase orders.");
    }

    const typeOptions = await getTypeFieldOptions(credentials, uid, "purchase.order", PURCHASE_TYPE_FIELD_SPEC);
    const importedTypes = typeOptions.filter((option) => /import/i.test(option.label));
    if (importedTypes.length === 0) {
        return { orders: [], importedTypeNames: [] };
    }

    const typeValues = typeField.kind === "relational"
        ? importedTypes.map((option) => Number(option.value)).filter((id) => Number.isFinite(id) && id > 0)
        : importedTypes.map((option) => option.value);

    const orderFields = await executeKw<Record<string, unknown>>(
        credentials,
        uid,
        "purchase.order",
        "fields_get",
        [],
        { attributes: ["type"] }
    );
    const hasField = (name: string) => Object.prototype.hasOwnProperty.call(orderFields, name);

    const domain: unknown[] = [
        ["state", "in", ["purchase", "done"]],
        [typeField.fieldName, "in", typeValues],
    ];
    if (!includeReceived && hasField("receipt_status")) {
        domain.push(["receipt_status", "!=", "full"]);
    }

    const readFields = ["name", "partner_id", "partner_ref", "origin", "notes", "date_order", "date_planned", "currency_id", typeField.fieldName]
        .filter((name, index, all) => all.indexOf(name) === index && hasField(name));

    const orders = await executeKw<Array<Record<string, unknown>>>(
        credentials,
        uid,
        "purchase.order",
        "search_read",
        [domain],
        { fields: readFields, order: "date_order desc, id desc", limit: 300 }
    );
    if (orders.length === 0) {
        return { orders: [], importedTypeNames: importedTypes.map((option) => option.label) };
    }

    const orderIds = orders.map((order) => Number(order.id ?? 0)).filter((id) => id > 0);
    const lines = await searchReadAll(
        credentials,
        uid,
        "purchase.order.line",
        [["order_id", "in", orderIds]],
        ["order_id", "display_type", "product_qty", "qty_received"]
    );

    // Container / seal / B/L come from the PO's own Source Document, falling
    // back to its Notes — the product lines are only used for quantities and
    // to tell whether the order has been received.
    const totalQtyByOrderId = new Map<number, number>();
    const fullyReceivedByOrderId = new Map<number, boolean>();

    for (const line of lines) {
        const orderId = getRelationalId(line.order_id);
        if (!orderId || line.display_type) {
            continue;
        }

        const qty = Number(line.product_qty ?? 0);
        totalQtyByOrderId.set(orderId, (totalQtyByOrderId.get(orderId) ?? 0) + qty);
        if (Number(line.qty_received ?? 0) < qty) {
            fullyReceivedByOrderId.set(orderId, false);
        } else if (!fullyReceivedByOrderId.has(orderId)) {
            fullyReceivedByOrderId.set(orderId, true);
        }
    }

    const typeLabelByValue = new Map(importedTypes.map((option) => [option.value, option.label]));
    const result: PoTrackingOrder[] = [];
    for (const order of orders) {
        const id = Number(order.id ?? 0);
        let parsed = parsePoTrackingText(toDisplayString(order.origin));
        if (parsed.length === 0) {
            parsed = parsePoTrackingText(htmlToPlainText(toDisplayString(order.notes)));
        }
        // A container listed twice (same number) is one container.
        const seen = new Set<string>();
        const containers: PoTrackingContainer[] = parsed.filter((entry) => {
            const key = `${entry.blNumber}|${entry.containerNo}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
        // Units written in the text win over the PO's own line total.
        const declaredUnits = containers.reduce((sum, container) => sum + container.quantity, 0);
        const fullyReceived = fullyReceivedByOrderId.get(id) ?? false;
        // Without the receipt_status field, awaiting-receipt is judged from the lines.
        if (!includeReceived && fullyReceived) {
            continue;
        }

        const rawTypes = order[typeField.fieldName];
        const typeKeys = Array.isArray(rawTypes) && typeField.kind === "relational" && typeof rawTypes[0] === "number"
            ? (rawTypes as number[]).map(String)
            : typeof rawTypes === "string" ? [rawTypes] : [];
        const types = typeKeys.map((key) => typeLabelByValue.get(key)).filter((label): label is string => Boolean(label));

        result.push({
            id,
            name: toDisplayString(order.name),
            vendorName: getRelationalName(order.partner_id),
            vendorRef: toDisplayString(order.partner_ref),
            orderDate: normalizeOdooDate(order.date_order),
            expectedArrival: normalizeOdooDate(order.date_planned),
            currencyCode: getRelationalName(order.currency_id),
            types,
            fullyReceived,
            totalQty: Number((declaredUnits > 0 ? declaredUnits : totalQtyByOrderId.get(id) ?? 0).toFixed(2)),
            containers,
        });
    }

    return { orders: result, importedTypeNames: importedTypes.map((option) => option.label) };
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
    parsed: Array<{ blNumber: string; containerNo: string; units: number; from: "Source Document" | "Notes" }>;
    /** Plain-language reasons the order would be missing from the list (empty = it is listed). */
    reasons: string[];
};

/** Explains why one purchase order is — or isn't — in the PO Tracking list. */
export async function diagnosePoTracking(credentials: OdooCredentials, poName: string): Promise<PoTrackingDiagnosis> {
    const uid = await authenticate(credentials);
    const name = poName.trim();
    const empty: PoTrackingDiagnosis = {
        found: false, name, state: "", types: [], isImportedType: false, receiptStatus: "", fullyReceivedByLines: false,
        sourceDocument: "", notesPreview: "", parsed: [], reasons: [],
    };
    if (!name) {
        return { ...empty, reasons: ["Enter a PO number, e.g. P11789."] };
    }

    const typeField = await discoverTypeField(credentials, uid, "purchase.order", PURCHASE_TYPE_FIELD_SPEC);
    const typeOptions = typeField ? await getTypeFieldOptions(credentials, uid, "purchase.order", PURCHASE_TYPE_FIELD_SPEC) : [];

    const orderFields = await executeKw<Record<string, unknown>>(credentials, uid, "purchase.order", "fields_get", [], { attributes: ["type"] });
    const hasField = (field: string) => Object.prototype.hasOwnProperty.call(orderFields, field);
    const fields = ["name", "state", "origin", "notes", "receipt_status", typeField?.fieldName ?? ""].filter((field) => field && hasField(field));

    let orders = await executeKw<Array<Record<string, unknown>>>(credentials, uid, "purchase.order", "search_read", [[["name", "=", name]]], { fields, limit: 1 });
    if (orders.length === 0) {
        orders = await executeKw<Array<Record<string, unknown>>>(credentials, uid, "purchase.order", "search_read", [[["name", "ilike", name]]], { fields, limit: 1 });
    }
    const order = orders[0];
    if (!order) {
        return { ...empty, reasons: [`No purchase order named "${name}" was found (or you don't have access to its company — check the company selector).`] };
    }

    const state = toDisplayString(order.state);
    const origin = toDisplayString(order.origin);
    const notes = htmlToPlainText(toDisplayString(order.notes)).trim();

    let typeKeys: string[] = [];
    if (typeField) {
        const raw = order[typeField.fieldName];
        typeKeys = Array.isArray(raw) && typeof raw[0] === "number" ? (raw as number[]).map(String) : typeof raw === "string" && raw ? [raw] : [];
        // A Many2one comes back as [id, name].
        if (Array.isArray(raw) && typeof raw[0] === "number" && typeof raw[1] === "string") typeKeys = [String(raw[0])];
    }
    const labelByValue = new Map(typeOptions.map((option) => [option.value, option.label]));
    const types = typeKeys.map((key) => labelByValue.get(key) ?? key);
    const isImportedType = types.some((label) => /import/i.test(label));

    const fromSource = parsePoTrackingText(origin).map((entry) => ({ ...entry, from: "Source Document" as const }));
    const parsed = fromSource.length > 0 ? fromSource : parsePoTrackingText(notes).map((entry) => ({ ...entry, from: "Notes" as const }));

    const lines = await searchReadAll(credentials, uid, "purchase.order.line", [["order_id", "=", Number(order.id)]], ["display_type", "product_qty", "qty_received"]);
    const productLines = lines.filter((line) => !line.display_type);
    const fullyReceivedByLines = productLines.length > 0 && productLines.every((line) => Number(line.qty_received ?? 0) >= Number(line.product_qty ?? 0));
    const receiptStatus = toDisplayString(order.receipt_status);

    const reasons: string[] = [];
    if (state !== "purchase" && state !== "done") reasons.push(`The order is "${state || "unknown"}" — only confirmed (Purchase Order / Locked) orders are listed.`);
    if (!typeField) reasons.push("The Purchase Type field couldn't be found on purchase orders.");
    else if (!isImportedType) reasons.push(`Its Purchase Type is ${types.length ? `"${types.join('", "')}"` : "empty"} — none contains the word "Import".`);
    if (receiptStatus === "full" || fullyReceivedByLines) reasons.push('It is fully received, so it is hidden unless "Include fully received" is ticked.');
    if (parsed.length === 0) reasons.push("No B/L was found in its Source Document or Notes (looking for text like \"B/L:XXXX\").");

    return {
        found: true,
        name: toDisplayString(order.name),
        state,
        types,
        isImportedType,
        receiptStatus,
        fullyReceivedByLines,
        sourceDocument: origin,
        notesPreview: notes.slice(0, 400),
        parsed: parsed.map((entry) => ({ blNumber: entry.blNumber, containerNo: entry.containerNo, units: entry.quantity, from: entry.from })),
        reasons,
    };
}

/** "YYYY-MM" of an Odoo UTC datetime, as seen in the user's own timezone. */
function localMonthKey(odooDatetime: string, timeZone: string): string {
    const date = new Date(`${odooDatetime.replace(" ", "T")}${odooDatetime.length > 10 ? "Z" : "T00:00:00Z"}`);
    if (Number.isNaN(date.getTime())) {
        return odooDatetime.slice(0, 7);
    }
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).formatToParts(date);
    const year = parts.find((part) => part.type === "year")?.value ?? "";
    const month = parts.find((part) => part.type === "month")?.value ?? "";
    return `${year}-${month}`;
}

/**
 * One customer's activity over a date range — the single-customer counterpart of
 * the Salesperson Activity report: confirmed orders and sales (month by month
 * against the Customer Monthly Target), open quotations, plus the
 * customer's top brands and categories.
 */
export async function getCustomerActivityReport(
    credentials: OdooCredentials,
    input: { customerId: number; startDate: string; endDate: string }
): Promise<OdooCustomerActivityReport> {
    const uid = await authenticate(credentials);
    const customerId = Number(input.customerId);
    if (!Number.isFinite(customerId) || customerId <= 0) {
        throw new Error("A valid customer is required.");
    }
    const { startDate, endDate } = input;
    ensureDateRange(startDate, endDate);

    const timeZone = await getUserTimezone(credentials, uid);
    const rangeStart = toOdooDateBoundary(startDate, false, timeZone);
    const rangeEnd = toOdooDateBoundary(endDate, true, timeZone);
    const monthlyTargetField = await getCustomerMonthlyTargetField(credentials, uid);

    const commercial = await getCommercialPartner(credentials, uid, customerId);
    const commercialPartnerId = Number(commercial.id ?? 0);
    const canonical = await getCanonicalCustomerMap(
        credentials,
        uid,
        [commercialPartnerId],
        monthlyTargetField ? [monthlyTargetField] : []
    );
    const customerRecord = canonical.get(commercialPartnerId) ?? commercial;
    const customer = toCustomerSummary(customerRecord, getRelationalName(customerRecord.user_id));
    const customerMonthlyTarget = monthlyTargetField ? Number(customerRecord[monthlyTargetField] ?? 0) || 0 : 0;

    const [orders, quotations, brandReport] = await Promise.all([
        searchReadAll(
            credentials,
            uid,
            "sale.order",
            [
                ["partner_id", "child_of", commercialPartnerId],
                ["state", "in", ["sale", "done"]],
                ["date_order", ">=", rangeStart],
                ["date_order", "<=", rangeEnd],
            ],
            ["id", "name", "amount_total", "date_order", "user_id", "state"]
        ),
        searchReadAll(
            credentials,
            uid,
            "sale.order",
            [
                ["partner_id", "child_of", commercialPartnerId],
                ["state", "in", ["draft", "sent"]],
            ],
            ["id", "name", "amount_total", "date_order", "user_id", "state"]
        ),
        getCustomerReport(credentials, customerId),
    ]);

    const toOrder = (order: Record<string, unknown>) => ({
        id: Number(order.id ?? 0),
        name: toDisplayString(order.name),
        date: normalizeOdooDate(order.date_order),
        amount: Number(Number(order.amount_total ?? 0).toFixed(2)),
        state: toDisplayString(order.state),
        salespersonName: getRelationalName(order.user_id) || "-",
        deliveredRevenue: 0,
        grossProfit: 0,
    });
    const orderRows = orders.map(toOrder).sort((a, b) => b.date.localeCompare(a.date));
    const quotationRows = quotations.map(toOrder).sort((a, b) => b.date.localeCompare(a.date));

    // ---- Gross profit -------------------------------------------------------
    // Measured on what has actually been delivered: each line's revenue (ex VAT)
    // scaled by delivered/ordered quantity, against the cost Odoo booked on the
    // delivery (its stock valuation entries — deliveries negative, returns
    // positive). An undelivered order therefore doesn't read as 100% profit.
    const saleLines = orderRows.length > 0
        ? await searchReadAll(
            credentials,
            uid,
            "sale.order.line",
            [
                ["order_id", "in", orderRows.map((order) => order.id)],
                ["display_type", "=", false],
                ["product_id", "!=", false],
            ],
            ["order_id", "price_subtotal", "product_uom_qty", "qty_delivered", "currency_id"]
        )
        : [];
    const saleLineIds = saleLines.map((line) => Number(line.id));
    const costLayers = saleLineIds.length > 0
        ? await searchReadAll(credentials, uid, "stock.valuation.layer", [["stock_move_id.sale_line_id", "in", saleLineIds]], ["stock_move_id", "value", "currency_id"])
        : [];
    const layerMoveIds = Array.from(new Set(costLayers.map((layer) => getRelationalId(layer.stock_move_id)).filter((id): id is number => !!id)));
    const layerMoves = layerMoveIds.length > 0 ? await readInBatches(credentials, uid, "stock.move", layerMoveIds, ["id", "sale_line_id"]) : [];
    const saleLineIdByMoveId = new Map(layerMoves.map((move) => [Number(move.id), getRelationalId(move.sale_line_id)]));

    const gpCurrencyIds = new Set<number>();
    for (const record of [...saleLines, ...costLayers]) {
        const currencyId = getRelationalId(record.currency_id);
        if (currencyId) gpCurrencyIds.add(currencyId);
    }
    const gpPrimaryCurrencyId = await getPrimaryCurrencyId(credentials, uid, Array.from(gpCurrencyIds).map((currencyId) => ({ currencyId })));
    const gpHomeCompanyId = await getHomeCompanyId(credentials, uid);
    const gpOtherCurrencyIds = Array.from(gpCurrencyIds).filter((id) => id !== gpPrimaryCurrencyId);
    const gpRates = gpHomeCompanyId && gpOtherCurrencyIds.length > 0
        ? await getCurrencyRatesToHomeCurrency(credentials, uid, gpHomeCompanyId, gpOtherCurrencyIds, endDate)
        : new Map<number, number>();
    const gpMultipliers = buildCurrencyMultipliers(gpPrimaryCurrencyId, gpRates);
    const toHomeAmount = (amount: number, currencyId: number | null) => {
        if (!currencyId) return amount;
        const multiplier = gpMultipliers.get(currencyId);
        return typeof multiplier === "number" ? amount * multiplier : amount;
    };

    const costByLineId = new Map<number, number>();
    for (const layer of costLayers) {
        const lineId = saleLineIdByMoveId.get(getRelationalId(layer.stock_move_id) ?? -1);
        if (!lineId) continue;
        const cost = -toHomeAmount(Number(layer.value ?? 0), getRelationalId(layer.currency_id));
        costByLineId.set(lineId, (costByLineId.get(lineId) ?? 0) + cost);
    }

    const gpByOrderId = new Map<number, { revenue: number; delivered: number; cost: number }>();
    let linesWithoutCost = 0;
    for (const line of saleLines) {
        const orderId = getRelationalId(line.order_id);
        if (!orderId) continue;
        const ordered = Number(line.product_uom_qty ?? 0);
        const deliveredQty = Math.min(Math.max(Number(line.qty_delivered ?? 0), 0), ordered);
        const revenue = toHomeAmount(Number(line.price_subtotal ?? 0), getRelationalId(line.currency_id));
        const delivered = ordered > 0 ? revenue * (deliveredQty / ordered) : 0;
        const cost = costByLineId.get(Number(line.id)) ?? 0;
        if (deliveredQty > 0 && !costByLineId.has(Number(line.id))) linesWithoutCost += 1;

        const entry = gpByOrderId.get(orderId) ?? { revenue: 0, delivered: 0, cost: 0 };
        entry.revenue += revenue;
        entry.delivered += delivered;
        entry.cost += cost;
        gpByOrderId.set(orderId, entry);
    }
    for (const order of orderRows) {
        const entry = gpByOrderId.get(order.id);
        order.deliveredRevenue = Number((entry?.delivered ?? 0).toFixed(2));
        order.grossProfit = Number(((entry?.delivered ?? 0) - (entry?.cost ?? 0)).toFixed(2));
    }
    const netSales = Number(Array.from(gpByOrderId.values()).reduce((sum, entry) => sum + entry.revenue, 0).toFixed(2));
    const deliveredRevenue = Number(orderRows.reduce((sum, order) => sum + order.deliveredRevenue, 0).toFixed(2));
    const grossProfit = Number(orderRows.reduce((sum, order) => sum + order.grossProfit, 0).toFixed(2));

    // One row per calendar month the range touches, each measured against the full monthly target.
    const monthKeys: string[] = [];
    {
        const [startYear, startMonth] = startDate.split("-").map(Number);
        const [endYear, endMonth] = endDate.split("-").map(Number);
        for (let index = startYear * 12 + startMonth - 1; index <= endYear * 12 + endMonth - 1; index += 1) {
            monthKeys.push(`${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`);
        }
    }
    const monthRows = monthKeys.map((month) => {
        const inMonth = orderRows.filter((order) => localMonthKey(order.date, timeZone) === month);
        const [year, monthNumber] = month.split("-").map(Number);
        return {
            month,
            label: new Date(Date.UTC(year, monthNumber - 1, 1)).toLocaleString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }),
            orderCount: inMonth.length,
            sales: Number(inMonth.reduce((sum, order) => sum + order.amount, 0).toFixed(2)),
            target: customerMonthlyTarget,
            deliveredRevenue: Number(inMonth.reduce((sum, order) => sum + order.deliveredRevenue, 0).toFixed(2)),
            grossProfit: Number(inMonth.reduce((sum, order) => sum + order.grossProfit, 0).toFixed(2)),
        };
    });

    const totalSales = Number(orderRows.reduce((sum, order) => sum + order.amount, 0).toFixed(2));
    const targetTotal = Number((customerMonthlyTarget * monthKeys.length).toFixed(2));

    return {
        customer,
        startDate,
        endDate,
        customerMonthlyTarget,
        totals: {
            orderCount: orderRows.length,
            totalSales,
            averageOrderValue: orderRows.length > 0 ? Number((totalSales / orderRows.length).toFixed(2)) : 0,
            lastSaleDate: orderRows[0]?.date ?? "",
            openQuotationCount: quotationRows.length,
            openQuotationValue: Number(quotationRows.reduce((sum, order) => sum + order.amount, 0).toFixed(2)),
            targetMonths: monthKeys.length,
            targetTotal,
            targetPercent: targetTotal > 0 ? Number(((totalSales / targetTotal) * 100).toFixed(1)) : null,
            lifetimeSales: brandReport.totalSales,
            netSales,
            deliveredRevenue,
            costOfGoods: Number((deliveredRevenue - grossProfit).toFixed(2)),
            grossProfit,
            gpPercent: deliveredRevenue > 0 ? Number(((grossProfit / deliveredRevenue) * 100).toFixed(1)) : null,
            linesWithoutCost,
        },
        months: monthRows,
        orders: orderRows,
        openQuotations: quotationRows,
        topBrands: brandReport.topBrands,
        topCategories: brandReport.topCategories,
        brandTree: brandReport.brandTree,
    };
}
