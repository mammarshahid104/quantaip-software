// Analytics & Reports — aggregates across students (attendance + marks) and teachers
import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, getCountFromServer } from "firebase/firestore";
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

// Tally present/total across an entire attendanceMap.
function tallyAttendance(map) {
  let present = 0;
  let total = 0;
  if (map && typeof map === "object") {
    for (const val of Object.values(map)) {
      total += 1;
      const v = String(val).trim().toLowerCase();
      if (v === "p" || v === "present" || v === "true") present += 1;
    }
  }
  return { present, total };
}

// Pull obtained/total from a marksMap entry of unknown shape.
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
      entry.total ?? entry.totalMarks ?? entry.maxMarks ?? entry.outOf ?? 100;
    return { obtained: Number(obtained) || 0, total: Number(total) || 100 };
  }
  return null;
}

// A student's overall marks % across all tests in their marksMap.
function studentMarksPct(marksMap) {
  if (!marksMap || typeof marksMap !== "object") return null;
  let obtained = 0;
  let total = 0;
  for (const entry of Object.values(marksMap)) {
    const m = extractMarks(entry);
    if (m) {
      obtained += m.obtained;
      total += m.total;
    }
  }
  return total > 0 ? Math.round((obtained / total) * 100) : null;
}

function barColor(pct) {
  if (pct >= 75) return "bar-green";
  if (pct >= 50) return "bar-amber";
  return "bar-red";
}

export default function Analytics() {
  const schoolCode = localStorage.getItem("schoolCode") || "your school";

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const base = `schools/${schoolCode}`;
        const [studentsSnap, teacherCount] = await Promise.all([
          getDocs(collection(db, `${base}/students`)),
          getCountFromServer(collection(db, `${base}/teachers`)),
        ]);

        const students = studentsSnap.docs.map((doc) => {
          const d = doc.data();
          const att = tallyAttendance(d.attendanceMap);
          return {
            id: doc.id,
            name: studentName(d),
            cls: d["class"] || "—",
            present: att.present,
            attTotal: att.total,
            attPct: att.total > 0 ? Math.round((att.present / att.total) * 100) : null,
            marksPct: studentMarksPct(d.marksMap),
          };
        });

        if (!cancelled) {
          setData({ students, totalTeachers: teacherCount.data().count });
        }
      } catch (err) {
        if (cancelled) return;
        console.error("Analytics load failed:", err);
        setError(
          err.code === "permission-denied"
            ? "You don't have access to this school's data."
            : "Couldn't load analytics. Please try again."
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

  const derived = useMemo(() => {
    if (!data) return null;
    const { students } = data;

    // Overall attendance.
    let present = 0;
    let attTotal = 0;
    for (const s of students) {
      present += s.present;
      attTotal += s.attTotal;
    }
    const overallAttendance =
      attTotal > 0 ? Math.round((present / attTotal) * 100) : null;

    // Pass rate (students with marks, overall % >= 40).
    const withMarks = students.filter((s) => s.marksPct != null);
    const passRate =
      withMarks.length > 0
        ? Math.round(
            (withMarks.filter((s) => s.marksPct >= 40).length /
              withMarks.length) *
              100
          )
        : null;

    // Per-class attendance aggregate.
    const classMap = new Map();
    for (const s of students) {
      if (!s.cls || s.cls === "—") continue;
      if (!classMap.has(s.cls)) {
        classMap.set(s.cls, { count: 0, present: 0, total: 0 });
      }
      const c = classMap.get(s.cls);
      c.count += 1;
      c.present += s.present;
      c.total += s.attTotal;
    }
    const classRows = Array.from(classMap.entries()).map(([name, c]) => ({
      name,
      count: c.count,
      pct: c.total > 0 ? Math.round((c.present / c.total) * 100) : null,
    }));

    // Chart: class order Nursery → Grade 12.
    const chart = [...classRows].sort((a, b) => {
      const ra = classRank(a.name);
      const rb = classRank(b.name);
      if (ra !== rb) return ra - rb;
      return a.name.localeCompare(b.name);
    });

    // Performance table: lowest attendance first (needs attention).
    const performance = [...classRows].sort((a, b) => {
      const av = a.pct == null ? Infinity : a.pct;
      const bv = b.pct == null ? Infinity : b.pct;
      return av - bv;
    });

    // At-risk students: attendance < 75%.
    const atRisk = students
      .filter((s) => s.attPct != null && s.attPct < 75)
      .sort((a, b) => a.attPct - b.attPct);

    return {
      totalStudents: students.length,
      overallAttendance,
      passRate,
      chart,
      performance,
      atRisk,
    };
  }, [data]);

  const cards = [
    {
      label: "Total Students",
      value: derived ? derived.totalStudents.toLocaleString() : "—",
      icon: "🎓",
    },
    {
      label: "Total Teachers",
      value: data ? data.totalTeachers.toLocaleString() : "—",
      icon: "🧑‍🏫",
    },
    {
      label: "Overall Attendance %",
      value:
        derived && derived.overallAttendance != null
          ? `${derived.overallAttendance}%`
          : "—",
      icon: "🗓️",
    },
    {
      label: "Pass Rate %",
      value:
        derived && derived.passRate != null ? `${derived.passRate}%` : "—",
      icon: "✅",
    },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">Analytics &amp; Reports</h1>
        <p className="page-subtitle">
          Insights for <strong>{schoolCode}</strong>
        </p>
      </div>

      {error && <div className="login-error">{error}</div>}

      {/* Summary cards */}
      <div className="stat-grid">
        {cards.map((c) => (
          <div className="stat-card" key={c.label}>
            <div className="stat-icon">{c.icon}</div>
            <div className="stat-meta">
              <div className="stat-value">{loading ? "…" : c.value}</div>
              <div className="stat-label">{c.label}</div>
            </div>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="card">
          <div className="table-state">
            <div className="route-loading-spinner" />
            <span>Loading analytics…</span>
          </div>
        </div>
      ) : !derived || derived.totalStudents === 0 ? (
        <div className="card">
          <div className="table-state">No data available yet</div>
        </div>
      ) : (
        <>
          {/* Class-wise attendance chart */}
          <div className="card" style={{ marginBottom: 18 }}>
            <div className="card-head">
              <h2 className="card-title">Class-wise Attendance</h2>
            </div>
            {derived.chart.every((c) => c.pct == null) ? (
              <div className="table-state">No attendance data recorded yet</div>
            ) : (
              derived.chart.map((c) => (
                <div className="bar-row" key={c.name}>
                  <div className="bar-label">{c.name}</div>
                  <div className="bar-track">
                    <div
                      className={"bar-fill " + barColor(c.pct || 0)}
                      style={{ width: `${c.pct || 0}%` }}
                    />
                  </div>
                  <div className="bar-value">
                    {c.pct == null ? "—" : `${c.pct}%`}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* At-risk students */}
          <div className="card" style={{ marginBottom: 18 }}>
            <div className="card-head">
              <h2 className="card-title">
                At-Risk Students ({derived.atRisk.length})
              </h2>
            </div>
            {derived.atRisk.length === 0 ? (
              <div className="table-state">
                No at-risk students — attendance looks healthy.
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Class</th>
                    <th>Attendance %</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {derived.atRisk.map((s) => (
                    <tr key={s.id}>
                      <td className="cell-strong">{s.name}</td>
                      <td>{s.cls}</td>
                      <td>{s.attPct}%</td>
                      <td>
                        <span className="badge badge-red">At Risk</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Class performance table */}
          <div className="card">
            <div className="card-head">
              <h2 className="card-title">
                Class Performance (lowest attendance first)
              </h2>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Class</th>
                  <th>Total Students</th>
                  <th>Avg Attendance %</th>
                </tr>
              </thead>
              <tbody>
                {derived.performance.map((c) => (
                  <tr key={c.name}>
                    <td className="cell-strong">{c.name}</td>
                    <td>{c.count}</td>
                    <td>{c.pct == null ? "—" : `${c.pct}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
