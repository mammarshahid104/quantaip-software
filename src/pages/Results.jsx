// Results & Marks — per-class, per-test view from each student's marksMap
import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase/config";

function studentName(d) {
  return d.fullName || d.name || "Unknown";
}

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

// Pull obtained/total out of a marksMap entry, whatever its shape.
function extractMarks(entry) {
  if (entry == null) return null;
  if (typeof entry === "number") return { obtained: entry, total: 100 };
  if (typeof entry === "object") {
    const obtained =
      entry.obtained ??
      entry.marks ??
      entry.obtainedMarks ??
      entry.marksObtained ??
      entry.score ??
      0;
    const total =
      entry.total ??
      entry.totalMarks ??
      entry.maxMarks ??
      entry.outOf ??
      100;
    return { obtained: Number(obtained) || 0, total: Number(total) || 100 };
  }
  return null;
}

function gradeFor(pct) {
  if (pct >= 90) return "A+";
  if (pct >= 80) return "A";
  if (pct >= 70) return "B";
  if (pct >= 60) return "C";
  if (pct >= 50) return "D";
  return "F";
}

function statusFor(pct) {
  if (pct >= 80) return { label: "Distinction", cls: "badge-ok" };
  if (pct >= 60) return { label: "Pass", cls: "badge-ok" };
  if (pct >= 40) return { label: "Average", cls: "badge-warn" };
  return { label: "Fail", cls: "badge-red" };
}

export default function Results() {
  const schoolCode = localStorage.getItem("schoolCode") || "your school";

  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedClass, setSelectedClass] = useState("");
  const [selectedTest, setSelectedTest] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const snap = await getDocs(
          collection(db, `schools/${schoolCode}/students`)
        );

        const rows = snap.docs.map((doc) => {
          const d = doc.data();
          return {
            id: doc.id,
            rollNo: d.rollNo || "—",
            name: studentName(d),
            cls: d["class"] || "—",
            marksMap: d.marksMap || {},
          };
        });
        if (!cancelled) setStudents(rows);
      } catch (err) {
        if (cancelled) return;
        console.error("Results load failed:", err);
        setError(
          err.code === "permission-denied"
            ? "You don't have access to this school's results."
            : "Couldn't load results. Please try again."
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

  // Unique classes for chips.
  const classes = useMemo(() => {
    const set = new Set(
      students.map((s) => s.cls).filter((c) => c && c !== "—")
    );
    return Array.from(set).sort(classSort);
  }, [students]);

  // Unique test IDs across all marksMaps.
  const tests = useMemo(() => {
    const set = new Set();
    for (const s of students) {
      for (const key of Object.keys(s.marksMap || {})) set.add(key);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [students]);

  // Defaults once data arrives.
  useEffect(() => {
    if (!selectedClass && classes.length > 0) setSelectedClass(classes[0]);
  }, [classes, selectedClass]);
  useEffect(() => {
    if (!selectedTest && tests.length > 0) setSelectedTest(tests[0]);
  }, [tests, selectedTest]);

  // Build ranked rows for the selected class + test.
  const rows = useMemo(() => {
    const list = students
      .filter((s) => s.cls === selectedClass)
      .map((s) => {
        const marks = extractMarks(s.marksMap?.[selectedTest]);
        if (!marks) return null;
        const pct =
          marks.total > 0
            ? Math.round((marks.obtained / marks.total) * 100)
            : 0;
        return {
          id: s.id,
          rollNo: s.rollNo,
          name: s.name,
          obtained: marks.obtained,
          total: marks.total,
          pct,
          grade: gradeFor(pct),
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.obtained - a.obtained);

    // Competition ranking (ties share a position).
    let lastMarks = null;
    let lastPos = 0;
    list.forEach((r, i) => {
      if (r.obtained === lastMarks) {
        r.position = lastPos;
      } else {
        r.position = i + 1;
        lastPos = i + 1;
        lastMarks = r.obtained;
      }
    });
    return list;
  }, [students, selectedClass, selectedTest]);

  // Summary cards.
  const summary = useMemo(() => {
    if (rows.length === 0) {
      return { avg: null, highest: null, lowest: null, passRate: null };
    }
    const avg = Math.round(rows.reduce((s, r) => s + r.pct, 0) / rows.length);
    const highest = Math.max(...rows.map((r) => r.obtained));
    const lowest = Math.min(...rows.map((r) => r.obtained));
    const passing = rows.filter((r) => r.pct >= 40).length;
    const passRate = Math.round((passing / rows.length) * 100);
    return { avg, highest, lowest, passRate };
  }, [rows]);

  const cards = [
    {
      label: "Class Average %",
      value: summary.avg == null ? "—" : `${summary.avg}%`,
      icon: "📊",
    },
    {
      label: "Highest Marks",
      value: summary.highest == null ? "—" : summary.highest,
      icon: "🏆",
    },
    {
      label: "Lowest Marks",
      value: summary.lowest == null ? "—" : summary.lowest,
      icon: "🔻",
    },
    {
      label: "Pass Rate %",
      value: summary.passRate == null ? "—" : `${summary.passRate}%`,
      icon: "✅",
    },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">Results &amp; Marks</h1>
        <p className="page-subtitle">
          Results for <strong>{schoolCode}</strong>
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

      {/* Test selector */}
      <div className="toolbar">
        <select
          className="filter-select"
          value={selectedTest}
          onChange={(e) => setSelectedTest(e.target.value)}
        >
          {tests.length === 0 ? (
            <option value="">No tests found</option>
          ) : (
            tests.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))
          )}
        </select>
      </div>

      {/* Summary cards */}
      <div className="stat-grid">
        {cards.map((c) => (
          <div className="stat-card" key={c.label}>
            <div className="stat-icon">{c.icon}</div>
            <div className="stat-meta">
              <div className="stat-value">
                {loading
                  ? "…"
                  : typeof c.value === "number"
                  ? c.value.toLocaleString()
                  : c.value}
              </div>
              <div className="stat-label">{c.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="card">
        {loading ? (
          <div className="table-state">
            <div className="route-loading-spinner" />
            <span>Loading results…</span>
          </div>
        ) : rows.length === 0 ? (
          <div className="table-state">
            No results found for this class and test.
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Roll No</th>
                <th>Student Name</th>
                <th>Obtained</th>
                <th>Total</th>
                <th>Percentage</th>
                <th>Grade</th>
                <th>Position</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const status = statusFor(r.pct);
                return (
                  <tr key={r.id}>
                    <td className="cell-muted">{r.rollNo}</td>
                    <td className="cell-strong">{r.name}</td>
                    <td>{r.obtained}</td>
                    <td>{r.total}</td>
                    <td>{r.pct}%</td>
                    <td className="cell-strong">{r.grade}</td>
                    <td>{r.position}</td>
                    <td>
                      <span className={"badge " + status.cls}>
                        {status.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
