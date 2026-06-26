// addDummyData.mjs — seed a test school with dummy data in Firestore.
//
// Creates 15 classes, 20 teachers, 100 students (distributed across classes),
// plus 30 days of attendance per student.
//
// Usage:
//   node scripts/addDummyData.mjs TST2-001
//   node scripts/addDummyData.mjs            (prompts, defaults to TST2-001)
//
// Firestore writes are protected by security rules. If your project requires an
// authenticated admin, set the school admin's password first:
//   ADMIN_PASSWORD=secret node scripts/addDummyData.mjs TST2-001
// (signs in as {schoolCode}-adm-001@quantaip.edu.pk). The admin account is
// created via the in-app /setup wizard.
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { initializeApp } from "firebase/app";
import {
  getFirestore,
  doc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
// Reuse the same backend config as the web app (named export, no persistence).
import { firebaseConfig } from "../src/firebase/config.js";

// ---------------------------------------------------------------- data tables
const CLASSES = [
  "Nursery", "Prep", "KG",
  "Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5",
  "Grade 6", "Grade 7", "Grade 8", "Grade 9", "Grade 10",
  "Grade 11", "Grade 12",
];

const TEACHERS = [
  ["Ms. Fatima Khan", "Mathematics"],
  ["Mr. Ahmed Ali", "Physics"],
  ["Ms. Ayesha Butt", "Chemistry"],
  ["Mr. Hassan Raza", "Biology"],
  ["Ms. Zainab Iqbal", "Urdu"],
  ["Mr. Bilal Ahmed", "Islamiyat"],
  ["Ms. Sara Khan", "Computer Science"],
  ["Mr. Omar Farooq", "English"],
  ["Ms. Maryam Ali", "Geography"],
  ["Mr. Tariq Mehmood", "Pakistan Studies"],
  ["Ms. Nadia Hussain", "Economics"],
  ["Mr. Faisal Iqbal", "History"],
  ["Ms. Hira Baig", "Home Economics"],
  ["Mr. Adeel Khan", "Arabic"],
  ["Ms. Rabia Malik", "Mathematics"],
  ["Mr. Kamran Ahmed", "English"],
  ["Ms. Noor Fatima", "Science"],
  ["Mr. Saad Ali", "Social Studies"],
  ["Ms. Amina Raza", "Art"],
  ["Mr. Usman Malik", "Physical Education"],
];

const MALE_NAMES = [
  "Ahmed", "Ali", "Usman", "Hassan", "Bilal", "Hamza", "Omar", "Zaid",
  "Tariq", "Faisal", "Adeel", "Kamran", "Saad", "Junaid", "Imran", "Asad",
  "Raza", "Waqar", "Shoaib", "Abdullah", "Muhamad", "Owais", "Shahid",
  "Daniyal", "Aqib",
];

const FEMALE_NAMES = [
  "Fatima", "Ayesha", "Zainab", "Maryam", "Sana", "Hira", "Nadia", "Sara",
  "Amina", "Rabia", "Noor", "Bushra", "Sidra", "Maham", "Iqra", "Nimra",
  "Sobia", "Uzma", "Farah", "Lubna", "Alina", "Mehwish", "Aroha", "Kiran",
  "Bismah",
];

const FATHER_NAMES = [
  "Muhammad Ali", "Ahmed Khan", "Hassan Raza", "Abdul Rehman",
  "Tariq Mahmood", "Ijaz Ahmed", "Khalid Mehmood", "Zulfiqar Ali",
  "Imran Khan", "Shahid Iqbal", "Naveed Ahmad", "Aslam Sheikh",
];

// Students per class — totals 100. (The spec's listed split summed to 98:
// 8×7 + 7×6 = 98, so Grade 6 & Grade 7 are bumped from 6→7 to reach 100.)
const PER_CLASS = [7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 6, 6, 6, 6, 6];

// ------------------------------------------------------------------- helpers
const pad = (n, width) => String(n).padStart(width, "0");
const rand = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rand(arr.length)];
const rand4 = () => 1000 + rand(9000);
const firstNameOf = (name) => name.trim().split(/\s+/)[0] || "";
const surnameOf = (name) => name.trim().split(/\s+/).slice(-1)[0] || "";
const phone = () => `0300-${pad(rand(10000000), 7)}`;

// YYYY-MM-DD in local time (avoids UTC off-by-one).
function dateKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`;
}

// 30 days of attendance, skipping Sundays. 80% present, 20% absent.
function buildAttendanceMap() {
  const map = {};
  for (let i = 1; i <= 30; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    if (d.getDay() === 0) continue; // Sunday
    map[dateKey(d)] = Math.random() < 0.8 ? "P" : "A";
  }
  return map;
}

// Render a single-line progress counter.
function progress(label, done, total) {
  output.write(`\r${label} ${done}/${total}   `);
  if (done === total) output.write("\n");
}

// --------------------------------------------------------------------- main
async function main() {
  // Resolve the school code: CLI arg, prompt, or default.
  let schoolCode = process.argv[2];
  if (!schoolCode) {
    const rl = readline.createInterface({ input, output });
    const answer = await rl.question(
      "Enter school code [default: TST2-001]: "
    );
    rl.close();
    schoolCode = answer.trim();
  }
  schoolCode = (schoolCode || "TST2-001").toUpperCase();

  console.log(`\n🏫 Seeding dummy data for: ${schoolCode}\n`);

  const app = initializeApp(firebaseConfig, "dummy-data-script");
  const db = getFirestore(app);

  // Optional admin sign-in (needed if Firestore rules require auth).
  if (process.env.ADMIN_PASSWORD) {
    const email = `${schoolCode}-ADM-001@quantaip.edu.pk`.toLowerCase();
    try {
      await signInWithEmailAndPassword(
        getAuth(app),
        email,
        process.env.ADMIN_PASSWORD
      );
      console.log(`🔐 Signed in as ${email}\n`);
    } catch (err) {
      console.error(`❌ Admin sign-in failed (${err.code}). Aborting.`);
      process.exit(1);
    }
  }

  const base = `schools/${schoolCode}`;

  // 1) Classes ---------------------------------------------------------------
  for (let i = 0; i < CLASSES.length; i++) {
    const name = CLASSES[i];
    await setDoc(doc(db, `${base}/classes/${name}`), {
      name,
      section: "A",
      sections: ["A"],
      classIncharge: "",
      classInchargeName: "",
      createdAt: serverTimestamp(),
    });
    progress("Adding classes...", i + 1, CLASSES.length);
  }

  // 2) Teachers --------------------------------------------------------------
  for (let i = 0; i < TEACHERS.length; i++) {
    const [name, subject] = TEACHERS[i];
    const id = `${schoolCode}-TCH-${pad(i + 1, 4)}`;
    // Distribute classes: each teacher gets two classes, round-robin.
    const classesAssigned = Array.from(
      new Set([CLASSES[i % CLASSES.length], CLASSES[(i + 7) % CLASSES.length]])
    );
    await setDoc(doc(db, `${base}/teachers/${id}`), {
      id,
      name,
      subject,
      phone: phone(),
      password: `${firstNameOf(name.replace(/^(Ms\.|Mr\.)\s*/, ""))}${rand4()}`,
      role: "teacher",
      school: schoolCode,
      status: "active",
      classesAssigned,
      createdAt: serverTimestamp(),
    });
    progress("Adding teachers...", i + 1, TEACHERS.length);
  }

  // 3) Students + attendance -------------------------------------------------
  const total = PER_CLASS.reduce((a, b) => a + b, 0);
  let studentNo = 0;
  for (let c = 0; c < CLASSES.length; c++) {
    const className = CLASSES[c];
    for (let r = 1; r <= PER_CLASS[c]; r++) {
      studentNo += 1;
      const num = pad(studentNo, 4);
      const id = `${schoolCode}-STU-${num}`;
      const male = Math.random() < 0.5;
      const given = pick(male ? MALE_NAMES : FEMALE_NAMES);
      const father = pick(FATHER_NAMES);
      const fullName = `${given} ${surnameOf(father)}`;
      await setDoc(doc(db, `${base}/students/${id}`), {
        id,
        fullName,
        class: className,
        section: "A",
        rollNo: pad(r, 3),
        fatherName: father,
        parentPhone: phone(),
        password: `${given}${rand4()}`,
        role: "student",
        school: schoolCode,
        status: "active",
        parentId: `${schoolCode}-PAR-${num}`,
        attendanceMap: buildAttendanceMap(),
        createdAt: serverTimestamp(),
      });
      progress("Adding students + attendance...", studentNo, total);
    }
  }

  console.log(`\n✅ Done! ${schoolCode} is ready for testing!`);
  console.log(
    `   ${CLASSES.length} classes · ${TEACHERS.length} teachers · ${total} students (30 days attendance each)\n`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("\n❌ Seeding failed:", err.code || "", err.message);
  if (err.code === "permission-denied") {
    console.error(
      "   Firestore rules blocked the write. Re-run with ADMIN_PASSWORD set,\n" +
        "   after creating the school's admin via the /setup wizard."
    );
  }
  process.exit(1);
});
