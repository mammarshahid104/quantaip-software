// Class list — single source of truth.
// Every "Class" dropdown in the app reads schools/{schoolCode}/classes; nothing
// hardcodes Nursery…Grade 12 any more, so a school with only "Play Group" and
// "Montessori" sees exactly those.
import { useCallback, useEffect, useState } from "react";
import {
  collection,
  doc,
  getDocs,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase/config";
import { sectionSort } from "./sections";

// Order: Pre-Nursery, Nursery, Prep, KG, then Grade 1..12, unknowns last.
const NAMED_RANK = {
  "pre-nursery": -4,
  prenursery: -4,
  nursery: -3,
  prep: -2,
  kg: -1,
  kindergarten: -1,
};

export function classRank(name) {
  const key = String(name).toLowerCase().trim();
  if (key in NAMED_RANK) return NAMED_RANK[key];
  const m = key.match(/(\d+)/);
  if (m) return parseInt(m[1], 10);
  return 999;
}

// Known names keep the Nursery → Grade 12 order; anything else falls back to
// alphabetical (and sorts after the known ones).
export function classSort(a, b) {
  const ra = classRank(a);
  const rb = classRank(b);
  if (ra !== rb) return ra - rb;
  return String(a).localeCompare(String(b));
}

export const NO_CLASSES_MESSAGE =
  "No classes found. Please add classes first from the Classes tab.";

// Sorted class names from schools/{schoolCode}/classes.
export async function fetchClassNames(schoolCode) {
  const snap = await getDocs(collection(db, `schools/${schoolCode}/classes`));
  const names = snap.docs
    .map((d) => String(d.data().name || d.id).trim())
    .filter(Boolean);
  return Array.from(new Set(names)).sort(classSort);
}

// Classes as the students themselves record them, for schools whose data was
// migrated before the classes collection existed. Returns name -> sections[],
// the sections being whatever those students are actually in (never invented).
// De-duped case-insensitively, first spelling seen wins — "Grade 1" and
// "grade 1" are one class, matching how sections.js folds its own list.
export async function fetchClassInfoFromStudents(schoolCode) {
  const snap = await getDocs(collection(db, `schools/${schoolCode}/students`));

  const byKey = new Map(); // lowercased name -> { name, sections:Set }
  snap.docs.forEach((d) => {
    const data = d.data();
    const name = String(data["class"] ?? "").trim();
    if (!name || name === "—") return;
    const key = name.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, { name, sections: new Set() });
    const section = String(data.section ?? "").trim();
    if (section && section !== "—") byKey.get(key).sections.add(section);
  });

  const out = new Map();
  Array.from(byKey.values())
    .sort((a, b) => classSort(a.name, b.name))
    .forEach((entry) =>
      out.set(entry.name, Array.from(entry.sections).sort(sectionSort))
    );
  return out;
}

// Just the names, for the dropdown fallback.
export async function fetchClassNamesFromStudents(schoolCode) {
  return Array.from((await fetchClassInfoFromStudents(schoolCode)).keys());
}

// One-time backfill: create a formal class doc for every class the students
// already reference but that has no document yet. Create-only and idempotent —
// existing class docs are never touched, so it is safe to re-run.
export async function syncClassesFromStudents(schoolCode) {
  const [existing, derived] = await Promise.all([
    fetchClassNames(schoolCode),
    fetchClassInfoFromStudents(schoolCode),
  ]);

  const created = [];
  const alreadyPresent = [];
  const skipped = [];

  for (const [name, sections] of derived) {
    if (matchClass(existing, name)) {
      alreadyPresent.push(name);
      continue;
    }
    // The class name is the doc ID, and Firestore IDs can't contain "/".
    if (name.includes("/")) {
      skipped.push(name);
      continue;
    }
    await setDoc(
      doc(db, `schools/${schoolCode}/classes`, name),
      {
        name,
        // Sections come from the students in this class rather than a
        // hardcoded "A" — see the note in the sync UI.
        section: sections[0] || "",
        sections,
        createdAt: serverTimestamp(),
      },
      { merge: true }
    );
    created.push(name);
  }

  return { created, alreadyPresent, skipped };
}

// Case-insensitive lookup so "grade 1" in a spreadsheet matches "Grade 1".
export function matchClass(classList, value) {
  const key = String(value || "").trim().toLowerCase();
  if (!key) return null;
  return classList.find((c) => c.toLowerCase() === key) || null;
}

// Live class list for a school.
//
// Safety net: schools whose data was migrated before the classes collection
// existed have students carrying a "class" value but no class documents at
// all. Rather than showing them an empty dropdown and blocking every "add
// student" flow, fall back to the classes their own students already name.
// `derived` marks that state so the UI can offer the Classes → Sync backfill.
//
// `empty` is therefore true only when neither source has anything — a genuinely
// fresh school, which is the real "add classes first" case.
export function useClasses(schoolCode) {
  const [classes, setClasses] = useState([]);
  const [derived, setDerived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    if (!schoolCode) return;
    setLoading(true);
    setError("");
    try {
      const formal = await fetchClassNames(schoolCode);
      if (formal.length) {
        setClasses(formal);
        setDerived(false);
      } else {
        const fromStudents = await fetchClassNamesFromStudents(schoolCode);
        setClasses(fromStudents);
        setDerived(fromStudents.length > 0);
      }
    } catch (err) {
      console.error("Load classes failed:", err);
      setError(
        err.code === "permission-denied"
          ? "You don't have access to this school's classes."
          : "Couldn't load classes. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }, [schoolCode]);

  useEffect(() => {
    reload();
  }, [reload]);

  return {
    classes,
    derived,
    loading,
    error,
    empty: !loading && !error && classes.length === 0,
    reload,
  };
}
