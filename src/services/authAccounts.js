// Login accounts — creates the Firebase Auth user behind a teacher / student /
// parent ID so that person can actually sign into the mobile app.
//
// A Firestore doc alone is not a login. Every place the web dashboard creates a
// person (Add Teacher, Add Student, Excel import) must also create the matching
// Auth account, or that user is stuck at the login screen.
//
// Accounts are created on a SECONDARY Firebase app: createUserWithEmailAndPassword
// signs the new user in on whatever app instance it is given, so running it on
// the primary app would kick the admin out of their own session. Same pattern
// the /setup wizard uses for school admin accounts.
import { initializeApp, deleteApp } from "firebase/app";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { firebaseConfig } from "../firebase/config";

// GHS-001-TCH-0001 -> ghs-001-tch-0001@quantaip.edu.pk (matches the mobile app).
export const loginEmailFor = (id) =>
  `${String(id).trim().toLowerCase()}@quantaip.edu.pk`;

// Firebase throttles signups per IP. Bulk imports (50-100+ rows) trip that limit
// without a gap between calls — the bulk seed script hit exactly this.
export const AUTH_CREATE_DELAY_MS = 200;

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Secondary app names must be unique; Date.now() alone collides when two
// accounts (e.g. a student and their parent) are created in the same tick.
let seq = 0;

// Creates the Auth account for `id`. Resolves if the account already exists —
// re-running an import or re-adding a person should not be an error. Throws on
// anything else (weak password, network, invalid email) so callers can warn.
export async function createAuthAccount(id, password) {
  seq += 1;
  const secondaryApp = initializeApp(
    firebaseConfig,
    `secondary-${Date.now()}-${seq}`
  );
  const secondaryAuth = getAuth(secondaryApp);
  try {
    await createUserWithEmailAndPassword(
      secondaryAuth,
      loginEmailFor(id),
      password
    );
  } catch (err) {
    if (err.code !== "auth/email-already-in-use") throw err;
  } finally {
    await signOut(secondaryAuth).catch(() => {});
    await deleteApp(secondaryApp).catch(() => {});
  }
}
