// Usage limits for the AI Timetable Generator (per school, localStorage-backed).
//
// These are client-side guards only — they deter casual overuse and cap costs
// for a trusted/internal admin audience, but a determined user can clear
// localStorage. For hard enforcement, move the counters behind a backend.

export const DAILY_LIMIT = 3; // max AI generations per school per day
export const MONTHLY_LIMIT = 20; // max AI generations per school per month
export const COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes between generations

// Local (not UTC) date keys so "tomorrow" matches the user's calendar day.
function dateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function monthKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

// Keys embed the date/month, so yesterday's counters are simply never read
// again — the limit resets automatically when the calendar day/month rolls over.
const dailyStorageKey = (code) => `ai_timetable_usage_${code}_${dateKey()}`;
const monthlyStorageKey = (code) => `ai_timetable_monthly_${code}_${monthKey()}`;
const lastGenStorageKey = (code) => `ai_timetable_last_${code}`;

function readInt(key) {
  const raw = localStorage.getItem(key);
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}

// Snapshot of the current usage/cooldown state for a school.
export function getAiUsage(schoolCode) {
  const dailyCount = readInt(dailyStorageKey(schoolCode));
  const monthlyCount = readInt(monthlyStorageKey(schoolCode));

  const last = readInt(lastGenStorageKey(schoolCode));
  const elapsed = Date.now() - last;
  const cooldownLeft =
    last && elapsed >= 0 && elapsed < COOLDOWN_MS
      ? Math.ceil((COOLDOWN_MS - elapsed) / 1000)
      : 0;

  const dailyReached = dailyCount >= DAILY_LIMIT;
  const monthlyReached = monthlyCount >= MONTHLY_LIMIT;

  return {
    dailyCount,
    monthlyCount,
    cooldownLeft, // seconds remaining, 0 if none
    dailyReached,
    monthlyReached,
    canGenerate: !dailyReached && !monthlyReached && cooldownLeft === 0,
  };
}

// Record one successful generation: bump daily + monthly counters and start the
// cooldown. Returns the fresh usage snapshot.
export function recordAiGeneration(schoolCode) {
  localStorage.setItem(
    dailyStorageKey(schoolCode),
    String(readInt(dailyStorageKey(schoolCode)) + 1)
  );
  localStorage.setItem(
    monthlyStorageKey(schoolCode),
    String(readInt(monthlyStorageKey(schoolCode)) + 1)
  );
  localStorage.setItem(lastGenStorageKey(schoolCode), String(Date.now()));
  return getAiUsage(schoolCode);
}

// Format a seconds count as "M:SS" for the cooldown countdown.
export function formatCountdown(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
