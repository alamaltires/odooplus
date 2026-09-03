import { collection, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { BackorderDetails, OdooCredentials, SalesTargetRecord, SavedBackorder } from "@/types/odoo";

const SETTINGS_DOC = "odoo";
const SALES_TARGETS_COLLECTION = "sales-targets";

type OdooSettingsDocument = {
    credentials: OdooCredentials;
    updatedAt: string;
};

export async function saveOdooSettings(userId: string, credentials: OdooCredentials) {
    const ref = doc(db, "users", userId, "integrations", SETTINGS_DOC);
    const payload: OdooSettingsDocument = {
        credentials,
        updatedAt: new Date().toISOString(),
    };

    await setDoc(ref, payload, { merge: true });
}

export async function getOdooSettings(userId: string): Promise<OdooCredentials | null> {
    const ref = doc(db, "users", userId, "integrations", SETTINGS_DOC);
    const snapshot = await getDoc(ref);

    if (!snapshot.exists()) {
        return null;
    }

    const data = snapshot.data() as OdooSettingsDocument;
    if (!data?.credentials) {
        return null;
    }

    return data.credentials;
}

type SavedBackorderDocument = Omit<SavedBackorder, "id">;

type SalesTargetDocument = Omit<SalesTargetRecord, "id">;

export async function saveBackorderDetails(userId: string, details: BackorderDetails) {
    const ref = doc(db, "users", userId, "backorders", String(details.order.id));

    const payload: SavedBackorderDocument = {
        order_id: details.order.id,
        order_number: details.order.name,
        customer_name: details.order.customer_name,
        order_date: details.order.order_date,
        salesperson_name: details.order.salesperson_name,
        products: details.lines.map((line) => ({
            product_id: line.product_id?.[0] ?? null,
            name: line.name || line.product_id?.[1] || "-",
            ordered_quantity: line.ordered_qty,
            available_quantity: line.available_qty,
            shortage: line.shortage_qty,
            price: line.price_unit,
        })),
        saved_at: new Date().toISOString(),
    };

    await setDoc(ref, payload, { merge: true });
}

export async function getSavedBackorders(userId: string): Promise<SavedBackorder[]> {
    const ref = collection(db, "users", userId, "backorders");
    const snapshot = await getDocs(ref);

    const items: SavedBackorder[] = snapshot.docs.map((item) => {
        const data = item.data() as SavedBackorderDocument;
        return {
            id: item.id,
            ...data,
        };
    });

    items.sort((a, b) => b.saved_at.localeCompare(a.saved_at));
    return items;
}

function getSalesTargetDocId(salespersonId: number, year: number, month: number) {
    return `${salespersonId}_${year}_${String(month).padStart(2, "0")}`;
}

export async function saveSalesTarget(
    input: {
        salespersonId: number;
        salespersonName: string;
        year: number;
        month: number;
        targets: SalesTargetRecord["targets"];
    }
) {
    const docId = getSalesTargetDocId(input.salespersonId, input.year, input.month);
    const ref = doc(db, SALES_TARGETS_COLLECTION, docId);
    const payload: SalesTargetDocument = {
        salespersonId: input.salespersonId,
        salespersonName: input.salespersonName,
        year: input.year,
        month: input.month,
        targets: input.targets,
        updatedAt: new Date().toISOString(),
    };

    await setDoc(ref, payload, { merge: true });
}

export async function markSalesTargetBrandMarketingEmailSent(
    input: {
        salespersonId: number;
        year: number;
        month: number;
        brandId: number;
    }
) {
    const docId = getSalesTargetDocId(input.salespersonId, input.year, input.month);
    const ref = doc(db, SALES_TARGETS_COLLECTION, docId);

    await setDoc(
        ref,
        {
            salespersonId: input.salespersonId,
            year: input.year,
            month: input.month,
            marketingEmailsSentAt: {
                [String(input.brandId)]: new Date().toISOString(),
            },
            updatedAt: new Date().toISOString(),
        },
        { merge: true }
    );
}

export async function getSalesTarget(
    salespersonId: number,
    year: number,
    month: number
): Promise<SalesTargetRecord | null> {
    const docId = getSalesTargetDocId(salespersonId, year, month);
    const ref = doc(db, SALES_TARGETS_COLLECTION, docId);
    const snapshot = await getDoc(ref);

    if (!snapshot.exists()) {
        return null;
    }

    const data = snapshot.data() as SalesTargetDocument;
    const marketingEmailsSentAt =
        data && typeof data.marketingEmailsSentAt === "object" && data.marketingEmailsSentAt
            ? data.marketingEmailsSentAt
            : {};
    const targets =
        Array.isArray(data.targets) && data.targets.length > 0
            ? data.targets
            : Number.isFinite(data.targetAmount)
                ? [
                    {
                        brandId: null,
                        brandName: "General",
                        targetAmount: Number(data.targetAmount),
                        isGeneral: true,
                    },
                ]
                : [];

    return {
        id: snapshot.id,
        ...data,
        marketingEmailsSentAt,
        targets,
    };
}

export async function getAllSalesTargets(): Promise<SalesTargetRecord[]> {
    const ref = collection(db, SALES_TARGETS_COLLECTION);
    const snapshot = await getDocs(ref);

    const items: SalesTargetRecord[] = snapshot.docs.map((item) => {
        const data = item.data() as SalesTargetDocument;
        const marketingEmailsSentAt =
            data && typeof data.marketingEmailsSentAt === "object" && data.marketingEmailsSentAt
                ? data.marketingEmailsSentAt
                : {};
        const targets =
            Array.isArray(data.targets) && data.targets.length > 0
                ? data.targets
                : Number.isFinite(data.targetAmount)
                    ? [
                        {
                            brandId: null,
                            brandName: "General",
                            targetAmount: Number(data.targetAmount),
                            isGeneral: true,
                        },
                    ]
                    : [];

        return {
            id: item.id,
            ...data,
            marketingEmailsSentAt,
            targets,
        };
    });

    items.sort((a, b) => {
        if (a.year !== b.year) {
            return b.year - a.year;
        }

        if (a.month !== b.month) {
            return b.month - a.month;
        }

        return a.salespersonName.localeCompare(b.salespersonName);
    });

    return items;
}
