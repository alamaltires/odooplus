import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
    apiKey: "AIzaSyAvt6T351QarPsJOhWl_gCOeom6kXvmm50",
    authDomain: "odooplus-672bc.firebaseapp.com",
    projectId: "odooplus-672bc",
    storageBucket: "odooplus-672bc.firebasestorage.app",
    messagingSenderId: "805058153642",
    appId: "1:805058153642:web:f3ef867a8658ccc20914d3",
    measurementId: "G-GXG3HB4HG2",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
