// Section list — sections are whatever a school actually calls them.
// Nothing hardcodes A/B/C any more: the options come from the section values
// already in use in schools/{schoolCode}/students (plus the classes docs), so a
// school running "Purple" / "Green" / "Mango" sees exactly those — and a brand
// new name can always be typed in, since every Section field is a combobox.
import { useCallback, useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase/config";

// Single letters first (A, B, C…), then numbers, then everything else
// alphabetically — so "A"/"B" schools keep the familiar order and "Purple"
// still lands somewhere predictable.
export function sectionRank(name) {
  const key = String(name).trim();
  if (/^[A-Za-z]$/.test(key)) return 0;
  if (/^\d+$/.test(key)) return 1;
  return 2;
}

export function sectionSort(a, b) {
  const ra = sectionRank(a);
  const rb = sectionRank(b);
  if (ra !== rb) return ra - rb;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

// Distinct section values already used by this school. Reads students first
// (that's where sections really live) and folds in anything set on the class
// docs, which store either `section` or a `sections` array.
export async function fetchSectionNames(schoolCode) {
  const [students, classes] = await Promise.all([
    getDocs(collection(db, `schools/${schoolCode}/students`)),
    getDocs(collection(db, `schools/${schoolCode}/classes`)),
  ]);

  const names = new Set();
  const add = (value) => {
    const v = String(value ?? "").trim();
    if (v && v !== "—") names.add(v);
  };

  students.docs.forEach((d) => add(d.data().section));
  classes.docs.forEach((d) => {
    const data = d.data();
    add(data.section);
    if (Array.isArray(data.sections)) data.sections.forEach(add);
  });

  // Case-insensitive de-dupe — "purple" and "Purple" are one section; the
  // first spelling seen wins so the list matches what's on screen elsewhere.
  const seen = new Map();
  for (const n of names) {
    const key = n.toLowerCase();
    if (!seen.has(key)) seen.set(key, n);
  }
  return Array.from(seen.values()).sort(sectionSort);
}

// Case-insensitive lookup so "purple" typed by hand matches existing "Purple"
// instead of creating a second section.
export function matchSection(sectionList, value) {
  const key = String(value || "").trim().toLowerCase();
  if (!key) return null;
  return sectionList.find((s) => s.toLowerCase() === key) || null;
}

// Live section list for a school. Unlike classes, an empty list is normal —
// a fresh school just types its first section name.
export function useSections(schoolCode) {
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    if (!schoolCode) return;
    setLoading(true);
    setError("");
    try {
      setSections(await fetchSectionNames(schoolCode));
    } catch (err) {
      console.error("Load sections failed:", err);
      setError("Couldn't load existing sections.");
    } finally {
      setLoading(false);
    }
  }, [schoolCode]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { sections, loading, error, reload };
}
