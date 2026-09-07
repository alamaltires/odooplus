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

export type UserRole = "admin" | "purchase" | "salesperson" | "sales_manager" | "store" | "user";

type AuthContextValue = {
    user: User | null;
    role: UserRole;
    loading: boolean;
    login: (email: string, password: string) => Promise<void>;
    register: (email: string, password: string) => Promise<void>;
    logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [role, setRole] = useState<UserRole>("user");
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
            setLoading(true);
            setUser(nextUser);

            if (!nextUser) {
                setRole("user");
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
            } catch {
                setRole("user");
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
            loading,
            login: async (email, password) => {
                await signInWithEmailAndPassword(auth, email, password);
            },
            register: async (email, password) => {
                await createUserWithEmailAndPassword(auth, email, password);
            },
            logout: async () => {
                await signOut(auth);
            },
        }),
        [user, role, loading]
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
