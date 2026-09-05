// Phone number normalization for Excel round-trips.
//
// Two levels, because the two bulk-update sheets want different things and
// silently rewriting stored numbers is worse than leaving them alone:
//
//   restoreLeadingZero — repairs only what Excel breaks.
//   normalizePhone     — that, plus collapsing separators to a bare number.

// Excel stores a phone typed as bare digits as a number, which drops the
// leading zero: 03009999999 comes back as 3009999999. Ten digits with no
// leading 0 is exactly that case — put it back (Pakistani mobile format).
// Anything else (dashes, +92, a 0 already there) is left untouched.
export function restoreLeadingZero(value) {
  const v = String(value ?? "").trim();
  return /^\d{10}$/.test(v) && !v.startsWith("0") ? `0${v}` : v;
}

// Strip the separators people type — spaces, dashes, dots, brackets — then
// repair the leading zero. "0300-123 4567" and "03001234567" become one
// number, so a re-typed contact stops reading as a different one.
// A leading "+" is kept: +92… is a country code, not formatting.
export function normalizePhone(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const plus = raw.startsWith("+");
  const digits = raw.replace(/[\s\-.()]/g, "").replace(/^\+/, "");
  return plus ? `+${digits}` : restoreLeadingZero(digits);
}
