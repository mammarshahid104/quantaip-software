// Firebase initialization for QUANTAIP EduOS Web Dashboard
// Shares the same backend as the mobile app.
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";

// Exported so the /setup wizard can spin up a secondary Firebase app for
// creating new school admin accounts without disturbing the current session.
export const firebaseConfig = {
  apiKey: "AIzaSyAeTAwG2-hZmGadQcwko33GF6rV956bAzs",
  authDomain: "quantaip-eduapp.firebaseapp.com",
  projectId: "quantaip-eduapp",
  storageBucket: "quantaip-eduapp.firebasestorage.app",
  messagingSenderId: "676753188837",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);

// Offline-first Firestore: data is cached locally so the app works without a
// connection. Online → fresh data syncs; offline → served from local cache.
// persistentMultipleTabManager lets multiple windows/tabs share the cache.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});

export default app;
