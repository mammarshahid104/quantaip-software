// Firebase initialization for QUANTAIP EduOS Web Dashboard
// Shares the same backend as the mobile app.
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAeTAwG2-hZmGadQcwko33GF6rV956bAzs",
  authDomain: "quantaip-eduapp.firebaseapp.com",
  projectId: "quantaip-eduapp",
  storageBucket: "quantaip-eduapp.firebasestorage.app",
  messagingSenderId: "676753188837",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

export default app;
