"use client";

import { useState } from "react";
import { getAuth } from "firebase/auth";
import { AlertCircle, CheckCircle } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

type TestResult = {
    success: boolean;
    uid?: number;
    categoriesFound?: number;
    step?: string;
    error?: string;
};

export default function TestConnectionPage() {
    const { user } = useAuth();
    const [testing, setTesting] = useState(false);
    const [result, setResult] = useState<TestResult | null>(null);

    async function handleTest() {
        if (!user) {
            setResult({
                success: false,
                error: "You must be logged in to test the connection",
            });
            return;
        }

        setTesting(true);
        setResult(null);

        try {
            const auth = getAuth();
            const token = await auth.currentUser?.getIdToken();

            if (!token) {
                setResult({
                    success: false,
                    error: "Could not get authentication token",
                });
                return;
            }

            const response = await fetch("/api/odoo/test-connection", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
            });

            const data = await response.json();
            setResult(data);
        } catch (error) {
            setResult({
                success: false,
                error: error instanceof Error ? error.message : "Network error",
            });
        } finally {
            setTesting(false);
        }
    }

    return (
        <section className="max-w-2xl">
            <h1 className="font-display text-3xl">Odoo Connection Test</h1>
            <p className="mt-1 text-sm text-(--ink-soft)">
                Run a quick diagnostic to verify your Odoo credentials are working correctly.
            </p>

            <div className="mt-6 rounded-2xl border border-(--line) bg-(--card) p-5">
                <button
                    onClick={handleTest}
                    disabled={testing}
                    className="rounded-xl bg-(--brand) px-5 py-2 text-sm font-medium text-white disabled:opacity-70"
                >
                    {testing ? "Testing Connection..." : "Test Connection"}
                </button>
            </div>

            {result ? (
                <div
                    className={`mt-6 rounded-2xl border p-5 ${result.success
                        ? "border-green-200 bg-green-50"
                        : "border-red-200 bg-red-50"
                        }`}
                >
                    <div className="flex gap-3">
                        {result.success ? (
                            <CheckCircle className="h-6 w-6 flex-shrink-0 text-green-600" />
                        ) : (
                            <AlertCircle className="h-6 w-6 flex-shrink-0 text-red-600" />
                        )}
                        <div>
                            <p
                                className={`font-medium ${result.success ? "text-green-900" : "text-red-900"
                                    }`}
                            >
                                {result.success
                                    ? "✓ Connection Successful"
                                    : "✗ Connection Failed"}
                            </p>
                            <p
                                className={`mt-1 text-sm ${result.success
                                    ? "text-green-700"
                                    : "text-red-700"
                                    }`}
                            >
                                {result.success ? (
                                    <>
                                        User ID: <strong>{result.uid}</strong>
                                        <br />
                                        Product Categories Found:{" "}
                                        <strong>{result.categoriesFound}</strong>
                                    </>
                                ) : (
                                    <>
                                        <strong>Error at step:</strong>{" "}
                                        {result.step || "initial"}
                                        <br />
                                        <strong>Details:</strong>{" "}
                                        {result.error}
                                    </>
                                )}
                            </p>
                        </div>
                    </div>
                </div>
            ) : null}

            <div className="mt-8 rounded-2xl border border-(--line) bg-(--card) p-5">
                <h2 className="font-display text-lg">Troubleshooting</h2>
                <ul className="mt-4 space-y-2 text-sm text-(--ink-soft)">
                    <li>
                        ✓ Make sure your credentials are saved in
                        <span className="font-medium text-(--ink)"> Settings</span>
                    </li>
                    <li>
                        ✓ Verify your Odoo user account exists and is active
                    </li>
                    <li>
                        ✓ Confirm your account has admin or appropriate module
                        access (Sales, Inventory, Stock)
                    </li>
                    <li>
                        ✓ Check your Odoo URL is correct (e.g.,
                        https://your-instance.odoo.com)
                    </li>
                    <li>
                        ✓ Ensure there are no IP restrictions on your Odoo
                        instance
                    </li>
                </ul>
            </div>
        </section>
    );
}
