// Timetable — per-class, per-day schedule (one doc per class)
import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase/config";

// Class ordering: Nursery → Prep → KG → Grade 1..12, unknowns last.
const NAMED_RANK = {
  "pre-nursery": -4,
  prenursery: -4,
  nursery: -3,
  prep: -2,
  kg: -1,
  kindergarten: -1,
};
function classRank(name) {
  const key = String(name).toLowerCase().trim();
  if (key in NAMED_RANK) return NAMED_RANK[key];
  const m = key.match(/(\d+)/);
  if (m) return parseInt(m[1], 10);
  return 999;
}
function classSort(a, b) {
  const ra = classRank(a);
  const rb = classRank(b);
  if (ra !== rb) return ra - rb;
  return String(a).localeCompare(String(b));
}

const DAYS = [
  { short: "Mon", full: "Monday" },
  { short: "Tue", full: "Tuesday" },
  { short: "Wed", full: "Wednesday" },
  { short: "Thu", full: "Thursday" },
  { short: "Fri", full: "Friday" },
  { short: "Sat", full: "Saturday" },
];

// Find the period array for a day regardless of how the day key is spelled.
function getDayPeriods(data, day) {
  if (!data || typeof data !== "object") return [];
  const candidates = [
    day.full,
    day.short,
    day.full.toLowerCase(),
    day.short.toLowerCase(),
    day.full.toUpperCase(),
    day.short.toUpperCase(),
  ];
  const search = (obj) => {
    for (const k of candidates) if (Array.isArray(obj[k])) return obj[k];
    return null;
  };
  return search(data) || (data.days && search(data.days)) || [];
}

// Normalise a single period entry from whatever shape it has.
function normalisePeriod(p, index) {
  if (!p || typeof p !== "object") return null;
  const subject =
    p.subject || (p.isBreak || p.break || p.type === "break" ? "Break" : "—");
  const isBreak =
    p.isBreak === true ||
    p.break === true ||
    p.type === "break" ||
    String(subject).toLowerCase() === "break";
  const time =
    p.time ||
    p.timeSlot ||
    (p.startTime && p.endTime ? `${p.startTime} - ${p.endTime}` : "—");
  return {
    periodNo: p.period ?? p.periodNo ?? p.no ?? index + 1,
    time,
    subject,
    teacher: isBreak ? "—" : p.teacher || p.teacherName || "—",
    isBreak,
  };
}

export default function Timetable() {
  const schoolCode = localStorage.getItem("schoolCode") || "your school";

  const [docs, setDocs] = useState({}); // className -> data
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedClass, setSelectedClass] = useState("");
  const [selectedDay, setSelectedDay] = useState("Mon");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const snap = await getDocs(
          collection(db, `schools/${schoolCode}/timetable`)
        );

        const map = {};
        snap.docs.forEach((doc) => {
          map[doc.id] = doc.data();
        });
        if (!cancelled) setDocs(map);
      } catch (err) {
        if (cancelled) return;
        console.error("Timetable load failed:", err);
        setError(
          err.code === "permission-denied"
            ? "You don't have access to this school's timetable."
            : "Couldn't load timetable. Please try again."
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [schoolCode]);

  // Class chips from the timetable doc IDs.
  const classes = useMemo(
    () => Object.keys(docs).sort(classSort),
    [docs]
  );

  useEffect(() => {
    if (!selectedClass && classes.length > 0) setSelectedClass(classes[0]);
  }, [classes, selectedClass]);

  // Periods for the selected class + day.
  const periods = useMemo(() => {
    const data = docs[selectedClass];
    const day = DAYS.find((d) => d.short === selectedDay);
    if (!data || !day) return [];
    return getDayPeriods(data, day)
      .map(normalisePeriod)
      .filter(Boolean);
  }, [docs, selectedClass, selectedDay]);

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">Timetable</h1>
        <p className="page-subtitle">
          Schedule for <strong>{schoolCode}</strong>
        </p>
      </div>

      {error && <div className="login-error">{error}</div>}

      {/* Class chips */}
      {!loading && classes.length > 0 && (
        <div className="chip-row">
          {classes.map((c) => (
            <button
              key={c}
              className={"chip" + (c === selectedClass ? " chip-active" : "")}
              onClick={() => setSelectedClass(c)}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {/* Day chips */}
      <div className="chip-row">
        {DAYS.map((d) => (
          <button
            key={d.short}
            className={"chip" + (d.short === selectedDay ? " chip-active" : "")}
            onClick={() => setSelectedDay(d.short)}
          >
            {d.short}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="card">
        {loading ? (
          <div className="table-state">
            <div className="route-loading-spinner" />
            <span>Loading timetable…</span>
          </div>
        ) : classes.length === 0 || periods.length === 0 ? (
          <div className="table-state">No timetable set for this class yet</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Period No</th>
                <th>Time</th>
                <th>Subject</th>
                <th>Teacher</th>
              </tr>
            </thead>
            <tbody>
              {periods.map((p, i) => (
                <tr key={i} className={p.isBreak ? "row-break" : ""}>
                  <td className="cell-muted">{p.isBreak ? "—" : p.periodNo}</td>
                  <td>{p.time}</td>
                  <td className={p.isBreak ? "" : "cell-strong"}>{p.subject}</td>
                  <td>{p.teacher}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
