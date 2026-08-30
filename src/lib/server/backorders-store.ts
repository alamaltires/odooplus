import { BackorderDetails, BackorderSource, BackorderStatus, OdooCredentials, SavedBackorder } from "@/types/odoo";
import { getAdminDb } from "@/lib/server/firebase-admin";
import {
    getProductCategoriesByProductIds,
    getProducts,
    getTemplateIdsByVariantIds,
    mapProductIdsToTemplateAndVariant,
    resolveCanonicalProductIds,
} from "@/lib/server/odoo-client";
import { FieldPath, FieldValue } from "firebase-admin/firestore";

const MAX_FILTERED_STATUS_READS = 300;
const MAX_PURCHASE_REPORT_READS = 500;
const MAX_SEARCH_SCAN_READS = 500;

type BackorderDocument = Omit<SavedBackorder, "id"> & {
    source: BackorderSource;
    updated_at: string;
    product_ids?: number[];
    converting_to_order_at?: string;
    converted_sales_order_id?: number;
};

type BackorderConversionDocument = {
    order_id: string;
    status: "in_progress" | "completed" | "failed";
    created_at: string;
    updated_at: string;
    sales_order_id?: number;
    error?: string;
};

export type PurchaseFromBackorderReportRow = {
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

function normalizeNumericQuantity(value: unknown) {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
}

function calculateShortage(orderedQuantity: unknown, availableQuantity: unknown) {
    const ordered = normalizeNumericQuantity(orderedQuantity);
    const available = normalizeNumericQuantity(availableQuantity);
    return Math.max(0, ordered - available);
}

function normalizeBackorderProducts(products: SavedBackorder["products"]): SavedBackorder["products"] {
    if (!Array.isArray(products)) {
        return [];
    }

    return products.map((product) => {
        const orderedQuantity = normalizeNumericQuantity(product.ordered_quantity);
        const availableQuantity = normalizeNumericQuantity(product.available_quantity);

        return {
            ...product,
            ordered_quantity: orderedQuantity,
            available_quantity: availableQuantity,
            shortage: calculateShortage(orderedQuantity, availableQuantity),
        };
    });
}

function normalizeBackorderStatus(value: unknown): BackorderStatus {
    const normalized = String(value ?? "").toLowerCase();
    if (normalized === "ready" || normalized === "partial" || normalized === "procced") {
        return normalized;
    }

    return "pendding";
}

export function deriveBackorderStatus(products: SavedBackorder["products"]): BackorderStatus {
    if (!Array.isArray(products) || products.length === 0) {
        return "pendding";
    }

    const fulfilledByLine = products.map((line) => {
        const available = normalizeNumericQuantity(line.available_quantity);
        const ordered = normalizeNumericQuantity(line.ordered_quantity);
        return available >= ordered;
    });

    if (fulfilledByLine.every(Boolean)) {
        return "ready";
    }

    if (fulfilledByLine.some(Boolean)) {
        return "partial";
    }

    return "pendding";
}

function deriveBackorderStatusForWebhook(products: SavedBackorder["products"]): BackorderStatus {
    return deriveBackorderStatus(products);
}

function buildBackorderProductIds(products: SavedBackorder["products"]): number[] {
    const ids = new Set<number>();

    for (const product of Array.isArray(products) ? products : []) {
        const templateId = Number(product.product_id ?? NaN);
        const variantId = Number(product.product_variant_id ?? NaN);

        if (Number.isFinite(templateId) && templateId > 0) {
            ids.add(templateId);
        }

        if (Number.isFinite(variantId) && variantId > 0) {
            ids.add(variantId);
        }
    }

    return Array.from(ids);
}

export async function saveBackorderSnapshot(
    details: BackorderDetails,
    source: BackorderSource,
    credentials?: OdooCredentials
): Promise<SavedBackorder> {
    const adminDb = getAdminDb();
    const docId = String(details.order.id);
    const now = new Date().toISOString();

    let products: SavedBackorder["products"] = details.lines.map((line) => {
        const rawProductId = Number(line.product_id?.[0] ?? NaN);
        const productId = Number.isFinite(rawProductId) && rawProductId > 0 ? rawProductId : null;
        const productName = line.name || line.product_id?.[1] || "-";

        if ((source === "manual" || source === "odoo") && (!productId || productId <= 0)) {
            throw new Error(`Missing product_id for line: ${productName}`);
        }

        return {
            product_id: productId,
            product_variant_id: productId,
            name: productName,
            ordered_quantity: normalizeNumericQuantity(line.ordered_qty),
            available_quantity: normalizeNumericQuantity(line.available_qty),
            shortage: calculateShortage(line.ordered_qty, line.available_qty),
            price: line.price_unit,
        };
    });

    if ((source === "manual" || source === "odoo" || source === "webhook") && credentials) {
        const inputProductIds = Array.from(
            new Set(
                products
                    .map((product) => Number(product.product_id ?? NaN))
                    .filter((id) => Number.isFinite(id) && id > 0)
            )
        );

        const canonicalProductIdByInput = await resolveCanonicalProductIds(credentials, inputProductIds);
        const canonicalVariantIds = Array.from(new Set(Array.from(canonicalProductIdByInput.values())));
        const templateIdByVariantId = await getTemplateIdsByVariantIds(credentials, canonicalVariantIds);

        products = products.map((product) => {
            const inputId = Number(product.product_id ?? NaN);
            if (!Number.isFinite(inputId) || inputId <= 0) {
                return product;
            }

            const canonicalId = canonicalProductIdByInput.get(inputId);
            if (!canonicalId) {
                throw new Error(`Invalid product_id for line: ${product.name}. Not found in Odoo.`);
            }

            const templateId = templateIdByVariantId.get(canonicalId);
            if (!templateId) {
                throw new Error(`Missing product template for line: ${product.name}.`);
            }

            const currentVariantId = Number(product.product_variant_id ?? NaN);
            const hasSameTemplateId = inputId === templateId;
            const hasSameVariantId = Number.isFinite(currentVariantId) && currentVariantId === canonicalId;

            if (hasSameTemplateId && hasSameVariantId) {
                return product;
            }

            return {
                ...product,
                product_id: templateId,
                product_variant_id: canonicalId,
            };
        });

        const productIds = Array.from(
            new Set(
                products
                    .map((product) => Number(product.product_variant_id ?? NaN))
                    .filter((id) => Number.isFinite(id) && id > 0)
            )
        );

        if (productIds.length > 0) {
            const categoryByProductId = await getProductCategoriesByProductIds(credentials, productIds);
            products = products.map((product) => {
                const productVariantId = Number(product.product_variant_id ?? NaN);
                const templateId = Number(product.product_id ?? NaN);
                const lookupId =
                    Number.isFinite(productVariantId) && productVariantId > 0
                        ? productVariantId
                        : Number.isFinite(templateId) && templateId > 0
                            ? templateId
                            : NaN;

                if (!Number.isFinite(lookupId) || lookupId <= 0) {
                    return product;
                }

                const category = categoryByProductId.get(lookupId);
                if (!category) {
                    return product;
                }

                return {
                    ...product,
                    category_id: category.categoryId,
                    category_name: category.categoryName,
                };
            });
        }
    }

    products = normalizeBackorderProducts(products);

    const payload: BackorderDocument = {
        order_id: details.order.id,
        order_number: details.order.name,
        customer_name: details.order.customer_name,
        order_date: details.order.order_date,
        salesperson_name: details.order.salesperson_name,
        products,
        product_ids: buildBackorderProductIds(products),
        saved_at: now,
        source,
        status: deriveBackorderStatus(products),
        updated_at: now,
    };

    await adminDb.collection("backorders").doc(docId).set(payload, { merge: true });

    return {
        id: docId,
        order_id: payload.order_id,
        order_number: payload.order_number,
        customer_name: payload.customer_name,
        order_date: payload.order_date,
        salesperson_name: payload.salesperson_name,
        products: payload.products,
        saved_at: payload.saved_at,
        source: payload.source,
        status: payload.status,
    };
}

export async function getBackorderSnapshot(id: string): Promise<SavedBackorder | null> {
    const adminDb = getAdminDb();
    const snapshot = await adminDb.collection("backorders").doc(id).get();

    if (!snapshot.exists) {
        return null;
    }

    const data = snapshot.data() as BackorderDocument;
    const products = normalizeBackorderProducts(Array.isArray(data.products) ? data.products : []);
    return {
        id: snapshot.id,
        order_id: Number(data.order_id),
        order_number: String(data.order_number ?? ""),
        customer_name: String(data.customer_name ?? ""),
        order_date: String(data.order_date ?? ""),
        salesperson_name: String(data.salesperson_name ?? ""),
        products,
        saved_at: String(data.saved_at ?? ""),
        source: data.source,
        status: normalizeBackorderStatus(data.status),
    };
}

export async function listBackorderSnapshots(): Promise<SavedBackorder[]> {
    const adminDb = getAdminDb();
    const snapshot = await adminDb.collection("backorders").orderBy("saved_at", "desc").get();

    return snapshot.docs.map((doc) => {
        const data = doc.data() as BackorderDocument;
        const products = normalizeBackorderProducts(Array.isArray(data.products) ? data.products : []);
        return {
            id: doc.id,
            order_id: Number(data.order_id),
            order_number: String(data.order_number ?? ""),
            customer_name: String(data.customer_name ?? ""),
            order_date: String(data.order_date ?? ""),
            salesperson_name: String(data.salesperson_name ?? ""),
            products,
            saved_at: String(data.saved_at ?? ""),
            source: data.source,
            status: normalizeBackorderStatus(data.status),
        };
    });
}

type BackorderListCursor = {
    savedAt: string;
    id: string;
};

function encodeBackorderCursor(cursor: BackorderListCursor) {
    return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64");
}

function decodeBackorderCursor(cursor: string): BackorderListCursor {
    const parsed = JSON.parse(Buffer.from(cursor, "base64").toString("utf8")) as BackorderListCursor;
    if (!parsed?.savedAt || !parsed?.id) {
        throw new Error("Invalid cursor.");
    }

    return {
        savedAt: String(parsed.savedAt),
        id: String(parsed.id),
    };
}

function mapBackorderDoc(doc: FirebaseFirestore.QueryDocumentSnapshot): SavedBackorder {
    const data = doc.data() as BackorderDocument;
    const products = normalizeBackorderProducts(Array.isArray(data.products) ? data.products : []);
    return {
        id: doc.id,
        order_id: Number(data.order_id),
        order_number: String(data.order_number ?? ""),
        customer_name: String(data.customer_name ?? ""),
        order_date: String(data.order_date ?? ""),
        salesperson_name: String(data.salesperson_name ?? ""),
        products,
        saved_at: String(data.saved_at ?? ""),
        source: data.source,
        status: normalizeBackorderStatus(data.status),
    };
}

function mapBackorderDocRow(doc: FirebaseFirestore.QueryDocumentSnapshot): {
    item: SavedBackorder;
    data: BackorderDocument;
} {
    const data = doc.data() as BackorderDocument;
    return {
        item: mapBackorderDoc(doc),
        data,
    };
}

function matchesBackorderSearch(item: SavedBackorder, rawQuery: string, data?: BackorderDocument) {
    const query = rawQuery.trim().toLowerCase();
    if (!query) {
        return true;
    }

    const productsText = (Array.isArray(item.products) ? item.products : [])
        .map((product) => [
            String(product.available_quantity ?? ""),
            String(product.category_id ?? ""),
            String(product.category_name ?? ""),
            String(product.name ?? ""),
            String(product.ordered_quantity ?? ""),
            String(product.price ?? ""),
            String(product.product_id ?? ""),
            String(product.product_variant_id ?? ""),
            String(product.shortage ?? ""),
        ].join(" "))
        .join(" ");

    const haystack = [
        item.customer_name,
        item.order_date,
        String(item.order_id),
        item.order_number,
        productsText,
        item.salesperson_name,
        item.saved_at,
        item.source ?? "",
        normalizeBackorderStatus(item.status),
        String(data?.updated_at ?? ""),
    ]
        .join(" ")
        .toLowerCase();

    return haystack.includes(query);
}

function matchesBackorderStatus(item: SavedBackorder, status: BackorderStatus | "all") {
    if (status === "all") {
        return true;
    }

    return normalizeBackorderStatus(item.status) === status;
}

export async function listFilteredBackorderSnapshots(input: {
    query?: string;
    status?: BackorderStatus | "all";
}): Promise<SavedBackorder[]> {
    const adminDb = getAdminDb();
    const status = input.status ?? "all";
    const query = String(input.query ?? "");

    if (status === "all") {
        const snapshot = await adminDb
            .collection("backorders")
            .orderBy("saved_at", "desc")
            .limit(MAX_FILTERED_STATUS_READS)
            .get();

        return snapshot.docs
            .map((doc) => mapBackorderDocRow(doc))
            .filter((row) => matchesBackorderSearch(row.item, query, row.data))
            .map((row) => row.item);
    }

    if (status === "pendding") {
        const snapshot = await adminDb
            .collection("backorders")
            .orderBy("saved_at", "desc")
            .limit(MAX_FILTERED_STATUS_READS)
            .get();

        return snapshot.docs
            .map((doc) => mapBackorderDocRow(doc))
            .filter((row) => matchesBackorderSearch(row.item, query, row.data))
            .map((row) => row.item)
            .filter((item) => matchesBackorderStatus(item, status));
    }

    const snapshot = await adminDb
        .collection("backorders")
        .where("status", "==", status)
        .limit(MAX_FILTERED_STATUS_READS)
        .get();

    return snapshot.docs
        .map((doc) => mapBackorderDocRow(doc))
        .sort((a, b) => b.item.saved_at.localeCompare(a.item.saved_at))
        .filter((row) => matchesBackorderSearch(row.item, query, row.data))
        .map((row) => row.item)
        .filter((item) => matchesBackorderStatus(item, status));
}

export async function searchBackorderSnapshots(input: {
    query: string;
}): Promise<SavedBackorder[]> {
    const adminDb = getAdminDb();
    const snapshot = await adminDb
        .collection("backorders")
        .orderBy("saved_at", "desc")
        .limit(MAX_SEARCH_SCAN_READS)
        .get();
    return snapshot.docs
        .map((doc) => mapBackorderDocRow(doc))
        .filter((row) => matchesBackorderSearch(row.item, input.query, row.data))
        .map((row) => row.item);
}

export async function listBackorderSnapshotsPaginated(input?: {
    limit?: number;
    cursor?: string | null;
}): Promise<{ items: SavedBackorder[]; nextCursor: string | null }> {
    const adminDb = getAdminDb();
    const limit = Number.isFinite(input?.limit) ? Math.max(1, Math.min(50, Number(input?.limit))) : 10;

    let query = adminDb
        .collection("backorders")
        .orderBy("saved_at", "desc")
        .orderBy(FieldPath.documentId(), "desc")
        .limit(limit);

    if (input?.cursor) {
        const parsedCursor = decodeBackorderCursor(input.cursor);
        query = query.startAfter(parsedCursor.savedAt, parsedCursor.id);
    }

    const snapshot = await query.get();
    const items = snapshot.docs.map((doc) => mapBackorderDoc(doc));

    const lastDoc = snapshot.docs[snapshot.docs.length - 1];
    const lastSavedAt = String(lastDoc?.get("saved_at") ?? "");
    const nextCursor =
        snapshot.docs.length === limit && lastDoc && lastSavedAt
            ? encodeBackorderCursor({ savedAt: lastSavedAt, id: lastDoc.id })
            : null;

    return { items, nextCursor };
}

export async function getPendingBackorderQuantitiesByVariantIds(
    variantIds: number[]
): Promise<Map<number, number>> {
    if (variantIds.length === 0) {
        return new Map();
    }

    const adminDb = getAdminDb();
    const result = new Map<number, number>();

    await Promise.all(
        variantIds.map(async (variantId) => {
            const snapshot = await adminDb
                .collection("backorders")
                .where("status", "==", "pendding")
                .where("product_ids", "array-contains", variantId)
                .get();

            let total = 0;
            for (const doc of snapshot.docs) {
                const data = doc.data() as BackorderDocument;
                const products = Array.isArray(data.products) ? data.products : [];
                for (const product of products) {
                    const pVariantId = Number(product.product_variant_id ?? NaN);
                    if (pVariantId === variantId) {
                        total += calculateShortage(product.ordered_quantity, product.available_quantity);
                    }
                }
            }

            if (total > 0) {
                result.set(variantId, total);
            }
        })
    );

    return result;
}

export async function listPurchaseFromBackorderReportRows(): Promise<PurchaseFromBackorderReportRow[]> {
    const adminDb = getAdminDb();
    const snapshot = await adminDb
        .collection("backorders")
        .where("status", "in", ["pendding", "partial"])
        .limit(MAX_PURCHASE_REPORT_READS)
        .get();
    const rows: PurchaseFromBackorderReportRow[] = [];

    for (const documentSnapshot of snapshot.docs) {
        const data = documentSnapshot.data() as BackorderDocument;
        const products = Array.isArray(data.products) ? data.products : [];

        for (const product of products) {
            const categoryIdValue = Number(product.category_id ?? NaN);
            const productIdValue = Number(product.product_id ?? NaN);
            const productVariantIdValue = Number(product.product_variant_id ?? NaN);
            const categoryName = String(product.category_name ?? "").trim() || "Uncategorized";
            const productName = String(product.name ?? "").trim() || "-";
            const orderedQuantity = Number(product.ordered_quantity ?? 0);
            const availableQuantity = Number(product.available_quantity ?? 0);
            const pendingQuantity = calculateShortage(orderedQuantity, availableQuantity);

            const categoryId = Number.isFinite(categoryIdValue) && categoryIdValue > 0 ? categoryIdValue : null;
            const productId = Number.isFinite(productIdValue) && productIdValue > 0 ? productIdValue : null;
            const productVariantId =
                Number.isFinite(productVariantIdValue) && productVariantIdValue > 0 ? productVariantIdValue : null;

            rows.push({
                categoryId,
                categoryName,
                productId,
                productVariantId,
                productName,
                pendingQuantity,
                orderedQuantity,
                availableQuantity,
                backorderCount: 1,
            });
        }
    }

    return rows
        .sort((a, b) => {
            const categoryCompare = a.categoryName.localeCompare(b.categoryName);
            if (categoryCompare !== 0) {
                return categoryCompare;
            }

            return a.productName.localeCompare(b.productName);
        });
}

export async function updateBackorderSnapshot(
    id: string,
    update: {
        order_number: string;
        customer_name: string;
        salesperson_name: string;
        order_date: string;
        products: SavedBackorder["products"];
    }
): Promise<SavedBackorder> {
    const adminDb = getAdminDb();
    const ref = adminDb.collection("backorders").doc(id);
    const existing = await ref.get();

    if (!existing.exists) {
        throw new Error("Backorder not found.");
    }

    const now = new Date().toISOString();
    const existingData = existing.data() as BackorderDocument;
    const normalizedProducts = normalizeBackorderProducts(update.products);
    const normalizedExistingStatus = normalizeBackorderStatus(existingData.status);
    const nextStatus = normalizedExistingStatus === "procced" ? "procced" : deriveBackorderStatus(normalizedProducts);

    await ref.set(
        {
            order_number: update.order_number,
            customer_name: update.customer_name,
            salesperson_name: update.salesperson_name,
            order_date: update.order_date,
            products: normalizedProducts,
            product_ids: buildBackorderProductIds(normalizedProducts),
            status: nextStatus,
            updated_at: now,
        },
        { merge: true }
    );

    const updated = await ref.get();
    const data = updated.data() as BackorderDocument;
    const products = normalizeBackorderProducts(Array.isArray(data.products) ? data.products : []);

    return {
        id: updated.id,
        order_id: Number(data.order_id),
        order_number: String(data.order_number ?? ""),
        customer_name: String(data.customer_name ?? ""),
        order_date: String(data.order_date ?? ""),
        salesperson_name: String(data.salesperson_name ?? ""),
        products,
        saved_at: String(data.saved_at ?? ""),
        source: data.source,
        status: normalizeBackorderStatus(data.status),
    };
}

export async function findBackorderByOrderNumber(orderNumber: string): Promise<SavedBackorder | null> {
    const adminDb = getAdminDb();
    const normalizedNumber = String(orderNumber ?? "").trim();

    if (!normalizedNumber) {
        return null;
    }

    const snapshot = await adminDb
        .collection("backorders")
        .where("order_number", "==", normalizedNumber)
        .limit(1)
        .get();

    if (snapshot.empty) {
        return null;
    }

    const doc = snapshot.docs[0];
    const data = doc.data() as BackorderDocument;
    const products = normalizeBackorderProducts(Array.isArray(data.products) ? data.products : []);
    return {
        id: doc.id,
        order_id: Number(data.order_id),
        order_number: String(data.order_number ?? ""),
        customer_name: String(data.customer_name ?? ""),
        order_date: String(data.order_date ?? ""),
        salesperson_name: String(data.salesperson_name ?? ""),
        products,
        saved_at: String(data.saved_at ?? ""),
        source: data.source,
        status: normalizeBackorderStatus(data.status),
    };
}

export async function markBackorderAsProcced(backorderId: string): Promise<void> {
    const adminDb = getAdminDb();
    const ref = adminDb.collection("backorders").doc(String(backorderId));
    const existing = await ref.get();

    if (!existing.exists) {
        return;
    }

    await ref.set(
        {
            status: "procced",
            updated_at: new Date().toISOString(),
            converting_to_order_at: FieldValue.delete(),
        },
        { merge: true }
    );
}

export async function markBackorderAsProccedIfReady(backorderId: string): Promise<SavedBackorder> {
    const adminDb = getAdminDb();
    const ref = adminDb.collection("backorders").doc(String(backorderId));

    await adminDb.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) {
            throw new Error("Backorder not found.");
        }

        const data = snapshot.data() as BackorderDocument;
        const status = normalizeBackorderStatus(data.status);
        if (status === "procced") {
            return;
        }

        const products = Array.isArray(data.products) ? data.products : [];
        const nextStatus = deriveBackorderStatus(products);
        if (nextStatus !== "ready") {
            throw new Error("Only ready backorders can be marked as procced.");
        }

        transaction.set(
            ref,
            {
                status: "procced",
                updated_at: new Date().toISOString(),
                converting_to_order_at: FieldValue.delete(),
            },
            { merge: true }
        );
    });

    const updated = await ref.get();
    const data = updated.data() as BackorderDocument;
    return {
        id: updated.id,
        order_id: Number(data.order_id),
        order_number: String(data.order_number ?? ""),
        customer_name: String(data.customer_name ?? ""),
        order_date: String(data.order_date ?? ""),
        salesperson_name: String(data.salesperson_name ?? ""),
        products: Array.isArray(data.products) ? data.products : [],
        saved_at: String(data.saved_at ?? ""),
        source: data.source,
        status: normalizeBackorderStatus(data.status),
    };
}

export async function beginBackorderConversion(backorderId: string): Promise<void> {
    const adminDb = getAdminDb();
    const ref = adminDb.collection("backorder-conversions").doc(String(backorderId));
    const now = new Date().toISOString();

    await adminDb.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        if (snapshot.exists) {
            const data = snapshot.data() as BackorderConversionDocument;
            if (data.status === "completed") {
                throw new Error(
                    data.sales_order_id
                        ? `This backorder was already converted to sales order ${data.sales_order_id}.`
                        : "This backorder was already converted to a sales order."
                );
            }

            if (data.status === "in_progress") {
                throw new Error("A sales order conversion is already in progress for this backorder.");
            }

            if (data.status === "failed") {
                throw new Error(
                    data.sales_order_id
                        ? `A previous conversion attempt may have already created sales order ${data.sales_order_id}. Review Odoo before retrying.`
                        : data.error || "A previous conversion attempt failed. Please review before retrying."
                );
            }
        }

        transaction.set(ref, {
            order_id: String(backorderId),
            status: "in_progress",
            created_at: now,
            updated_at: now,
        } satisfies BackorderConversionDocument);
    });

    await adminDb.collection("backorders").doc(String(backorderId)).set(
        {
            converting_to_order_at: now,
            updated_at: now,
        },
        { merge: true }
    );
}

export async function completeBackorderConversion(backorderId: string, salesOrderId: number): Promise<void> {
    const adminDb = getAdminDb();
    const now = new Date().toISOString();

    await adminDb.collection("backorder-conversions").doc(String(backorderId)).set(
        {
            order_id: String(backorderId),
            status: "completed",
            sales_order_id: salesOrderId,
            updated_at: now,
        },
        { merge: true }
    );
}

export async function failBackorderConversion(
    backorderId: string,
    input: { error: string; salesOrderId?: number }
): Promise<void> {
    const adminDb = getAdminDb();
    const now = new Date().toISOString();

    if (!input.salesOrderId) {
        await adminDb.collection("backorder-conversions").doc(String(backorderId)).delete().catch(() => undefined);
        await adminDb.collection("backorders").doc(String(backorderId)).set(
            {
                converting_to_order_at: FieldValue.delete(),
                updated_at: now,
            },
            { merge: true }
        );
        return;
    }

    await adminDb.collection("backorder-conversions").doc(String(backorderId)).set(
        {
            order_id: String(backorderId),
            status: "failed",
            sales_order_id: input.salesOrderId,
            error: input.error,
            updated_at: now,
        },
        { merge: true }
    );
}

const WEBHOOK_DEBUG_DOC = "inventory";
const MAX_WEBHOOK_DEBUG_EVENTS = 20;

export type InventoryWebhookDebugEvent = {
    receivedAt: string;
    status: number;
    payload?: unknown;
    result?: unknown;
    error?: string;
};

export async function recordInventoryWebhookEvent(event: InventoryWebhookDebugEvent): Promise<void> {
    try {
        const adminDb = getAdminDb();
        const ref = adminDb.collection("webhook-debug").doc(WEBHOOK_DEBUG_DOC);
        const snapshot = await ref.get();
        const existing = (snapshot.exists ? (snapshot.data()?.events as InventoryWebhookDebugEvent[]) : []) ?? [];
        const events = [event, ...existing].slice(0, MAX_WEBHOOK_DEBUG_EVENTS);
        await ref.set({ events, updated_at: event.receivedAt }, { merge: true });
    } catch {
        // best-effort diagnostics; must never break the webhook
    }
}

export async function getRecentInventoryWebhookEvents(): Promise<InventoryWebhookDebugEvent[]> {
    try {
        const adminDb = getAdminDb();
        const snapshot = await adminDb.collection("webhook-debug").doc(WEBHOOK_DEBUG_DOC).get();
        if (!snapshot.exists) {
            return [];
        }
        return (snapshot.data()?.events as InventoryWebhookDebugEvent[]) ?? [];
    } catch {
        return [];
    }
}

type InventoryWebhookMatchDebug = {
    usedFallbackScan: boolean;
    scannedBackorders: number;
    distinctStoredIds: number[];
    sampleBackorders: Array<{
        orderNumber: string;
        productIds: number[];
        products: Array<{ name: string; productId: number | null; productVariantId: number | null }>;
    }>;
};

export async function applyInventoryWebhookToBackorders(input: {
    productId: number;
    qtyAvailable: number;
    /**
     * All Odoo ids that should be treated as the same product (template id +
     * variant ids). Odoo's inventory webhook sends the template id while
     * backorders may store the variant id, so we match against any of them.
     */
    relatedProductIds?: number[];
}): Promise<{ matchedBackorders: number; updatedBackorders: number; debug?: InventoryWebhookMatchDebug }> {
    const adminDb = getAdminDb();

    const matchIds = Array.from(
        new Set(
            [input.productId, ...(Array.isArray(input.relatedProductIds) ? input.relatedProductIds : [])]
                .map((id) => Number(id))
                .filter((id) => Number.isFinite(id) && id > 0)
        )
    );

    // Firestore `array-contains-any` accepts up to 30 values; we only ever pass a handful.
    const indexedSnapshot = await adminDb
        .collection("backorders")
        .where("product_ids", "array-contains-any", matchIds.slice(0, 30))
        .get();

    const candidateSnapshots = indexedSnapshot.docs;

    // Backward-compatible fallback for legacy backorders that predate `product_ids`.
    let usedFallbackScan = false;
    if (candidateSnapshots.length === 0) {
        usedFallbackScan = true;
        const fallbackSnapshot = await adminDb.collection("backorders").limit(MAX_SEARCH_SCAN_READS).get();
        candidateSnapshots.push(...fallbackSnapshot.docs);
    }

    let matchedBackorders = 0;
    let updatedBackorders = 0;
    const distinctStoredIds = new Set<number>();
    const sampleBackorders: InventoryWebhookMatchDebug["sampleBackorders"] = [];

    for (const documentSnapshot of candidateSnapshots) {
        const data = documentSnapshot.data() as BackorderDocument;
        const sourceProducts = normalizeBackorderProducts(Array.isArray(data.products) ? data.products : []);

        // Collect diagnostics so a zero-match can be explained from the stored data.
        for (const product of sourceProducts) {
            const tid = Number(product.product_id ?? NaN);
            const vid = Number(product.product_variant_id ?? NaN);
            if (Number.isFinite(tid) && tid > 0) distinctStoredIds.add(tid);
            if (Number.isFinite(vid) && vid > 0) distinctStoredIds.add(vid);
        }
        if (sampleBackorders.length < 25) {
            sampleBackorders.push({
                orderNumber: String(data.order_number ?? documentSnapshot.id),
                productIds: Array.isArray(data.product_ids) ? data.product_ids : [],
                products: sourceProducts.map((product) => ({
                    name: String(product.name ?? "-"),
                    productId: Number.isFinite(Number(product.product_id)) ? Number(product.product_id) : null,
                    productVariantId: Number.isFinite(Number(product.product_variant_id))
                        ? Number(product.product_variant_id)
                        : null,
                })),
            });
        }
        let hasMatchingProduct = false;
        let changed = false;

        const nextProducts = sourceProducts.map((product) => {
            const currentTemplateId = Number(product.product_id ?? NaN);
            const currentVariantId = Number(product.product_variant_id ?? NaN);

            const matchesTemplateId = Number.isFinite(currentTemplateId) && matchIds.includes(currentTemplateId);
            const matchesVariantId = Number.isFinite(currentVariantId) && matchIds.includes(currentVariantId);

            if (!matchesTemplateId && !matchesVariantId) {
                return product;
            }

            hasMatchingProduct = true;
            if (Number(product.available_quantity ?? 0) === input.qtyAvailable) {
                return product;
            }

            changed = true;
            return {
                ...product,
                available_quantity: input.qtyAvailable,
                shortage: calculateShortage(product.ordered_quantity, input.qtyAvailable),
            };
        });

        if (!hasMatchingProduct) {
            continue;
        }

        matchedBackorders += 1;
        const nextProductIds = buildBackorderProductIds(nextProducts);
        const storedProductIds = Array.isArray(data.product_ids) ? data.product_ids : [];
        const productIdsChanged =
            storedProductIds.length !== nextProductIds.length ||
            nextProductIds.some((id) => !storedProductIds.includes(id));

        if (!changed && !productIdsChanged) {
            continue;
        }

        const currentStatus = normalizeBackorderStatus(data.status);
        const nextStatus = currentStatus === "procced" ? "procced" : deriveBackorderStatusForWebhook(nextProducts);

        await adminDb.collection("backorders").doc(documentSnapshot.id).set(
            {
                products: nextProducts,
                product_ids: nextProductIds,
                status: nextStatus,
                updated_at: new Date().toISOString(),
            },
            { merge: true }
        );
        updatedBackorders += 1;
    }

    return {
        matchedBackorders,
        updatedBackorders,
        ...(matchedBackorders === 0
            ? {
                  debug: {
                      usedFallbackScan,
                      scannedBackorders: candidateSnapshots.length,
                      distinctStoredIds: Array.from(distinctStoredIds),
                      sampleBackorders,
                  },
              }
            : {}),
    };
}

export type BackorderTemplateIdMigrationResult = {
    scannedBackorders: number;
    updatedBackorders: number;
    scannedProducts: number;
    rewrittenProducts: number;
    unresolvedProducts: number;
    unresolvedSamples: Array<{ backorderId: string; productName: string; storedId: number | null }>;
};

/**
 * One-time migration: rewrite every backorder so `product_id` holds the Odoo
 * `product.template` id (what Odoo's inventory webhook sends) instead of the
 * variant id. `product_variant_id` is set to the canonical variant id and
 * `product_ids` is rebuilt to contain both. Idempotent — safe to run repeatedly.
 */
export async function migrateBackordersToTemplateIds(
    credentials: OdooCredentials
): Promise<BackorderTemplateIdMigrationResult> {
    const adminDb = getAdminDb();
    const snapshot = await adminDb.collection("backorders").get();

    // Gather every stored id so we resolve them all in a couple of Odoo calls.
    const allIds = new Set<number>();
    for (const documentSnapshot of snapshot.docs) {
        const data = documentSnapshot.data() as BackorderDocument;
        for (const product of Array.isArray(data.products) ? data.products : []) {
            const templateId = Number(product.product_id ?? NaN);
            const variantId = Number(product.product_variant_id ?? NaN);
            if (Number.isFinite(templateId) && templateId > 0) allIds.add(templateId);
            if (Number.isFinite(variantId) && variantId > 0) allIds.add(variantId);
        }
    }

    const idMap = await mapProductIdsToTemplateAndVariant(credentials, Array.from(allIds));

    let scannedBackorders = 0;
    let updatedBackorders = 0;
    let scannedProducts = 0;
    let rewrittenProducts = 0;
    let unresolvedProducts = 0;
    const unresolvedSamples: BackorderTemplateIdMigrationResult["unresolvedSamples"] = [];

    for (const documentSnapshot of snapshot.docs) {
        scannedBackorders += 1;
        const data = documentSnapshot.data() as BackorderDocument;
        const sourceProducts = Array.isArray(data.products) ? data.products : [];
        let changed = false;

        const nextProducts = sourceProducts.map((product) => {
            scannedProducts += 1;
            const storedId = Number(product.product_id ?? product.product_variant_id ?? NaN);
            const mapping = Number.isFinite(storedId) ? idMap.get(storedId) : undefined;

            if (!mapping) {
                unresolvedProducts += 1;
                if (unresolvedSamples.length < 25) {
                    unresolvedSamples.push({
                        backorderId: documentSnapshot.id,
                        productName: String(product.name ?? ""),
                        storedId: Number.isFinite(storedId) ? storedId : null,
                    });
                }
                return product;
            }

            if (Number(product.product_id) === mapping.templateId && Number(product.product_variant_id) === mapping.variantId) {
                return product;
            }

            changed = true;
            rewrittenProducts += 1;
            return {
                ...product,
                product_id: mapping.templateId,
                product_variant_id: mapping.variantId,
            };
        });

        if (changed) {
            const normalized = normalizeBackorderProducts(nextProducts);
            await adminDb.collection("backorders").doc(documentSnapshot.id).set(
                {
                    products: normalized,
                    product_ids: buildBackorderProductIds(normalized),
                    updated_at: new Date().toISOString(),
                },
                { merge: true }
            );
            updatedBackorders += 1;
        }
    }

    return {
        scannedBackorders,
        updatedBackorders,
        scannedProducts,
        rewrittenProducts,
        unresolvedProducts,
        unresolvedSamples,
    };
}

export type BackorderProductIdBackfillResult = {
    scannedBackorders: number;
    updatedBackorders: number;
    scannedProducts: number;
    updatedProducts: number;
    unresolvedProducts: number;
    unresolvedSamples: Array<{ backorderId: string; productName: string }>;
};

export type BackorderProductCategoryBackfillResult = {
    scannedBackorders: number;
    updatedBackorders: number;
    scannedProducts: number;
    updatedProducts: number;
    unresolvedProducts: number;
    unresolvedSamples: Array<{ backorderId: string; productId: number | null; productName: string }>;
};

function normalizeProductName(value: string) {
    return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function stripProductCodePrefix(value: string) {
    return value.replace(/^\[[^\]]+\]\s*/, "").trim();
}

function stripOutOfStockSuffix(value: string) {
    return value.replace(/\s*out\s+of\s+stock\s*$/i, "").trim();
}

function extractBracketProductCode(value: string) {
    const match = value.match(/^\[([^\]]+)\]/);
    return match?.[1]?.trim() ?? null;
}

function normalizeForComparison(value: string) {
    return normalizeProductName(stripOutOfStockSuffix(stripProductCodePrefix(value)));
}

async function resolveProductIdByName(
    credentials: OdooCredentials,
    productName: string,
    cache: Map<string, number | null>
) {
    const normalizedName = normalizeProductName(productName);
    if (!normalizedName) {
        return null;
    }

    if (cache.has(normalizedName)) {
        return cache.get(normalizedName) ?? null;
    }

    const extractedCode = extractBracketProductCode(productName);
    const cleanedName = stripOutOfStockSuffix(stripProductCodePrefix(productName));
    const searchQueries = Array.from(
        new Set(
            [extractedCode, cleanedName, productName]
                .map((value) => String(value ?? "").trim())
                .filter((value) => Boolean(value))
        )
    );

    const mergedCandidates = new Map<number, { id: number; name: string }>();
    for (const query of searchQueries) {
        const result = await getProducts(credentials, {
            query,
            limit: 100,
            offset: 0,
        });

        for (const product of result.products) {
            mergedCandidates.set(product.id, product);
        }
    }

    const candidates = Array.from(mergedCandidates.values());

    let resolvedId: number | null = null;

    if (extractedCode) {
        const codeMatches = candidates.filter((product) => {
            const codePattern = new RegExp(`^\\[${extractedCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]`, "i");
            return codePattern.test(product.name);
        });

        if (codeMatches.length === 1) {
            resolvedId = codeMatches[0].id;
        }
    }

    if (!resolvedId) {
        const normalizedInput = normalizeForComparison(productName);
        const cleanedExactMatches = candidates.filter((product) => {
            return normalizeForComparison(product.name) === normalizedInput;
        });

        if (cleanedExactMatches.length === 1) {
            resolvedId = cleanedExactMatches[0].id;
        }
    }

    cache.set(normalizedName, resolvedId);
    return resolvedId;
}

// Temporary migration helper: fills missing product_id values using product names from Odoo.
export async function backfillMissingBackorderProductIdsTemporary(
    credentials: OdooCredentials
): Promise<BackorderProductIdBackfillResult> {
    const adminDb = getAdminDb();
    const snapshot = await adminDb.collection("backorders").get();
    const productIdCache = new Map<string, number | null>();

    let scannedBackorders = 0;
    let updatedBackorders = 0;
    let scannedProducts = 0;
    let updatedProducts = 0;
    let unresolvedProducts = 0;
    const unresolvedSamples: Array<{ backorderId: string; productName: string }> = [];

    for (const documentSnapshot of snapshot.docs) {
        scannedBackorders += 1;

        const data = documentSnapshot.data() as BackorderDocument;
        const sourceProducts = Array.isArray(data.products) ? data.products : [];
        const nextProducts: SavedBackorder["products"] = [];

        let changed = false;

        for (const sourceProduct of sourceProducts) {
            scannedProducts += 1;

            const existingId = Number(sourceProduct?.product_id ?? NaN);
            if (Number.isFinite(existingId) && existingId > 0) {
                nextProducts.push(sourceProduct);
                continue;
            }

            const productName = String(sourceProduct?.name ?? "").trim();
            if (!productName) {
                unresolvedProducts += 1;
                if (unresolvedSamples.length < 25) {
                    unresolvedSamples.push({
                        backorderId: documentSnapshot.id,
                        productName: "",
                    });
                }
                nextProducts.push(sourceProduct);
                continue;
            }

            const resolvedProductId = await resolveProductIdByName(
                credentials,
                productName,
                productIdCache
            );

            if (resolvedProductId) {
                changed = true;
                updatedProducts += 1;
                nextProducts.push({
                    ...sourceProduct,
                    product_id: resolvedProductId,
                });
                continue;
            }

            unresolvedProducts += 1;
            if (unresolvedSamples.length < 25) {
                unresolvedSamples.push({
                    backorderId: documentSnapshot.id,
                    productName,
                });
            }
            nextProducts.push(sourceProduct);
        }

        if (changed) {
            updatedBackorders += 1;
            await adminDb.collection("backorders").doc(documentSnapshot.id).set(
                {
                    products: nextProducts,
                    product_ids: buildBackorderProductIds(nextProducts),
                    updated_at: new Date().toISOString(),
                },
                { merge: true }
            );
        }
    }

    return {
        scannedBackorders,
        updatedBackorders,
        scannedProducts,
        updatedProducts,
        unresolvedProducts,
        unresolvedSamples,
    };
}

// Temporary migration helper: fills product category fields from Odoo for saved backorders.
export async function backfillBackorderProductCategoriesTemporary(
    credentials: OdooCredentials
): Promise<BackorderProductCategoryBackfillResult> {
    const adminDb = getAdminDb();
    const snapshot = await adminDb.collection("backorders").get();

    let scannedBackorders = 0;
    let updatedBackorders = 0;
    let scannedProducts = 0;
    let updatedProducts = 0;
    let unresolvedProducts = 0;
    const unresolvedSamples: Array<{ backorderId: string; productId: number | null; productName: string }> = [];

    const uniqueProductIds = new Set<number>();
    for (const documentSnapshot of snapshot.docs) {
        const data = documentSnapshot.data() as BackorderDocument;
        const products = Array.isArray(data.products) ? data.products : [];

        for (const product of products) {
            const productVariantId = Number(product.product_variant_id ?? NaN);
            const templateId = Number(product.product_id ?? NaN);
            const lookupId =
                Number.isFinite(productVariantId) && productVariantId > 0
                    ? productVariantId
                    : Number.isFinite(templateId) && templateId > 0
                        ? templateId
                        : NaN;

            if (Number.isFinite(lookupId) && lookupId > 0) {
                uniqueProductIds.add(lookupId);
            }
        }
    }

    const categoryByProductId = await getProductCategoriesByProductIds(credentials, Array.from(uniqueProductIds));

    for (const documentSnapshot of snapshot.docs) {
        scannedBackorders += 1;

        const data = documentSnapshot.data() as BackorderDocument;
        const sourceProducts = Array.isArray(data.products) ? data.products : [];
        const nextProducts: SavedBackorder["products"] = [];
        let changed = false;

        for (const sourceProduct of sourceProducts) {
            scannedProducts += 1;

            const productVariantId = Number(sourceProduct?.product_variant_id ?? NaN);
            const templateId = Number(sourceProduct?.product_id ?? NaN);
            const lookupId =
                Number.isFinite(productVariantId) && productVariantId > 0
                    ? productVariantId
                    : Number.isFinite(templateId) && templateId > 0
                        ? templateId
                        : NaN;
            const normalizedProductId = Number.isFinite(lookupId) && lookupId > 0 ? lookupId : null;

            if (!normalizedProductId) {
                unresolvedProducts += 1;
                if (unresolvedSamples.length < 25) {
                    unresolvedSamples.push({
                        backorderId: documentSnapshot.id,
                        productId: null,
                        productName: String(sourceProduct?.name ?? "").trim(),
                    });
                }
                nextProducts.push(sourceProduct);
                continue;
            }

            const resolvedCategory = categoryByProductId.get(normalizedProductId);
            if (!resolvedCategory) {
                unresolvedProducts += 1;
                if (unresolvedSamples.length < 25) {
                    unresolvedSamples.push({
                        backorderId: documentSnapshot.id,
                        productId: normalizedProductId,
                        productName: String(sourceProduct?.name ?? "").trim(),
                    });
                }
                nextProducts.push(sourceProduct);
                continue;
            }

            const currentCategoryId = Number(sourceProduct?.category_id ?? NaN);
            const currentCategoryName = String(sourceProduct?.category_name ?? "").trim();
            const hasSameCategoryId = Number.isFinite(currentCategoryId) && currentCategoryId === resolvedCategory.categoryId;
            const hasSameCategoryName = currentCategoryName === resolvedCategory.categoryName;

            if (hasSameCategoryId && hasSameCategoryName) {
                nextProducts.push(sourceProduct);
                continue;
            }

            changed = true;
            updatedProducts += 1;
            nextProducts.push({
                ...sourceProduct,
                category_id: resolvedCategory.categoryId,
                category_name: resolvedCategory.categoryName,
            });
        }

        if (!changed) {
            continue;
        }

        updatedBackorders += 1;
        await adminDb.collection("backorders").doc(documentSnapshot.id).set(
            {
                products: nextProducts,
                updated_at: new Date().toISOString(),
            },
            { merge: true }
        );
    }

    return {
        scannedBackorders,
        updatedBackorders,
        scannedProducts,
        updatedProducts,
        unresolvedProducts,
        unresolvedSamples,
    };
}
