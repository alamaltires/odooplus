import { NextResponse } from "next/server";
import { getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";
import {
    beginBackorderConversion,
    completeBackorderConversion,
    failBackorderConversion,
    markBackorderAsProcced,
} from "@/lib/server/backorders-store";

interface ConvertRequestBody {
    orderId: number;
    orderName: string;
    customerId: string;
    salespersonName: string;
    lines: Array<{
        productId?: number;
        quantity: number;
        unitPrice: number;
    }>;
}

// Simple Odoo JSON-RPC call (similar to what exists in odoo-client.ts)
async function jsonRpc<T>(
    baseUrl: string,
    payload: {
        service: "common" | "object";
        method: string;
        args: unknown[];
    }
): Promise<T> {
    const endpoint = `${baseUrl.replace(/\/+$/, "")}/jsonrpc`;
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

    const data = (await response.json()) as {
        error?: { message: string };
        result?: T;
    };

    if (data.error) {
        throw new Error(`Odoo error: ${data.error.message}`);
    }

    return data.result as T;
}

async function authenticate(url: string, db: string, username: string, password: string) {
    return jsonRpc<number>(url, {
        service: "common",
        method: "authenticate",
        args: [db, username, password, {}],
    });
}

async function executeKw<T>(
    url: string,
    uid: number,
    password: string,
    db: string,
    model: string,
    method: string,
    args: unknown[] = [],
    kwargs: Record<string, unknown> = {}
) {
    return jsonRpc<T>(url, {
        service: "object",
        method: "execute_kw",
        args: [db, uid, password, model, method, args, kwargs],
    });
}

export async function POST(request: Request) {
    let body: ConvertRequestBody | null = null;
    let salesOrderId: number | null = null;

    try {
        body = (await request.json()) as ConvertRequestBody;
        const { credentials } = await getOdooCredentialsFromRequest(request);

        if (!credentials) {
            throw new Error("Odoo credentials not configured.");
        }

        await beginBackorderConversion(String(body.orderId));

        const { customerId, salespersonName, lines } = body;

        // Authenticate with Odoo
        const uid = await authenticate(credentials.url, credentials.db, credentials.username, credentials.password);

        // Find customer ID by name
        const customers = await executeKw<Array<{ id: number; name: string }>>(
            credentials.url,
            uid,
            credentials.password,
            credentials.db,
            "res.partner",
            "search_read",
            [[["name", "=", customerId]]],
            { fields: ["id", "name"], limit: 1 }
        );

        if (customers.length === 0) {
            throw new Error(`Customer "${customerId}" not found in Odoo.`);
        }

        const customerOdooId = customers[0].id;

        // Find salesperson ID by name
        const users = await executeKw<Array<{ id: number; name: string }>>(
            credentials.url,
            uid,
            credentials.password,
            credentials.db,
            "res.users",
            "search_read",
            [[["name", "=", salespersonName]]],
            { fields: ["id", "name"], limit: 1 }
        );

        const salespersonId = users.length > 0 ? users[0].id : uid;

        // Create sale order
        const orderData: Record<string, unknown> = {
            partner_id: customerOdooId,
            user_id: salespersonId,
        };

        salesOrderId = await executeKw<number>(
            credentials.url,
            uid,
            credentials.password,
            credentials.db,
            "sale.order",
            "create",
            [orderData]
        );

        // Add order lines
        for (const line of lines) {
            if (!line.productId) {
                continue;
            }

            const quantity = Number(line.quantity ?? 0);
            if (!Number.isFinite(quantity) || quantity <= 0) {
                continue;
            }

            const lineData = {
                product_id: line.productId,
                product_uom_qty: quantity,
                price_unit: line.unitPrice,
            };

            await executeKw<number>(
                credentials.url,
                uid,
                credentials.password,
                credentials.db,
                "sale.order.line",
                "create",
                [{ ...lineData, order_id: salesOrderId }]
            );
        }

        await completeBackorderConversion(String(body.orderId), salesOrderId);
        await markBackorderAsProcced(String(body.orderId));

        return NextResponse.json({
            success: true,
            message: "Sales order created successfully in Odoo.",
            salesOrderId,
        });
    } catch (error) {
        if (body) {
            await failBackorderConversion(String(body.orderId), {
                error: error instanceof Error ? error.message : "Failed to convert to sales order.",
                salesOrderId: salesOrderId ?? undefined,
            }).catch(() => undefined);
        }

        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : "Failed to convert to sales order.",
            },
            { status: 400 }
        );
    }
}
