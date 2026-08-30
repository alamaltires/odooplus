import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
    apiKey: "AIzaSyB-ewmplkeMfwcN94PoC0KbIA20ISjNxdI",
    authDomain: "odooplus-b409d.firebaseapp.com",
    projectId: "odooplus-b409d",
    storageBucket: "odooplus-b409d.firebasestorage.app",
    messagingSenderId: "34174854961",
    appId: "1:34174854961:web:31015f14ff2240c606b210",
    measurementId: "G-7M8V24RRQ7",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
