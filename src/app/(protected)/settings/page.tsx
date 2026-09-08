"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { getAuth } from "firebase/auth";
import { useAuth } from "@/lib/auth-context";
import { getOdooSettings, saveOdooSettings } from "@/lib/firestore-settings";
import { getSystemOdooSettings, saveSystemOdooSettings } from "@/lib/client-odoo";
import { OdooUserCredentials } from "@/types/odoo";

type Role = "admin" | "purchase" | "salesperson" | "sales_manager" | "store" | "user";

const ROLE_LABELS: Record<Role, string> = {
    admin: "admin",
    purchase: "purchase",
    salesperson: "salesperson",
    sales_manager: "sales manager",
    store: "store",
    user: "user (product requests only)",
};

const initialState: OdooUserCredentials = {
    username: "",
    password: "",
};

const initialSystemState = { url: "", db: "" };

export default function SettingsPage() {
    const { user, role } = useAuth();
    const [values, setValues] = useState<OdooUserCredentials>(initialState);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<string | null>(null);

    const [systemValues, setSystemValues] = useState(initialSystemState);
    const [systemLoading, setSystemLoading] = useState(false);
    const [systemSaving, setSystemSaving] = useState(false);
    const [systemMessage, setSystemMessage] = useState<string | null>(null);

    const [users, setUsers] = useState<Array<{ id: string; email: string; role: Role; createdAt: string | null }>>([]);
    const [usersLoading, setUsersLoading] = useState(false);
    const [usersMessage, setUsersMessage] = useState<string | null>(null);
    const [creatingUser, setCreatingUser] = useState(false);
    const [newUser, setNewUser] = useState({
        email: "",
        password: "",
        role: "purchase" as Role,
    });

    const getBearerToken = useCallback(async () => {
        const auth = getAuth();
        const current = auth.currentUser;
        if (!current) {
            throw new Error("User not authenticated");
        }

        return current.getIdToken();
    }, []);

    const loadUsers = useCallback(async () => {
        setUsersLoading(true);
        setUsersMessage(null);

        try {
            const token = await getBearerToken();
            const response = await fetch("/api/users", {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });

            const result = (await response.json()) as {
                users?: Array<{ id: string; email: string; role: Role; createdAt: string | null }>;
                error?: string;
            };

            if (!response.ok || result.error) {
                throw new Error(result.error ?? "Failed to load users.");
            }

            setUsers(result.users ?? []);
        } catch (error) {
            setUsersMessage(error instanceof Error ? error.message : "Failed to load users.");
        } finally {
            setUsersLoading(false);
        }
    }, [getBearerToken]);

    useEffect(() => {
        async function loadSettings() {
            if (!user) {
                setLoading(false);
                return;
            }

            try {
                const saved = await getOdooSettings(user.uid);
                if (saved) {
                    setValues(saved);
                }
            } catch (error) {
                setMessage(
                    error instanceof Error
                        ? `Failed to load settings: ${error.message}`
                        : "Failed to load settings."
                );
            } finally {
                setLoading(false);
            }
        }

        void loadSettings();
    }, [user]);

    useEffect(() => {
        if (!user || role !== "admin") {
            return;
        }

        void loadUsers();

        async function loadSystemSettings() {
            setSystemLoading(true);
            setSystemMessage(null);
            try {
                const data = await getSystemOdooSettings();
                if (data.settings) {
                    setSystemValues(data.settings);
                }
            } catch (error) {
                setSystemMessage(error instanceof Error ? error.message : "Failed to load system settings.");
            } finally {
                setSystemLoading(false);
            }
        }

        void loadSystemSettings();
    }, [user, role, loadUsers]);

    async function handleSubmit(event: FormEvent) {
        event.preventDefault();
        if (!user) {
            return;
        }

        setSaving(true);
        setMessage(null);

        try {
            await saveOdooSettings(user.uid, values);
            setMessage("Settings saved successfully.");
        } catch (error) {
            setMessage(error instanceof Error ? error.message : "Failed to save settings.");
        } finally {
            setSaving(false);
        }
    }

    async function handleSystemSubmit(event: FormEvent) {
        event.preventDefault();

        setSystemSaving(true);
        setSystemMessage(null);

        try {
            await saveSystemOdooSettings(systemValues);
            setSystemMessage("System Odoo connection saved successfully.");
        } catch (error) {
            setSystemMessage(error instanceof Error ? error.message : "Failed to save system settings.");
        } finally {
            setSystemSaving(false);
        }
    }

    if (loading) {
        return <p>Loading settings...</p>;
    }

    async function handleCreateUser(event: FormEvent) {
        event.preventDefault();
        setCreatingUser(true);
        setUsersMessage(null);

        try {
            const token = await getBearerToken();
            const response = await fetch("/api/users", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify(newUser),
            });

            const result = (await response.json()) as { error?: string };
            if (!response.ok || result.error) {
                throw new Error(result.error ?? "Failed to create user.");
            }

            setUsersMessage("User created successfully.");
            setNewUser({ email: "", password: "", role: "purchase" });
            await loadUsers();
        } catch (error) {
            setUsersMessage(error instanceof Error ? error.message : "Failed to create user.");
        } finally {
            setCreatingUser(false);
        }
    }

    return (
        <section className="max-w-5xl space-y-6">
            {role === "admin" ? (
                <article className="rounded-3xl border border-(--line) bg-(--card) p-6">
                    <h1 className="font-display text-2xl">System Odoo Connection</h1>
                    <p className="mt-1 text-sm text-(--ink-soft)">
                        The Odoo URL and Database are shared by every user in this app — set them once here. Each
                        user still logs in with their own username and password below.
                    </p>

                    <form onSubmit={handleSystemSubmit} className="mt-6 grid gap-4 sm:grid-cols-2">
                        <label className="sm:col-span-2">
                            <span className="mb-1 block text-sm text-(--ink-soft)">Odoo URL</span>
                            <input
                                value={systemValues.url}
                                onChange={(event) => setSystemValues((prev) => ({ ...prev, url: event.target.value }))}
                                placeholder="https://your-odoo-instance.com"
                                required
                                disabled={systemLoading}
                                className="w-full rounded-xl border border-(--line) bg-white px-4 py-2.5 disabled:opacity-60"
                            />
                        </label>

                        <label className="sm:col-span-2">
                            <span className="mb-1 block text-sm text-(--ink-soft)">Database</span>
                            <input
                                value={systemValues.db}
                                onChange={(event) => setSystemValues((prev) => ({ ...prev, db: event.target.value }))}
                                required
                                disabled={systemLoading}
                                className="w-full rounded-xl border border-(--line) bg-white px-4 py-2.5 disabled:opacity-60"
                            />
                        </label>

                        <button
                            type="submit"
                            disabled={systemSaving || systemLoading}
                            className="sm:col-span-2 rounded-xl bg-(--brand) px-4 py-2.5 font-medium text-white disabled:cursor-not-allowed disabled:opacity-70"
                        >
                            {systemSaving ? "Saving..." : "Save System Settings"}
                        </button>
                    </form>

                    {systemMessage ? <p className="mt-4 text-sm text-(--ink-soft)">{systemMessage}</p> : null}
                </article>
            ) : null}

            <article className="rounded-3xl border border-(--line) bg-(--card) p-6">
                <h1 className="font-display text-2xl">Your Odoo Login</h1>
                <p className="mt-1 text-sm text-(--ink-soft)">
                    Save your own Odoo username and password to use dashboard features. The URL and Database are
                    configured system-wide by an admin.
                </p>

                <form onSubmit={handleSubmit} className="mt-6 grid gap-4 sm:grid-cols-2">
                    <label>
                        <span className="mb-1 block text-sm text-(--ink-soft)">Username</span>
                        <input
                            value={values.username}
                            onChange={(event) =>
                                setValues((prev) => ({ ...prev, username: event.target.value }))
                            }
                            required
                            className="w-full rounded-xl border border-(--line) bg-white px-4 py-2.5"
                        />
                    </label>

                    <label>
                        <span className="mb-1 block text-sm text-(--ink-soft)">Password</span>
                        <input
                            type="password"
                            value={values.password}
                            onChange={(event) =>
                                setValues((prev) => ({ ...prev, password: event.target.value }))
                            }
                            required
                            className="w-full rounded-xl border border-(--line) bg-white px-4 py-2.5"
                        />
                    </label>

                    <button
                        type="submit"
                        disabled={saving}
                        className="sm:col-span-2 rounded-xl bg-(--brand) px-4 py-2.5 font-medium text-white"
                    >
                        {saving ? "Saving..." : "Save Settings"}
                    </button>
                </form>

                {message ? <p className="mt-4 text-sm text-(--ink-soft)">{message}</p> : null}
            </article>

            {role === "admin" ? (
                <article className="rounded-3xl border border-(--line) bg-(--card) p-6">
                    <h2 className="font-display text-2xl">User Management</h2>
                    <p className="mt-1 text-sm text-(--ink-soft)">
                        List users from Firestore and create new users with login credentials.
                    </p>

                    <form onSubmit={handleCreateUser} className="mt-5 grid gap-4 md:grid-cols-4">
                        <label className="md:col-span-2">
                            <span className="mb-1 block text-sm text-(--ink-soft)">Email</span>
                            <input
                                type="email"
                                value={newUser.email}
                                onChange={(event) => setNewUser((prev) => ({ ...prev, email: event.target.value }))}
                                required
                                className="w-full rounded-xl border border-(--line) bg-white px-4 py-2.5"
                            />
                        </label>
                        <label>
                            <span className="mb-1 block text-sm text-(--ink-soft)">Password</span>
                            <input
                                type="password"
                                value={newUser.password}
                                onChange={(event) => setNewUser((prev) => ({ ...prev, password: event.target.value }))}
                                required
                                minLength={6}
                                className="w-full rounded-xl border border-(--line) bg-white px-4 py-2.5"
                            />
                        </label>
                        <label>
                            <span className="mb-1 block text-sm text-(--ink-soft)">Role</span>
                            <select
                                value={newUser.role}
                                onChange={(event) =>
                                    setNewUser((prev) => ({ ...prev, role: event.target.value as Role }))
                                }
                                className="w-full rounded-xl border border-(--line) bg-white px-4 py-2.5"
                            >
                                <option value="purchase">Purchase</option>
                                <option value="salesperson">Salesperson</option>
                                <option value="sales_manager">Sales Manager</option>
                                <option value="store">Store</option>
                                <option value="user">User (Product Requests only)</option>
                                <option value="admin">Admin</option>
                            </select>
                        </label>

                        <button
                            type="submit"
                            disabled={creatingUser}
                            className="md:col-span-4 rounded-xl bg-(--brand) px-4 py-2.5 font-medium text-white disabled:cursor-not-allowed disabled:opacity-70"
                        >
                            {creatingUser ? "Creating user..." : "Add User"}
                        </button>
                    </form>

                    {usersMessage ? <p className="mt-4 text-sm text-(--ink-soft)">{usersMessage}</p> : null}

                    <div className="mt-5 overflow-hidden rounded-xl border border-(--line)">
                        <table className="w-full border-collapse text-left text-sm">
                            <thead className="bg-(--chip) text-(--ink-soft)">
                                <tr>
                                    <th className="px-4 py-3 font-medium">Email</th>
                                    <th className="px-4 py-3 font-medium">Role</th>
                                    <th className="px-4 py-3 font-medium">Created At</th>
                                </tr>
                            </thead>
                            <tbody>
                                {users.map((item) => (
                                    <tr key={item.id} className="border-t border-(--line)">
                                        <td className="px-4 py-3">{item.email || "-"}</td>
                                        <td className="px-4 py-3 uppercase">{ROLE_LABELS[item.role] ?? item.role}</td>
                                        <td className="px-4 py-3">{item.createdAt ? item.createdAt.slice(0, 10) : "-"}</td>
                                    </tr>
                                ))}
                                {!usersLoading && users.length === 0 ? (
                                    <tr>
                                        <td className="px-4 py-3 text-(--ink-soft)" colSpan={3}>
                                            No users found in Firestore users collection.
                                        </td>
                                    </tr>
                                ) : null}
                                {usersLoading ? (
                                    <tr>
                                        <td className="px-4 py-3 text-(--ink-soft)" colSpan={3}>
                                            Loading users...
                                        </td>
                                    </tr>
                                ) : null}
                            </tbody>
                        </table>
                    </div>
                </article>
            ) : null}
        </section>
    );
}
