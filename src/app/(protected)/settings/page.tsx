"use client";

import { FormEvent, ReactNode, useCallback, useEffect, useState } from "react";
import { getAuth } from "firebase/auth";
import { Pencil, Shield, Trash2, X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { getOdooSettings, saveOdooSettings } from "@/lib/firestore-settings";
import { getSystemOdooSettings, saveSystemOdooSettings } from "@/lib/client-odoo";
import { OdooUserCredentials } from "@/types/odoo";
import { APP_DEFINITIONS, defaultAppHrefsForRole } from "@/lib/app-permissions";

type Role = "admin" | "purchase" | "salesperson" | "sales_manager" | "store" | "user";

const ROLE_LABELS: Record<Role, string> = {
    admin: "admin",
    purchase: "purchase",
    salesperson: "salesperson",
    sales_manager: "sales manager",
    store: "store",
    user: "user (product requests only)",
};

type UserRow = { id: string; email: string; role: Role; createdAt: string | null; enabledApps: string[] | null };

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

    const [users, setUsers] = useState<UserRow[]>([]);
    const [usersLoading, setUsersLoading] = useState(false);
    const [usersMessage, setUsersMessage] = useState<string | null>(null);
    const [creatingUser, setCreatingUser] = useState(false);
    const [newUser, setNewUser] = useState({
        email: "",
        password: "",
        role: "purchase" as Role,
    });

    const [permissionsUser, setPermissionsUser] = useState<UserRow | null>(null);
    const [permissionsSelection, setPermissionsSelection] = useState<string[]>([]);
    const [permissionsSaving, setPermissionsSaving] = useState(false);
    const [permissionsError, setPermissionsError] = useState<string | null>(null);

    const [editingUser, setEditingUser] = useState<UserRow | null>(null);
    const [editForm, setEditForm] = useState({ email: "", role: "purchase" as Role, password: "" });
    const [editSaving, setEditSaving] = useState(false);
    const [editError, setEditError] = useState<string | null>(null);

    const [deletingUser, setDeletingUser] = useState<UserRow | null>(null);
    const [deleteSaving, setDeleteSaving] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);

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
                users?: UserRow[];
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

    function openPermissions(target: UserRow) {
        setPermissionsUser(target);
        setPermissionsSelection(target.enabledApps ?? defaultAppHrefsForRole(target.role));
        setPermissionsError(null);
    }

    function togglePermissionApp(href: string) {
        setPermissionsSelection((current) =>
            current.includes(href) ? current.filter((item) => item !== href) : [...current, href]
        );
    }

    async function savePermissions(enabledApps: string[] | null) {
        if (!permissionsUser) return;

        setPermissionsSaving(true);
        setPermissionsError(null);

        try {
            const token = await getBearerToken();
            const response = await fetch(`/api/users/${permissionsUser.id}`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ enabledApps }),
            });

            const result = (await response.json()) as { error?: string };
            if (!response.ok || result.error) {
                throw new Error(result.error ?? "Failed to update permissions.");
            }

            setPermissionsUser(null);
            await loadUsers();
        } catch (error) {
            setPermissionsError(error instanceof Error ? error.message : "Failed to update permissions.");
        } finally {
            setPermissionsSaving(false);
        }
    }

    function openEdit(target: UserRow) {
        setEditingUser(target);
        setEditForm({ email: target.email, role: target.role, password: "" });
        setEditError(null);
    }

    async function handleSaveEdit(event: FormEvent) {
        event.preventDefault();
        if (!editingUser) return;

        setEditSaving(true);
        setEditError(null);

        try {
            const token = await getBearerToken();
            const response = await fetch(`/api/users/${editingUser.id}`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    email: editForm.email,
                    role: editForm.role,
                    password: editForm.password || undefined,
                }),
            });

            const result = (await response.json()) as { error?: string };
            if (!response.ok || result.error) {
                throw new Error(result.error ?? "Failed to update user.");
            }

            setEditingUser(null);
            await loadUsers();
        } catch (error) {
            setEditError(error instanceof Error ? error.message : "Failed to update user.");
        } finally {
            setEditSaving(false);
        }
    }

    async function handleConfirmDelete() {
        if (!deletingUser) return;

        setDeleteSaving(true);
        setDeleteError(null);

        try {
            const token = await getBearerToken();
            const response = await fetch(`/api/users/${deletingUser.id}`, {
                method: "DELETE",
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });

            const result = (await response.json()) as { error?: string };
            if (!response.ok || result.error) {
                throw new Error(result.error ?? "Failed to delete user.");
            }

            setDeletingUser(null);
            await loadUsers();
        } catch (error) {
            setDeleteError(error instanceof Error ? error.message : "Failed to delete user.");
        } finally {
            setDeleteSaving(false);
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
                                    <th className="px-4 py-3 font-medium">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {users.map((item) => (
                                    <tr key={item.id} className="border-t border-(--line)">
                                        <td className="px-4 py-3">{item.email || "-"}</td>
                                        <td className="px-4 py-3 uppercase">{ROLE_LABELS[item.role] ?? item.role}</td>
                                        <td className="px-4 py-3">{item.createdAt ? item.createdAt.slice(0, 10) : "-"}</td>
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-1.5">
                                                <button
                                                    type="button"
                                                    onClick={() => openPermissions(item)}
                                                    disabled={item.role === "admin"}
                                                    title={item.role === "admin" ? "Admins always have full access" : "Manage app permissions"}
                                                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-(--line) bg-white text-(--brand) hover:bg-(--chip) disabled:cursor-not-allowed disabled:opacity-40"
                                                >
                                                    <Shield className="h-4 w-4" aria-hidden="true" />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => openEdit(item)}
                                                    title="Edit user"
                                                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-(--line) bg-white text-(--ink) hover:bg-(--chip)"
                                                >
                                                    <Pencil className="h-4 w-4" aria-hidden="true" />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setDeletingUser(item);
                                                        setDeleteError(null);
                                                    }}
                                                    disabled={item.id === user?.uid}
                                                    title={item.id === user?.uid ? "You cannot delete your own account" : "Delete user"}
                                                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-(--line) bg-white text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                                                >
                                                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                                {!usersLoading && users.length === 0 ? (
                                    <tr>
                                        <td className="px-4 py-3 text-(--ink-soft)" colSpan={4}>
                                            No users found in Firestore users collection.
                                        </td>
                                    </tr>
                                ) : null}
                                {usersLoading ? (
                                    <tr>
                                        <td className="px-4 py-3 text-(--ink-soft)" colSpan={4}>
                                            Loading users...
                                        </td>
                                    </tr>
                                ) : null}
                            </tbody>
                        </table>
                    </div>
                </article>
            ) : null}

            {permissionsUser ? (
                <PermissionsModal
                    target={permissionsUser}
                    selection={permissionsSelection}
                    onToggle={togglePermissionApp}
                    saving={permissionsSaving}
                    error={permissionsError}
                    onSave={() => void savePermissions(permissionsSelection)}
                    onReset={() => void savePermissions(null)}
                    onClose={() => setPermissionsUser(null)}
                />
            ) : null}

            {editingUser ? (
                <EditUserModal
                    target={editingUser}
                    form={editForm}
                    onChange={setEditForm}
                    saving={editSaving}
                    error={editError}
                    onSubmit={handleSaveEdit}
                    onClose={() => setEditingUser(null)}
                />
            ) : null}

            {deletingUser ? (
                <DeleteUserModal
                    target={deletingUser}
                    saving={deleteSaving}
                    error={deleteError}
                    onConfirm={() => void handleConfirmDelete()}
                    onClose={() => setDeletingUser(null)}
                />
            ) : null}
        </section>
    );
}

function ModalShell({
    title,
    subtitle,
    onClose,
    children,
}: {
    title: string;
    subtitle?: string;
    onClose: () => void;
    children: ReactNode;
}) {
    useEffect(() => {
        function onKeyDown(event: KeyboardEvent) {
            if (event.key === "Escape") {
                onClose();
            }
        }
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [onClose]);

    return (
        <div
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
            onClick={onClose}
        >
            <div
                className="w-full max-w-lg rounded-2xl border border-(--line) bg-(--card) shadow-xl"
                onClick={(event) => event.stopPropagation()}
            >
                <header className="flex items-start justify-between gap-4 border-b border-(--line) px-5 py-4">
                    <div>
                        <h2 className="font-display text-xl">{title}</h2>
                        {subtitle ? <p className="mt-0.5 text-xs text-(--ink-soft)">{subtitle}</p> : null}
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close"
                        className="cursor-pointer rounded-lg p-1 text-(--ink-soft) hover:bg-(--chip)"
                    >
                        <X className="h-5 w-5" aria-hidden="true" />
                    </button>
                </header>
                <div className="px-5 py-4">{children}</div>
            </div>
        </div>
    );
}

function PermissionsModal({
    target,
    selection,
    onToggle,
    saving,
    error,
    onSave,
    onReset,
    onClose,
}: {
    target: UserRow;
    selection: string[];
    onToggle: (href: string) => void;
    saving: boolean;
    error: string | null;
    onSave: () => void;
    onReset: () => void;
    onClose: () => void;
}) {
    const isOverride = target.enabledApps !== null;

    return (
        <ModalShell title="App Permissions" subtitle={target.email} onClose={onClose}>
            <p className="text-sm text-(--ink-soft)">
                Choose which apps {target.email} can access. This overrides the default apps for the{" "}
                <span className="font-medium">{ROLE_LABELS[target.role] ?? target.role}</span> role.
            </p>

            <div className="mt-4 space-y-1.5">
                {APP_DEFINITIONS.map((app) => (
                    <label
                        key={app.href}
                        className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-(--chip)"
                    >
                        <input
                            type="checkbox"
                            checked={selection.includes(app.href)}
                            onChange={() => onToggle(app.href)}
                            className="h-4 w-4 rounded border-(--line)"
                        />
                        <span className="text-sm">{app.label}</span>
                    </label>
                ))}
            </div>

            {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

            <div className="mt-5 flex flex-wrap items-center gap-2.5">
                <button
                    type="button"
                    onClick={onSave}
                    disabled={saving}
                    className="rounded-xl bg-(--brand) px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-70"
                >
                    {saving ? "Saving..." : "Save Permissions"}
                </button>
                <button
                    type="button"
                    onClick={onReset}
                    disabled={saving || !isOverride}
                    title={isOverride ? "Revert to the role's default apps" : "Already using role defaults"}
                    className="rounded-xl border border-(--line) bg-white px-4 py-2 text-sm font-medium text-(--ink) disabled:cursor-not-allowed disabled:opacity-50"
                >
                    Reset to Role Default
                </button>
            </div>
        </ModalShell>
    );
}

function EditUserModal({
    target,
    form,
    onChange,
    saving,
    error,
    onSubmit,
    onClose,
}: {
    target: UserRow;
    form: { email: string; role: Role; password: string };
    onChange: (next: { email: string; role: Role; password: string }) => void;
    saving: boolean;
    error: string | null;
    onSubmit: (event: FormEvent) => void;
    onClose: () => void;
}) {
    return (
        <ModalShell title="Edit User" subtitle={target.email} onClose={onClose}>
            <form onSubmit={onSubmit} className="space-y-4">
                <label className="block">
                    <span className="mb-1 block text-sm text-(--ink-soft)">Email</span>
                    <input
                        type="email"
                        value={form.email}
                        onChange={(event) => onChange({ ...form, email: event.target.value })}
                        required
                        className="w-full rounded-xl border border-(--line) bg-white px-4 py-2.5"
                    />
                </label>

                <label className="block">
                    <span className="mb-1 block text-sm text-(--ink-soft)">Role</span>
                    <select
                        value={form.role}
                        onChange={(event) => onChange({ ...form, role: event.target.value as Role })}
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

                <label className="block">
                    <span className="mb-1 block text-sm text-(--ink-soft)">New Password (optional)</span>
                    <input
                        type="password"
                        value={form.password}
                        onChange={(event) => onChange({ ...form, password: event.target.value })}
                        minLength={6}
                        placeholder="Leave blank to keep current password"
                        className="w-full rounded-xl border border-(--line) bg-white px-4 py-2.5"
                    />
                </label>

                {error ? <p className="text-sm text-red-600">{error}</p> : null}

                <button
                    type="submit"
                    disabled={saving}
                    className="w-full rounded-xl bg-(--brand) px-4 py-2.5 font-medium text-white disabled:cursor-not-allowed disabled:opacity-70"
                >
                    {saving ? "Saving..." : "Save Changes"}
                </button>
            </form>
        </ModalShell>
    );
}

function DeleteUserModal({
    target,
    saving,
    error,
    onConfirm,
    onClose,
}: {
    target: UserRow;
    saving: boolean;
    error: string | null;
    onConfirm: () => void;
    onClose: () => void;
}) {
    return (
        <ModalShell title="Delete User" onClose={onClose}>
            <p className="text-sm">
                Are you sure you want to delete <span className="font-medium">{target.email}</span>? This removes
                their login and profile permanently and cannot be undone.
            </p>

            {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

            <div className="mt-5 flex items-center gap-2.5">
                <button
                    type="button"
                    onClick={onConfirm}
                    disabled={saving}
                    className="rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-70"
                >
                    {saving ? "Deleting..." : "Delete User"}
                </button>
                <button
                    type="button"
                    onClick={onClose}
                    disabled={saving}
                    className="rounded-xl border border-(--line) bg-white px-4 py-2 text-sm font-medium text-(--ink)"
                >
                    Cancel
                </button>
            </div>
        </ModalShell>
    );
}
