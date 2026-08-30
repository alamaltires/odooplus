"use client";

import Image from "next/image";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export default function LoginPage() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const { login } = useAuth();
    const router = useRouter();

    async function handleSubmit(event: FormEvent) {
        event.preventDefault();
        setLoading(true);
        setError(null);

        try {
            await login(email, password);
            router.replace("/dashboard");
        } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : "Login failed");
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-(--bg) p-6">
            <div className="pointer-events-none absolute -left-20 top-10 h-64 w-64 rounded-full bg-(--brand-soft) blur-3xl" />
            <div className="pointer-events-none absolute -right-16 bottom-0 h-72 w-72 rounded-full bg-(--mint-soft) blur-3xl" />
            <div className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-linear-to-b from-[rgba(32,98,176,0.08)] to-transparent" />

            <form
                onSubmit={handleSubmit}
                className="relative z-10 w-full max-w-md rounded-3xl border border-(--line) bg-(--card) p-8 shadow-[0_25px_70px_rgba(8,23,41,0.12)]"
            >
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <span className="inline-flex rounded-full bg-[rgba(74,184,72,0.12)] px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-(--accent)">
                            DME Sales Hub
                        </span>
                        <p className="mt-4 font-display text-3xl text-(--brand)">Welcome back</p>
                        <p className="mt-2 text-sm text-(--ink-soft)">Sign in to continue to your Odoo operations workspace.</p>
                    </div>
                    <div className="rounded-2xl border border-[rgba(32,98,176,0.14)] bg-white px-3 py-2 shadow-[0_10px_24px_rgba(32,98,176,0.08)]">
                        <Image src="/applogo.png" alt="DME Sales Hub logo" width={116} height={28} className="h-7 w-auto" priority />
                    </div>
                </div>

                <div className="mt-8 space-y-4">
                    <label className="block text-sm">
                        <span className="mb-1 block text-(--ink-soft)">Email</span>
                        <input
                            type="email"
                            value={email}
                            onChange={(event) => setEmail(event.target.value)}
                            required
                            className="w-full rounded-xl border border-(--line) bg-white px-4 py-2.5 outline-none transition focus:border-(--brand)"
                        />
                    </label>

                    <label className="block text-sm">
                        <span className="mb-1 block text-(--ink-soft)">Password</span>
                        <input
                            type="password"
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            required
                            minLength={6}
                            className="w-full rounded-xl border border-(--line) bg-white px-4 py-2.5 outline-none transition focus:border-(--brand)"
                        />
                    </label>
                </div>

                {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}

                <button
                    type="submit"
                    disabled={loading}
                    className="mt-6 w-full rounded-xl bg-(--brand) px-4 py-2.5 font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
                >
                    {loading ? "Please wait..." : "Sign In"}
                </button>
            </form>
        </div>
    );
}
