// Monthly usage limit for the AI Timetable Generator (per school, localStorage).
//
// Client-side guard only — it deters casual overuse and caps costs for a
// trusted/internal admin audience, but a determined user can clear localStorage.
// For hard enforcement, move the counter behind a backend.

export const MONTHLY_LIMIT = 20; // max AI generations per school per month

// Current month as "YYYY-MM" (e.g. "2026-06"). A new month yields a new key,
// so the count resets automatically on the 1st.
function monthKey(d = new Date()) {
  return d.toISOString().slice(0, 7);
}

const storageKey = (code) => `ai_timetable_month_${code}_${monthKey()}`;

function readInt(key) {
  const n = parseInt(localStorage.getItem(key), 10);
  return Number.isFinite(n) ? n : 0;
}

// Human-readable date the limit resets (1st of next month), e.g. "1 July 2026".
export function resetDateLabel(d = new Date()) {
  const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return next.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

// Snapshot of the current monthly usage state for a school.
export function getAiUsage(schoolCode) {
  const monthlyCount = readInt(storageKey(schoolCode));
  const monthlyReached = monthlyCount >= MONTHLY_LIMIT;
  return {
    monthlyCount,
    monthlyReached,
    canGenerate: !monthlyReached,
    resetDate: resetDateLabel(),
  };
}

// Record one successful generation: bump the monthly counter. Returns the fresh
// usage snapshot.
export function recordAiGeneration(schoolCode) {
  const key = storageKey(schoolCode);
  localStorage.setItem(key, String(readInt(key) + 1));
  return getAiUsage(schoolCode);
}
