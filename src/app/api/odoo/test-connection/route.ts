import { NextResponse } from "next/server";
import { getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";

type TestResult = {
    success: boolean;
    uid?: number;
    categoriesFound?: number;
    step?: string;
    error?: string;
};

async function testOdooConnection(credentials: { url: string; db: string; username: string; password: string }): Promise<TestResult> {
    try {
        // Test direct JSON-RPC call
        const response = await fetch(
            `${credentials.url.replace(/\/+$/, "")}/jsonrpc`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    method: "call",
                    params: {
                        service: "common",
                        method: "authenticate",
                        args: [credentials.db, credentials.username, credentials.password, {}],
                    },
                    id: Date.now(),
                }),
            }
        );

        const data = await response.json();

        if (data.error) {
            return {
                success: false,
                step: "authenticate",
                error: data.error.data?.message ?? data.error.message,
            };
        }

        const uid = data.result;
        if (!uid || uid <= 0) {
            return {
                success: false,
                step: "authenticate",
                error: "Invalid user ID returned",
            };
        }

        // Try to list categories
        const catResponse = await fetch(
            `${credentials.url.replace(/\/+$/, "")}/jsonrpc`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    method: "call",
                    params: {
                        service: "object",
                        method: "execute_kw",
                        args: [
                            credentials.db,
                            uid,
                            credentials.password,
                            "product.category",
                            "search",
                            [[]],
                            { limit: 5 },
                        ],
                    },
                    id: Date.now(),
                }),
            }
        );

        const catData = await catResponse.json();

        if (catData.error) {
            return {
                success: false,
                step: "product.category.search",
                error: catData.error.data?.message ?? catData.error.message,
                uid,
            };
        }

        return {
            success: true,
            uid,
            categoriesFound: (catData.result as number[]).length,
        };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

export async function POST(request: Request) {
    try {
        const { credentials } = await getOdooCredentialsFromRequest(request);
        const result = await testOdooConnection(credentials);
        return NextResponse.json(result);
    } catch (error) {
        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : "Failed to test connection",
            },
            { status: 400 }
        );
    }
}
