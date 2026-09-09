import { AsyncLocalStorage } from "node:async_hooks";
import {
    OdooCredentials,
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

    const timeZone = await getUserTimezone(credentials, uid);
    const from = toOdooDateBoundary(startDate, false, timeZone);
    const to = toOdooDateBoundary(endDate, true, timeZone);

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
    avgOperationCostPerUnit: number;
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
        rimDiameterId?: number | null;
        unifiedLotId?: number | null;
        productId?: number | null;
        startDate: string;
        endDate: string;
        /**
         * "order" (default): scope everything by the purchase/sales order's
         * own Order Date — a PO or SO counts toward whichever period it was
         * placed in, regardless of when goods actually moved or got
         * invoiced.
         * "transaction": scope purchases by the date each receipt was
         * actually validated (stock.move's own date — "Scheduled date until
         * move is done, then date of actual move processing") and sales by
         * the customer invoice's own Invoice Date, instead of the order
         * date — a PO raised in January but received in March counts
         * toward March; an SO confirmed in January but invoiced in March
         * counts toward March.
         */
        dateBasis?: "order" | "transaction" | null;
    }
): Promise<MarginAnalyticsReport> {
    const uid = await authenticate(credentials);
    const dateBasis = input.dateBasis === "transaction" ? "transaction" : "order";

    const categoryId = Number(input.categoryId);
    const hasCategory = Number.isFinite(categoryId) && categoryId > 0;
    const brandId = Number(input.brandId);
    const hasBrand = Number.isFinite(brandId) && brandId > 0;
    const originId = Number(input.originId);
    const hasOrigin = Number.isFinite(originId) && originId > 0;
    const rimDiameterId = Number(input.rimDiameterId);
    const hasRimDiameter = Number.isFinite(rimDiameterId) && rimDiameterId > 0;
    const unifiedLotId = Number(input.unifiedLotId);
    const hasUnifiedLot = Number.isFinite(unifiedLotId) && unifiedLotId > 0;
    const productId = Number(input.productId);
    const hasProduct = Number.isFinite(productId) && productId > 0;

    if (!hasCategory && !hasBrand && !hasOrigin && !hasRimDiameter && !hasUnifiedLot && !hasProduct) {
        throw new Error("Select at least one filter: category, brand, origin, rim diameter, unified lot, or product.");
    }

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
        templateDomain.push(["rim_diameter", "=", rimDiameterId]);
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
            [["unified_lot_id", "=", unifiedLotId]],
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
    // The stock moves landed cost gets pulled from in Step 1a — sourced
    // differently per `dateBasis` below (either every done move tied to an
    // in-range PO, or specifically the moves whose own validation date fell
    // in range).
    let landedCostMoveIds: number[] = [];

    // When a Unified Lot filter is active, every purchase-side query below
    // is additionally pinned to just that shipment's own purchase order(s)
    // (`unifiedLotOrderIds`, resolved above) instead of the matched
    // product's entire purchase history.
    const unifiedLotOrderIdsArray = unifiedLotOrderIds ? Array.from(unifiedLotOrderIds) : null;

    if (dateBasis === "transaction") {
        // Step 1 (transaction basis): purchase price scoped by the actual
        // goods-receipt date — `stock.move.date`, which Odoo docs as
        // "Scheduled date until move is done, then date of actual move
        // processing" (verified live: reflects the real receiving
        // timestamp, not the PO's order date). A PO raised in January but
        // only received in March counts toward March here.
        const receiptMoveDomain: unknown[] = [
            ["product_id", "in", finalProductIds],
            ["state", "=", "done"],
            ["purchase_line_id", "!=", false],
            ["date", ">=", from],
            ["date", "<=", to],
        ];
        if (unifiedLotOrderIdsArray) {
            receiptMoveDomain.push(["purchase_line_id.order_id", "in", unifiedLotOrderIdsArray]);
        }
        const receiptMoves = await executeKw<Array<Record<string, unknown>>>(
            credentials,
            uid,
            "stock.move",
            "search_read",
            [receiptMoveDomain],
            { fields: ["id", "product_id", "product_qty", "purchase_line_id"], limit: 50000 }
        );

        landedCostMoveIds = receiptMoves.map((move) => Number(move.id ?? 0)).filter((id) => id > 0);

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
                { fields: ["id", "product_qty", "price_subtotal", "currency_id", "order_id"] }
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

            const orderId = getRelationalId(lineInfo.order_id);
            if (orderId) {
                orderIdSet.add(orderId);
            }

            // The move only tells us the quantity actually received on this
            // date; the per-unit price comes from the PO line's own average
            // (price_subtotal / product_qty, so line-level discounts are
            // respected the same way the order-basis mode already handles
            // them).
            const lineQty = Number(lineInfo.product_qty ?? 0);
            const lineSubtotal = Number(lineInfo.price_subtotal ?? 0);
            const unitPrice = lineQty > 0 ? lineSubtotal / lineQty : 0;
            const moveQty = Number(move.product_qty ?? 0);
            purchasedQtyByProductId.set(id, (purchasedQtyByProductId.get(id) ?? 0) + moveQty);

            const currencyId = getRelationalId(lineInfo.currency_id);
            const currencyCode = getRelationalName(lineInfo.currency_id) || "?";
            recordSourceCurrency(id, currencyId, currencyCode);
            const multiplier = currencyId ? multiplierByCurrencyId.get(currencyId) : undefined;
            if (multiplier === undefined) {
                if (currencyId) {
                    unconvertedCurrencyCodes.add(currencyCode);
                }
                continue;
            }

            const value = unitPrice * moveQty * multiplier;
            purchaseValueByProductId.set(id, (purchaseValueByProductId.get(id) ?? 0) + value);
        }
    } else {
        // Step 1 (order basis, default): purchase order lines for matched
        // products in range — the base purchase price. Currency-converted
        // the same way as products performance, since a PO raised in USD
        // must not be blended unconverted with one raised in AED.
        const purchaseLineDomain: unknown[] = [
            ["product_id", "in", finalProductIds],
            ["order_id.state", "in", ["purchase", "done"]],
            ["order_id.date_order", ">=", from],
            ["order_id.date_order", "<=", to],
        ];
        if (unifiedLotOrderIdsArray) {
            purchaseLineDomain.push(["order_id", "in", unifiedLotOrderIdsArray]);
        }
        const purchaseLines = await executeKw<Array<Record<string, unknown>>>(
            credentials,
            uid,
            "purchase.order.line",
            "search_read",
            [purchaseLineDomain],
            {
                fields: ["id", "product_id", "product_qty", "price_subtotal", "currency_id", "order_id"],
                limit: 50000,
            }
        );

        await ensureCurrencyMultipliers(purchaseLines.map((line) => getRelationalId(line.currency_id)));

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

            const qty = Number(line.product_qty ?? 0);
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

            const value = Number(line.price_subtotal ?? 0) * multiplier;
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
            { fields: ["product_id", "additional_landed_cost", "currency_id"], limit: 50000 }
        );

        await ensureCurrencyMultipliers(valuationLines.map((line) => getRelationalId(line.currency_id)));

        for (const line of valuationLines) {
            const id = getRelationalId(line.product_id);
            if (!id) {
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

            const amount = Number(line.additional_landed_cost ?? 0) * multiplier;
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

                    const share = Number(line.price_subtotal ?? 0) / orderTotal;
                    const allocated = orderCorrection * share;
                    operationCostByProductId.set(productId, (operationCostByProductId.get(productId) ?? 0) + allocated);
                }
            }
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
        { fields: ["product_id", "quantity"], limit: 50000 }
    );

    const currentStockByProductId = new Map<number, number>();
    for (const quant of quants) {
        const id = getRelationalId(quant.product_id);
        if (!id) {
            continue;
        }

        const quantity = Number(quant.quantity ?? 0);
        currentStockByProductId.set(id, (currentStockByProductId.get(id) ?? 0) + quantity);
    }

    // Step 2 & 4: per-product averages, then report-level highlights.
    const rows: MarginAnalyticsProductRow[] = finalProductIds
        .map((id) => {
            const info = productInfoById.get(id);
            const purchasedQty = Number((purchasedQtyByProductId.get(id) ?? 0).toFixed(2));
            const purchaseValue = purchaseValueByProductId.get(id) ?? 0;
            const landedCostValue = landedCostByProductId.get(id) ?? 0;
            const operationCostValue = operationCostByProductId.get(id) ?? 0;

            const avgPurchasePrice = purchasedQty > 0 ? purchaseValue / purchasedQty : 0;
            const avgLandedCostPerUnit = purchasedQty > 0 ? landedCostValue / purchasedQty : 0;
            const avgOperationCostPerUnit = purchasedQty > 0 ? operationCostValue / purchasedQty : 0;
            // Operation cost is already signed (positive = debit = increases
            // cost, negative = credit = decreases cost), so combining it
            // with landed cost is a plain sum either way.
            const avgFinalLandedCostPerUnit = avgLandedCostPerUnit + avgOperationCostPerUnit;
            const avgTotalCostPerUnit = avgPurchasePrice + avgLandedCostPerUnit + avgOperationCostPerUnit;

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
            if (avgOperationCostPerUnit !== 0) {
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
                avgOperationCostPerUnit: Number(avgOperationCostPerUnit.toFixed(2)),
                avgFinalLandedCostPerUnit: Number(avgFinalLandedCostPerUnit.toFixed(2)),
                avgTotalCostPerUnit: Number(avgTotalCostPerUnit.toFixed(2)),
                soldQty,
                avgSalesPrice: Number(avgSalesPrice.toFixed(2)),
                hasSalesData,
                avgMarginPerUnit: Number(avgMarginPerUnit.toFixed(2)),
                marginPercent: Number(marginPercent.toFixed(2)),
                estimatedProfitLoss: Number(estimatedProfitLoss.toFixed(2)),
                currentStock: Number((currentStockByProductId.get(id) ?? 0).toFixed(2)),
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
    const totalSoldQty = rows.reduce((sum, row) => sum + row.soldQty, 0);
    const totalSalesValue = rowsWithSalesData.reduce((sum, row) => sum + row.avgSalesPrice * row.soldQty, 0);
    const totalEstimatedProfitLoss = rows.reduce((sum, row) => sum + row.estimatedProfitLoss, 0);
    const totalCurrentStock = rows.reduce((sum, row) => sum + row.currentStock, 0);

    return {
        startDate,
        endDate,
        currencyCode: TARGET_CURRENCY_CODE,
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
            avgFinalLandedCostPerUnit: totalPurchasedQty > 0
                ? Number(((totalLandedCostValue + totalOperationCostValue) / totalPurchasedQty).toFixed(2))
                : 0,
            avgTotalCostPerUnit: totalPurchasedQty > 0
                ? Number(
                    ((totalPurchaseValue + totalLandedCostValue + totalOperationCostValue) / totalPurchasedQty).toFixed(2)
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
};

export type MarginAnalyticsBreakdown = {
    productId: number;
    productName: string;
    currencyCode: string;
    startDate: string;
    endDate: string;
    dateBasis: "order" | "transaction";
    unifiedLotName: string | null;
    purchases: MarginAnalyticsBreakdownRow[];
    landedCosts: MarginAnalyticsBreakdownRow[];
    operationCosts: MarginAnalyticsBreakdownRow[];
    sales: MarginAnalyticsBreakdownRow[];
    totals: {
        purchasedQty: number;
        purchaseValue: number;
        landedCostValue: number;
        operationCostValue: number;
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
        unifiedLotId?: number | null;
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

    const unifiedLotId = Number(input.unifiedLotId);
    const hasUnifiedLot = Number.isFinite(unifiedLotId) && unifiedLotId > 0;

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
    let unifiedLotName: string | null = null;
    let unifiedLotOrderIds: number[] | null = null;
    let unifiedLotSaleLineIds: number[] | null = null;
    const unifiedLotQtyBySaleLineId = new Map<number, number>();

    if (hasUnifiedLot) {
        const unifiedLots = await executeKw<Array<Record<string, unknown>>>(
            credentials,
            uid,
            "stock.unified.lot",
            "read",
            [[unifiedLotId]],
            { fields: ["id", "name"] }
        );
        unifiedLotName = toDisplayString(unifiedLots[0]?.name) || null;

        const lots = await searchReadAll(
            credentials,
            uid,
            "stock.lot",
            [["unified_lot_id", "=", unifiedLotId], ["product_id", "=", productId]],
            ["id"]
        );
        const lotIds = lots.map((lot) => Number(lot.id ?? 0)).filter((id) => id > 0);

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
    const sales: MarginAnalyticsBreakdownRow[] = [];

    // ---- Purchases (mirrors Step 1 of the report) ----
    const orderIdSet = new Set<number>();
    let landedCostMoveIds: number[] = [];

    if (dateBasis === "transaction") {
        const receiptDomain: unknown[] = [
            ["product_id", "=", productId],
            ["state", "=", "done"],
            ["purchase_line_id", "!=", false],
            ["date", ">=", from],
            ["date", "<=", to],
        ];
        if (unifiedLotOrderIds) {
            receiptDomain.push(["purchase_line_id.order_id", "in", unifiedLotOrderIds]);
        }
        const receiptMoves = await searchReadAll(
            credentials,
            uid,
            "stock.move",
            receiptDomain,
            ["id", "product_qty", "purchase_line_id", "date"]
        );
        landedCostMoveIds = receiptMoves.map((move) => Number(move.id ?? 0)).filter((id) => id > 0);

        const lineIds = Array.from(
            new Set(
                receiptMoves
                    .map((move) => getRelationalId(move.purchase_line_id))
                    .filter((id): id is number => typeof id === "number" && id > 0)
            )
        );
        const poLines = lineIds.length
            ? await readInBatches(credentials, uid, "purchase.order.line", lineIds, [
                "id",
                "product_qty",
                "price_subtotal",
                "currency_id",
                "order_id",
            ])
            : [];
        const poLineById = new Map(poLines.map((line) => [Number(line.id ?? 0), line]));
        await ensureCurrencyMultipliers(poLines.map((line) => getRelationalId(line.currency_id)));

        const orderIds = Array.from(
            new Set(
                poLines
                    .map((line) => getRelationalId(line.order_id))
                    .filter((id): id is number => typeof id === "number" && id > 0)
            )
        );
        const orders = orderIds.length
            ? await readInBatches(credentials, uid, "purchase.order", orderIds, ["id", "name", "partner_id"])
            : [];
        const orderById = new Map(orders.map((order) => [Number(order.id ?? 0), order]));

        for (const move of receiptMoves) {
            const lineId = getRelationalId(move.purchase_line_id);
            const line = lineId ? poLineById.get(lineId) : undefined;
            if (!line) {
                continue;
            }
            const orderId = getRelationalId(line.order_id);
            if (orderId) {
                orderIdSet.add(orderId);
            }
            const order = orderId ? orderById.get(orderId) : undefined;
            const lineQty = Number(line.product_qty ?? 0);
            const unitPrice = lineQty > 0 ? Number(line.price_subtotal ?? 0) / lineQty : 0;
            const moveQty = Number(move.product_qty ?? 0);
            const currencyId = getRelationalId(line.currency_id);
            const multiplier = rateFor(currencyId);
            if (multiplier === undefined) {
                continue;
            }

            purchases.push({
                reference: toDisplayString(order?.name) || `PO #${orderId ?? "?"}`,
                date: normalizeOdooDate(move.date),
                partnerName: getRelationalName(order?.partner_id) || "",
                lots: [],
                quantity: moveQty,
                unitPrice: unitPrice * multiplier,
                currencyCode: getRelationalName(line.currency_id) || TARGET_CURRENCY_CODE,
                amount: unitPrice * moveQty * multiplier,
                note: "Goods receipt",
            });
        }
    } else {
        const purchaseDomain: unknown[] = [
            ["product_id", "=", productId],
            ["order_id.state", "in", ["purchase", "done"]],
            ["order_id.date_order", ">=", from],
            ["order_id.date_order", "<=", to],
        ];
        if (unifiedLotOrderIds) {
            purchaseDomain.push(["order_id", "in", unifiedLotOrderIds]);
        }
        const poLines = await searchReadAll(
            credentials,
            uid,
            "purchase.order.line",
            purchaseDomain,
            ["id", "product_qty", "price_subtotal", "currency_id", "order_id"]
        );
        await ensureCurrencyMultipliers(poLines.map((line) => getRelationalId(line.currency_id)));

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
            const qty = Number(line.product_qty ?? 0);
            const subtotal = Number(line.price_subtotal ?? 0);
            const currencyId = getRelationalId(line.currency_id);
            const multiplier = rateFor(currencyId);
            if (multiplier === undefined) {
                continue;
            }

            purchases.push({
                reference: toDisplayString(order?.name) || `PO #${orderId ?? "?"}`,
                date: normalizeOdooDate(order?.date_order),
                partnerName: getRelationalName(order?.partner_id) || "",
                lots: [],
                quantity: qty,
                unitPrice: qty > 0 ? (subtotal / qty) * multiplier : 0,
                currencyCode: getRelationalName(line.currency_id) || TARGET_CURRENCY_CODE,
                amount: subtotal * multiplier,
                note: "Purchase order line",
            });
        }

        if (poLineIds.length > 0) {
            const moves = await searchReadAll(
                credentials,
                uid,
                "stock.move",
                [["purchase_line_id", "in", poLineIds], ["state", "=", "done"]],
                ["id"]
            );
            landedCostMoveIds = moves.map((move) => Number(move.id ?? 0)).filter((id) => id > 0);
        }
    }

    // Which lots each receipt actually brought in, so a purchase row can say
    // "this is the batch it landed as".
    if (landedCostMoveIds.length > 0) {
        const receiptLotLines = await searchReadAll(
            credentials,
            uid,
            "stock.move.line",
            [["move_id", "in", landedCostMoveIds], ["lot_id", "!=", false]],
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
            ["cost_id", "additional_landed_cost", "currency_id", "quantity"]
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
            const amount = Number(line.additional_landed_cost ?? 0) * multiplier;
            const qty = Number(line.quantity ?? 0);

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
                    productShareById.set(orderId, (productShareById.get(orderId) ?? 0) + subtotal);
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
        unifiedLotName,
        purchases: purchases.sort((a, b) => a.date.localeCompare(b.date)),
        landedCosts: landedCosts.sort((a, b) => a.date.localeCompare(b.date)),
        operationCosts: operationCosts.sort((a, b) => a.date.localeCompare(b.date)),
        sales: sales.sort((a, b) => a.date.localeCompare(b.date)),
        totals: {
            purchasedQty: sumBy(purchases, "quantity"),
            purchaseValue: sumBy(purchases, "amount"),
            landedCostValue: sumBy(landedCosts, "amount"),
            operationCostValue: sumBy(operationCosts, "amount"),
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
