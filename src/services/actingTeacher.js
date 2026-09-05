// "Act as Teacher" proxy mode.
//
// Some schools have teachers without a phone, so the admin operates the web
// app on their behalf from a shared computer. Proxy mode narrows the UI to one
// teacher's classes and stamps their name on the work, while the writes
// themselves stay byte-identical to what the teacher's own login would produce
// — the mobile app must not be able to tell the difference.
//
// Auth is untouched: the admin stays signed in as the admin. This is a UI
// scope, not an impersonation of credentials, so every write still goes
// through the admin's token and the admin's Firestore rules.
//
// Held in sessionStorage rather than localStorage on purpose: on a shared
// classroom machine, closing the tab should end proxy mode, but a refresh
// mid-task shouldn't lose it.
import { createContext, useContext } from "react";

export const ACTING_TEACHER_KEY = "actingTeacher";

export const ActingTeacherContext = createContext(null);

export function readStoredTeacher() {
  try {
    const raw = sessionStorage.getItem(ACTING_TEACHER_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && parsed.id ? parsed : null;
  } catch {
    return null;
  }
}

export function useActingTeacher() {
  return (
    useContext(ActingTeacherContext) || {
      teacher: null,
      acting: false,
      actAs: () => {},
      exit: () => {},
    }
  );
}

// Narrow a list of class names to the ones this teacher is assigned to.
// Admin (no acting teacher) sees everything, unchanged.
export function scopeClasses(classes, teacher) {
  if (!teacher) return classes;
  const assigned = new Set(
    (teacher.classesAssigned || []).map((c) => String(c).trim().toLowerCase())
  );
  return classes.filter((c) => assigned.has(String(c).trim().toLowerCase()));
}
