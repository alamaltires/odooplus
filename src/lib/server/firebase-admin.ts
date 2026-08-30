import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { Firestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { App } from "firebase-admin/app";
import { Auth } from "firebase-admin/auth";

type ServiceAccount = {
    project_id: string;
    client_email: string;
    private_key: string;
};

function getServiceAccount(): ServiceAccount {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    if (!raw) {
        throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY is missing.");
    }

    const parsed = JSON.parse(raw) as ServiceAccount;

    return {
        project_id: parsed.project_id,
        client_email: parsed.client_email,
        private_key: parsed.private_key.replace(/\\n/g, "\n"),
    };
}

let cachedDb: Firestore | null = null;
let cachedApp: App | null = null;
let cachedAuth: Auth | null = null;

export function getAdminApp() {
    if (cachedApp) {
        return cachedApp;
    }

    const serviceAccount = getServiceAccount();
    cachedApp =
        getApps()[0] ??
        initializeApp({
            credential: cert({
                projectId: serviceAccount.project_id,
                clientEmail: serviceAccount.client_email,
                privateKey: serviceAccount.private_key,
            }),
        });

    return cachedApp;
}

export function getAdminDb() {
    if (cachedDb) {
        return cachedDb;
    }

    cachedDb = getFirestore(getAdminApp());
    return cachedDb;
}

export function getAdminAuth() {
    if (cachedAuth) {
        return cachedAuth;
    }

    cachedAuth = getAuth(getAdminApp());
    return cachedAuth;
}
