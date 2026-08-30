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

type PurchaseOrderReportRow = {
    productId: number;
    productName: string;
    soldInPeriod: number;
    currentStock: number;
    averageMonthlySales: number;
    suggestedRestock: number;
    pendingFromBackorders: number;
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

type SalespersonMonthlyInvoices = {
    salesperson: SalespersonOption;
    year: number;
    month: number;
    totalInvoiced: number;
    creditNoteTotal: number;
    invoiceCount: number;
    categoryTotals: Array<{
        categoryId: number;
        totalInvoiced: number;
        ancestorCategoryIds: number[];
    }>;
    creditNoteCategoryTotals: Array<{
        categoryId: number;
        totalInvoiced: number;
        ancestorCategoryIds: number[];
    }>;
    debug?: {
        invoiceCountFetched: number;
        invoiceCountQualified: number;
        invoiceLineCountFetched: number;
        invoiceLineCountQualified: number;
        productCountFetched: number;
        productCountMappedToCategory: number;
        categoryTotalCount: number;
    };
};

type SalesTargetCategoryProduct = {
    productId: number;
    productName: string;
    quantitySold: number;
    totalSales: number;
    orderCount: number;
};

type SalesTargetCategoryCustomer = CustomerSummary & {
    orderCount: number;
    totalSales: number;
    lastSaleDate: string;
};

type SalesTargetDetailsReport = {
    salesperson: SalespersonOption;
    year: number;
    month: number;
    categoryId: number;
    categoryName: string;
    startDate: string;
    endDate: string;
    totalCategorySales: number;
    products: SalesTargetCategoryProduct[];
    servedCustomers: SalesTargetCategoryCustomer[];
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
            fields: ["id", "amount_total"],
            order: "invoice_date desc",
            limit: 20000,
        }
    );

    const invoiceIds = invoices
        .map((invoice) => Number(invoice.id ?? 0))
        .filter((id) => Number.isFinite(id) && id > 0);

    let creditNoteTotal = 0;
    let creditNoteIds: number[] = [];

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
                fields: ["id", "amount_total"],
                limit: 20000,
            }
        );

        creditNoteTotal = Number(
            creditNotes
                .reduce((sum, note) => sum + Math.abs(Number(note.amount_total ?? 0)), 0)
                .toFixed(2)
        );

        creditNoteIds = creditNotes
            .map((note) => Number(note.id ?? 0))
            .filter((id) => Number.isFinite(id) && id > 0);
    }

    let categoryTotals: Array<{ categoryId: number; totalInvoiced: number; ancestorCategoryIds: number[] }> = [];
    let categoryBySaleLineId = new Map<number, number>();
    let ancestorIdsByCategoryId = new Map<number, number[]>();
    const qualifiedInvoiceIdSet = new Set<number>(invoiceIds);
    let invoiceLineCountFetched = 0;
    let invoiceLineCountQualified = 0;
    let productCountFetched = 0;
    let productCountMappedToCategory = 0;

    if (invoiceIds.length > 0) {
        const invoiceLines = await executeKw<Array<Record<string, unknown>>>(
            credentials,
            uid,
            "account.move.line",
            "search_read",
            [[
                ["move_id", "in", invoiceIds],
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
                    fields: ["id", "categ_id", "product_tmpl_id"],
                }
            )
            : [];
        productCountFetched = products.length;

        const templateIdsNeedingLookup = Array.from(
            new Set(
                products
                    .filter((product) => !getRelationalId(product.categ_id))
                    .map((product) => getRelationalId(product.product_tmpl_id))
                    .filter((id): id is number => typeof id === "number" && id > 0)
            )
        );

        const templates = templateIdsNeedingLookup.length > 0
            ? await executeKw<Array<Record<string, unknown>>>(
                credentials,
                uid,
                "product.template",
                "read",
                [templateIdsNeedingLookup],
                {
                    fields: ["id", "categ_id"],
                }
            )
            : [];

        const categoryByTemplateId = new Map<number, number>();
        for (const template of templates) {
            const templateId = Number(template.id ?? 0);
            const categoryId = getRelationalId(template.categ_id);
            if (templateId > 0 && typeof categoryId === "number" && categoryId > 0) {
                categoryByTemplateId.set(templateId, categoryId);
            }
        }

        const categoryByProductId = new Map<number, number>();
        for (const product of products) {
            const productId = Number(product.id ?? 0);
            const directCategoryId = getRelationalId(product.categ_id);
            const templateId = getRelationalId(product.product_tmpl_id);
            const categoryId =
                (typeof directCategoryId === "number" && directCategoryId > 0)
                    ? directCategoryId
                    : (typeof templateId === "number" && templateId > 0)
                        ? categoryByTemplateId.get(templateId) ?? null
                        : null;

            if (productId > 0 && typeof categoryId === "number" && categoryId > 0) {
                categoryByProductId.set(productId, categoryId);
            }
        }
        productCountMappedToCategory = categoryByProductId.size;

        categoryBySaleLineId = new Map<number, number>();
        for (const saleLine of saleLines) {
            const saleLineId = Number(saleLine.id ?? 0);
            const productId = getRelationalId(saleLine.product_id);
            if (!Number.isFinite(saleLineId) || saleLineId <= 0 || !productId) {
                continue;
            }

            const categoryId = categoryByProductId.get(productId);
            if (typeof categoryId === "number" && categoryId > 0) {
                categoryBySaleLineId.set(saleLineId, categoryId);
            }
        }

        const categoryIds = Array.from(new Set(Array.from(categoryByProductId.values())));
        const categoriesById = new Map<number, { id: number; parentId: number | null }>();

        if (categoryIds.length > 0) {
            const queue = [...categoryIds];
            const seen = new Set<number>();

            while (queue.length > 0) {
                const batch = queue.splice(0, 200).filter((id) => !seen.has(id));
                if (batch.length === 0) {
                    continue;
                }

                for (const id of batch) {
                    seen.add(id);
                }

                const categoryRecords = await executeKw<Array<Record<string, unknown>>>(
                    credentials,
                    uid,
                    "product.category",
                    "read",
                    [batch],
                    {
                        fields: ["id", "parent_id"],
                    }
                );

                for (const category of categoryRecords) {
                    const id = Number(category.id ?? 0);
                    const parentId = getRelationalId(category.parent_id);
                    if (id <= 0) {
                        continue;
                    }

                    categoriesById.set(id, {
                        id,
                        parentId: typeof parentId === "number" && parentId > 0 ? parentId : null,
                    });

                    if (typeof parentId === "number" && parentId > 0 && !seen.has(parentId)) {
                        queue.push(parentId);
                    }
                }
            }
        }

        ancestorIdsByCategoryId = new Map<number, number[]>();
        for (const categoryId of categoryIds) {
            const visited = new Set<number>();
            const ancestors: number[] = [];
            let currentId: number | null = categoryId;

            while (typeof currentId === "number" && currentId > 0 && !visited.has(currentId)) {
                visited.add(currentId);
                ancestors.push(currentId);

                const current = categoriesById.get(currentId);
                currentId = current?.parentId ?? null;
            }

            ancestorIdsByCategoryId.set(categoryId, ancestors);
        }

        const totalsByCategory = new Map<number, number>();
        for (const line of qualifiedInvoiceLines) {
            const linkedSaleLineIds = normalizeRelationalIdList(line.sale_line_ids);

            const linkedCategoryIds = Array.from(
                new Set(
                    linkedSaleLineIds
                        .map((saleLineId) => categoryBySaleLineId.get(saleLineId))
                        .filter((categoryId): categoryId is number => typeof categoryId === "number" && categoryId > 0)
                )
            );

            if (linkedCategoryIds.length === 0) {
                continue;
            }

            const lineAmount = Number(line.price_total ?? 0);
            if (!Number.isFinite(lineAmount)) {
                continue;
            }

            const splitAmount = lineAmount / linkedCategoryIds.length;

            for (const categoryId of linkedCategoryIds) {
                const current = totalsByCategory.get(categoryId) ?? 0;
                totalsByCategory.set(categoryId, current + splitAmount);
            }
        }

        categoryTotals = Array.from(totalsByCategory.entries())
            .map(([categoryId, total]) => ({
                categoryId,
                totalInvoiced: Number(total.toFixed(2)),
                ancestorCategoryIds: ancestorIdsByCategoryId.get(categoryId) ?? [categoryId],
            }))
            .sort((a, b) => b.totalInvoiced - a.totalInvoiced);
    }

    let creditNoteCategoryTotals: Array<{ categoryId: number; totalInvoiced: number; ancestorCategoryIds: number[] }> = [];

    if (input.includeCreditNotes && creditNoteIds.length > 0 && categoryBySaleLineId.size > 0) {
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

        const creditNoteTotalsByCategory = new Map<number, number>();
        for (const line of qualifiedCreditNoteLines) {
            const linkedSaleLineIds = normalizeRelationalIdList(line.sale_line_ids);

            const linkedCategoryIds = Array.from(
                new Set(
                    linkedSaleLineIds
                        .map((saleLineId) => categoryBySaleLineId.get(saleLineId))
                        .filter((categoryId): categoryId is number => typeof categoryId === "number" && categoryId > 0)
                )
            );

            if (linkedCategoryIds.length === 0) {
                continue;
            }

            const lineAmount = Math.abs(Number(line.price_total ?? 0));
            if (!Number.isFinite(lineAmount)) {
                continue;
            }

            const splitAmount = lineAmount / linkedCategoryIds.length;

            for (const categoryId of linkedCategoryIds) {
                const current = creditNoteTotalsByCategory.get(categoryId) ?? 0;
                creditNoteTotalsByCategory.set(categoryId, current + splitAmount);
            }
        }

        creditNoteCategoryTotals = Array.from(creditNoteTotalsByCategory.entries())
            .map(([categoryId, total]) => ({
                categoryId,
                totalInvoiced: Number(total.toFixed(2)),
                ancestorCategoryIds: ancestorIdsByCategoryId.get(categoryId) ?? [categoryId],
            }))
            .sort((a, b) => b.totalInvoiced - a.totalInvoiced);
    }

    const totalInvoiced = Number(
        invoices.reduce((sum, invoice) => sum + Number(invoice.amount_total ?? 0), 0).toFixed(2)
    );

    return {
        salesperson,
        year,
        month,
        totalInvoiced,
        creditNoteTotal,
        invoiceCount: qualifiedInvoiceIdSet.size,
        categoryTotals,
        creditNoteCategoryTotals,
        debug: {
            invoiceCountFetched: invoices.length,
            invoiceCountQualified: qualifiedInvoiceIdSet.size,
            invoiceLineCountFetched,
            invoiceLineCountQualified,
            productCountFetched,
            productCountMappedToCategory,
            categoryTotalCount: categoryTotals.length,
        },
    };
}

export async function getSalesTargetDetails(
    credentials: OdooCredentials,
    input: {
        salespersonId: number;
        year: number;
        month: number;
        categoryId: number;
    }
): Promise<SalesTargetDetailsReport> {
    const uid = await authenticate(credentials);
    const salespersonId = Number(input.salespersonId);
    const year = Number(input.year);
    const month = Number(input.month);
    const categoryId = Number(input.categoryId);

    if (!Number.isFinite(salespersonId) || salespersonId <= 0) {
        throw new Error("A valid salesperson is required.");
    }

    if (!Number.isFinite(year) || year < 2000 || year > 2100) {
        throw new Error("A valid year is required.");
    }

    if (!Number.isFinite(month) || month < 1 || month > 12) {
        throw new Error("A valid month is required.");
    }

    if (!Number.isFinite(categoryId) || categoryId <= 0) {
        throw new Error("A valid product category is required.");
    }

    const [salespeople, categories] = await Promise.all([
        getSalespeople(credentials),
        executeKw<Array<Record<string, unknown>>>(
            credentials,
            uid,
            "product.category",
            "read",
            [[categoryId]],
            {
                fields: ["id", "name"],
            }
        ),
    ]);

    const salesperson = salespeople.find((item) => item.id === salespersonId);
    if (!salesperson) {
        throw new Error("Selected salesperson was not found in Odoo.");
    }

    const category = categories[0];
    if (!category) {
        throw new Error("Selected category was not found in Odoo.");
    }

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
            ["product_id.categ_id", "child_of", categoryId],
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
                fields: ["id", "name", "partner_id", "date_order"],
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

    const partnerIds = Array.from(
        new Set(
            orders
                .map((order) => getRelationalId(order.partner_id))
                .filter((id): id is number => typeof id === "number" && id > 0)
        )
    );

    const canonicalCustomerMap = await getCanonicalCustomerMap(credentials, uid, partnerIds);

    const productsById = new Map<number, SalesTargetCategoryProduct>();
    const orderIdsByProductId = new Map<number, Set<number>>();
    const customersById = new Map<number, SalesTargetCategoryCustomer>();
    const orderIdsByCustomerId = new Map<number, Set<number>>();
    let totalCategorySales = 0;

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
        const lineSales = Number(line.price_subtotal ?? 0);
        totalCategorySales += lineSales;

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
        categoryId,
        categoryName: toDisplayString(category.name) || `Category #${categoryId}`,
        startDate,
        endDate,
        totalCategorySales: Number(totalCategorySales.toFixed(2)),
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

export async function getPurchaseOrderReport(
    credentials: OdooCredentials,
    input: {
        categoryId: number;
        categoryModel?: "product.public.category" | "product.category";
        startDate: string;
        endDate: string;
        stockDurationMonths: number;
    }
): Promise<{ monthsInRange: number; rows: PurchaseOrderReportRow[] }> {
    const uid = await authenticate(credentials);
    const categoryId = Number(input.categoryId);
    const categoryModel = input.categoryModel ?? "product.public.category";
    const stockDurationMonths = Math.min(Math.max(Number(input.stockDurationMonths) || 1, 1), 12);

    if (!Number.isFinite(categoryId) || categoryId <= 0) {
        throw new Error("Invalid category selected.");
    }

    const startDate = input.startDate;
    const endDate = input.endDate;
    if (!startDate || !endDate) {
        throw new Error("Start date and end date are required.");
    }

    const templateDomain =
        categoryModel === "product.category"
            ? [["categ_id", "child_of", categoryId]]
            : [["public_categ_ids", "child_of", categoryId]];

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
