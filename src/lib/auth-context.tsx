"use client";

import {
    createContext,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from "react";
import {
    onAuthStateChanged,
    signOut,
    User,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth } from "@/lib/firebase";
import { db } from "@/lib/firebase";
import { syncOdooSettingsFromLogin } from "@/lib/firestore-settings";

export type UserRole = "admin" | "purchase" | "salesperson" | "sales_manager" | "store" | "user";

type AuthContextValue = {
    user: User | null;
    role: UserRole;
    /**
     * Per-user override of which sidebar apps are visible, set via the
     * permissions modal in Settings. `null` means no override is
     * configured — the role's own default set applies (see
     * `defaultAppHrefsForRole` in `@/lib/app-permissions`).
     */
    enabledApps: string[] | null;
    loading: boolean;
    login: (email: string, password: string) => Promise<void>;
    register: (email: string, password: string) => Promise<void>;
    logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/**
 * Every OdooPlus account connects to Odoo as itself, using the same email and
 * password it signs in with, so the data it sees is exactly what that Odoo
 * user's own access rights allow. Mirroring the credentials here is what keeps
 * the two in step — an account whose app password no longer matches its Odoo
 * password gets `Authentication failed` from every Odoo-backed screen.
 *
 * Never allowed to break sign-in: a failed mirror (offline, Firestore rules)
 * only means the previously stored credentials stay in place.
 */
async function mirrorLoginToOdoo(userId: string, email: string, password: string) {
    try {
        await syncOdooSettingsFromLogin(userId, email.trim().toLowerCase(), password);
    } catch {
        // Ignored on purpose — see above.
    }
}

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [role, setRole] = useState<UserRole>("user");
    const [enabledApps, setEnabledApps] = useState<string[] | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
            setLoading(true);
            setUser(nextUser);

            if (!nextUser) {
                setRole("user");
                setEnabledApps(null);
                setLoading(false);
                return;
            }

            try {
                const snapshot = await getDoc(doc(db, "users", nextUser.uid));
                const nextRole = String(snapshot.data()?.role ?? "user").toLowerCase();

                if (
                    nextRole === "admin" ||
                    nextRole === "purchase" ||
                    nextRole === "salesperson" ||
                    nextRole === "sales_manager" ||
                    nextRole === "store"
                ) {
                    setRole(nextRole);
                } else {
                    setRole("user");
                }

                const rawEnabledApps = snapshot.data()?.enabledApps;
                setEnabledApps(
                    Array.isArray(rawEnabledApps) ? rawEnabledApps.filter((item): item is string => typeof item === "string") : null
                );
            } catch {
                setRole("user");
                setEnabledApps(null);
            } finally {
                setLoading(false);
            }
        });

        return unsubscribe;
    }, []);

    const value = useMemo<AuthContextValue>(
        () => ({
            user,
            role,
            enabledApps,
            loading,
            login: async (email, password) => {
                const credential = await signInWithEmailAndPassword(auth, email, password);
                await mirrorLoginToOdoo(credential.user.uid, email, password);
            },
            register: async (email, password) => {
                const credential = await createUserWithEmailAndPassword(auth, email, password);
                await mirrorLoginToOdoo(credential.user.uid, email, password);
            },
            logout: async () => {
                await signOut(auth);
            },
        }),
        [user, role, enabledApps, loading]
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error("useAuth must be used within AuthProvider");
    }
    return context;
}
