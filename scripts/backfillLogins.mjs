// backfillLogins.mjs — one-time repair for people added before login accounts
// were created automatically.
//
// Two older bugs left records that look fine in the dashboard but cannot sign
// into the mobile app:
//   1. Teachers / students / parents had a Firestore doc but no Firebase Auth
//      account (fixed for new records in AddTeacherModal, AddStudentModal and
//      ImportExcelModal).
//   2. Some students never got their paired parent doc at all, so even a valid
//      parent login resolved to no profile.
// This script fixes both for every existing record in one school.
//
// Usage:
//   ADMIN_PASSWORD=secret node scripts/backfillLogins.mjs GHS-001
// PowerShell:
//   $env:ADMIN_PASSWORD='secret'; node scripts/backfillLogins.mjs GHS-001
//
// Signs in as {schoolCode}-adm-001@quantaip.edu.pk (same pattern as
// addDummyData.mjs) because Firestore rules require an authenticated admin.
//
// SAFE TO RE-RUN. Existing Auth accounts and existing parent docs are skipped,
// so re-running after a rate-limit pause only does the work that is left.
import { stdout as output } from "node:process";
import { initializeApp, deleteApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, setDoc, serverTimestamp } from "firebase/firestore";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { firebaseConfig } from "../src/firebase/config.js";

// Firebase throttles signups per IP; without a gap a 100-row school trips it.
const AUTH_CREATE_DELAY_MS = 220;

// Consecutive auth/too-many-requests failures before we give up. Once the IP is
// throttled every further call fails, so grinding through the rest is pointless.
const RATE_LIMIT_STREAK_LIMIT = 3;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// GHS-001-TCH-0001 -> ghs-001-tch-0001@quantaip.edu.pk (matches the mobile app).
const loginEmailFor = (id) => `${String(id).trim().toLowerCase()}@quantaip.edu.pk`;

// Secondary app names must be unique; Date.now() alone collides between two
// accounts created in the same millisecond.
let seq = 0;

// Thrown when the IP is throttled; unwinds the run so main() can stop cleanly.
class RateLimitedError extends Error {}

// Render a single-line progress counter (matches addDummyData.mjs).
function progress(label, done, total) {
  output.write(`\r${label} ${done}/${total}   `);
  if (done === total) output.write("\n");
}

// Creates one Auth account on a SECONDARY app: createUserWithEmailAndPassword
// signs the new user in on whatever app it is given, which would drop our admin
// session and break every Firestore write that follows.
// Returns "created" | "exists"; throws on anything else.
async function createAuthAccount(id, password) {
  seq += 1;
  const app = initializeApp(firebaseConfig, `backfill-${Date.now()}-${seq}`);
  const auth = getAuth(app);
  try {
    await createUserWithEmailAndPassword(auth, loginEmailFor(id), password);
    return "created";
  } catch (err) {
    if (err.code === "auth/email-already-in-use") return "exists";
    throw err;
  } finally {
    await signOut(auth).catch(() => {});
    await deleteApp(app).catch(() => {});
  }
}

// --------------------------------------------------------------------- main
async function main() {
  const schoolCode = String(process.argv[2] || "").trim().toUpperCase();
  if (!schoolCode) {
    console.error("❌ Usage: node scripts/backfillLogins.mjs <SCHOOL-CODE>");
    console.error("   e.g.  ADMIN_PASSWORD=secret node scripts/backfillLogins.mjs GHS-001");
    process.exit(1);
  }
  if (!process.env.ADMIN_PASSWORD) {
    console.error("❌ ADMIN_PASSWORD is not set — Firestore rules will block every read.");
    console.error(`   PowerShell:  $env:ADMIN_PASSWORD='...'; node scripts/backfillLogins.mjs ${schoolCode}`);
    process.exit(1);
  }

  console.log(`\n🔧 Backfilling logins for ${schoolCode}\n`);

  const app = initializeApp(firebaseConfig, "backfill-logins-script");
  const db = getFirestore(app);
  const base = `schools/${schoolCode}`;

  const adminEmail = `${schoolCode}-ADM-001@quantaip.edu.pk`.toLowerCase();
  try {
    await signInWithEmailAndPassword(getAuth(app), adminEmail, process.env.ADMIN_PASSWORD);
    console.log(`🔐 Signed in as ${adminEmail}\n`);
  } catch (err) {
    console.error(`❌ Admin sign-in failed (${err.code}). Aborting.`);
    if (err.code === "auth/too-many-requests") {
      console.error("   This IP is rate-limited. Wait ~1 hour and re-run the same command.");
    }
    process.exit(1);
  }

  // 1) Read everything up front ----------------------------------------------
  let teachers;
  let students;
  let parentIds;
  try {
    const [tSnap, sSnap, pSnap] = await Promise.all([
      getDocs(collection(db, `${base}/teachers`)),
      getDocs(collection(db, `${base}/students`)),
      getDocs(collection(db, `${base}/parents`)),
    ]);
    teachers = tSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    students = sSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    parentIds = new Set(pSnap.docs.map((d) => d.id));
  } catch (err) {
    console.error(`❌ Couldn't read ${base} (${err.code || err.message}). Aborting.`);
    if (err.code === "permission-denied") {
      console.error("   Security rules rejected the admin. Check the school code and password.");
    }
    process.exit(1);
  }

  console.log(
    `📖 Found ${teachers.length} teachers · ${students.length} students · ${parentIds.size} parents\n`
  );

  // 2) Create any missing parent docs ----------------------------------------
  // Done before the Auth phase so newly-created parents get accounts in the
  // same run. A student with no parentId is reported and skipped.
  const parents = [];
  const noPassword = [];
  let parentDocsCreated = 0;

  for (const s of students) {
    const parentId = s.parentId;
    if (!parentId) {
      noPassword.push(`${s.id} (no parentId — parent account cannot be built)`);
      continue;
    }
    if (parentIds.has(parentId)) {
      parents.push({ id: parentId, password: s.password, source: s.id });
      continue;
    }
    try {
      await setDoc(doc(db, `${base}/parents/${parentId}`), {
        id: parentId,
        name: s.fatherName || "",
        phone: s.parentPhone || "",
        password: s.password || "",
        role: "parent",
        school: schoolCode,
        status: "active",
        studentId: s.id,
        studentName: s.fullName || "",
        createdAt: serverTimestamp(),
      });
      parentDocsCreated += 1;
      parentIds.add(parentId);
      parents.push({ id: parentId, password: s.password, source: s.id });
      console.log(`✓ Created missing parent doc for ${s.id}`);
    } catch (err) {
      console.error(`✗ Parent doc for ${s.id} failed (${err.code || err.message})`);
    }
  }
  if (parentDocsCreated) console.log("");

  // 3) Auth accounts for teachers, students and parents ----------------------
  let created = 0;
  let skipped = 0;
  let failed = 0;
  let rateLimitStreak = 0;
  const failures = [];

  // Walks one group, updating its counter line. Throws RateLimitedError once
  // the IP is clearly throttled so the whole run can stop.
  async function backfillGroup(label, rows) {
    if (!rows.length) {
      console.log(`${label} 0/0   `);
      return;
    }
    let done = 0;
    for (const row of rows) {
      // A doc with no password has no credential to install — flag, don't guess.
      if (!row.password) {
        failed += 1;
        failures.push(`${row.id} — no password field on the record`);
        done += 1;
        progress(label, done, rows.length);
        continue;
      }
      try {
        const outcome = await createAuthAccount(row.id, row.password);
        if (outcome === "created") created += 1;
        else skipped += 1;
        rateLimitStreak = 0;
      } catch (err) {
        failed += 1;
        failures.push(`${row.id} — ${err.code || err.message}`);
        if (err.code === "auth/too-many-requests") {
          rateLimitStreak += 1;
          if (rateLimitStreak >= RATE_LIMIT_STREAK_LIMIT) {
            done += 1;
            progress(label, done, rows.length);
            throw new RateLimitedError();
          }
        } else {
          rateLimitStreak = 0;
        }
      }
      done += 1;
      progress(label, done, rows.length);
      await sleep(AUTH_CREATE_DELAY_MS);
    }
  }

  let rateLimited = false;
  try {
    await backfillGroup("👨‍🏫 Teachers:", teachers);
    await backfillGroup("🎓 Students:", students);
    await backfillGroup("👨‍👩‍👧 Parents:", parents);
  } catch (err) {
    if (!(err instanceof RateLimitedError)) throw err;
    rateLimited = true;
  }

  // 4) Summary ----------------------------------------------------------------
  console.log("");
  if (rateLimited) {
    console.log("⏳ Stopped early — Firebase is rate-limiting new signups from this IP.");
    console.log(`   Wait ~1 hour, then re-run:  node scripts/backfillLogins.mjs ${schoolCode}`);
    console.log("   Everything already done is kept — the re-run skips it and picks up the rest.\n");
  }

  if (noPassword.length) {
    console.log(`⚠️  ${noPassword.length} student(s) need manual attention:`);
    noPassword.slice(0, 10).forEach((line) => console.log(`   · ${line}`));
    if (noPassword.length > 10) console.log(`   …and ${noPassword.length - 10} more.`);
    console.log("");
  }

  if (failures.length) {
    console.log(`⚠️  ${failures.length} account(s) failed:`);
    failures.slice(0, 15).forEach((line) => console.log(`   · ${line}`));
    if (failures.length > 15) console.log(`   …and ${failures.length - 15} more.`);
    console.log("");
  }

  if (parentDocsCreated) {
    console.log(`📄 Created ${parentDocsCreated} missing parent doc(s)`);
  }
  console.log(
    `✅ Done! Created ${created} accounts, skipped ${skipped} (already existed), ${failed} failed\n`
  );

  await deleteApp(app).catch(() => {});
  process.exit(rateLimited || failed ? 1 : 0);
}

main().catch((err) => {
  console.error("\n❌ Backfill failed:", err.code || "", err.message);
  process.exit(1);
});
