// Attendance — per-class, per-month view derived from each student's attendanceMap
import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase/config";
import { useClasses, classSort } from "../services/classes";
import { useActingTeacher, scopeClasses } from "../services/actingTeacher";

function studentName(d) {
  return d.fullName || d.name || "Unknown";
}

// Last 6 months including current, newest first.
function buildMonths() {
  const out = [];
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleString("en-US", {
      month: "long",
      year: "numeric",
    });
    out.push({ value, label });
  }
  return out;
}

// Tally P / A for a student within the selected "YYYY-MM".
function tallyMonth(attendanceMap, monthPrefix) {
  let present = 0;
  let absent = 0;
  if (attendanceMap && typeof attendanceMap === "object") {
    for (const [date, val] of Object.entries(attendanceMap)) {
      if (!date.startsWith(monthPrefix)) continue;
      const v = String(val).trim().toLowerCase();
      if (v === "p" || v === "present" || v === "true") present += 1;
      else if (v === "a" || v === "absent" || v === "false") absent += 1;
    }
  }
  return { present, absent };
}

function pctBadge(pct) {
  if (pct >= 75) return "badge-ok";
  if (pct >= 50) return "badge-warn";
  return "badge-red";
}

export default function Attendance() {
  const schoolCode = localStorage.getItem("schoolCode") || "your school";

  // Class list from schools/{schoolCode}/classes — never a fixed list.
  const { classes: definedClasses } = useClasses(schoolCode);
  const { teacher: actingTeacher } = useActingTeacher();

  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const months = useMemo(buildMonths, []);
  const [selectedMonth, setSelectedMonth] = useState(months[0].value);
  const [selectedClass, setSelectedClass] = useState("");

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
            status: String(d.status || "active").toLowerCase(),
            attendanceMap: d.attendanceMap || {},
          };
        });
        if (!cancelled) setStudents(rows);
      } catch (err) {
        if (cancelled) return;
        console.error("Attendance load failed:", err);
        setError(
          err.code === "permission-denied"
            ? "You don't have access to this school's attendance."
            : "Couldn't load attendance. Please try again."
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

  // Chip selector: the school's defined classes plus any class already on a
  // student record.
  // In proxy mode only the acting teacher's own classes are offered.
  const classes = useMemo(() => {
    const set = new Set(definedClasses);
    students.forEach((s) => {
      if (s.cls && s.cls !== "—") set.add(s.cls);
    });
    return scopeClasses(Array.from(set).sort(classSort), actingTeacher);
  }, [definedClasses, students, actingTeacher]);

  // Default the selected class to the first one once data arrives.
  useEffect(() => {
    if (classes.length === 0) return;
    // Also re-point when the current pick falls outside the list — entering or
    // leaving proxy mode changes which classes are on offer.
    if (!selectedClass || !classes.includes(selectedClass))
      setSelectedClass(classes[0]);
  }, [classes, selectedClass]);

  // Build per-student rows for the selected class + month.
  //
  // Withdrawn students drop off the marking list, but a month they were
  // actually here for still shows them — otherwise marking a new day would
  // list people who have left, while past months would silently lose the
  // pupils who sat in them.
  const rows = useMemo(() => {
    return students
      .filter((s) => s.cls === selectedClass)
      .map((s) => {
        const { present, absent } = tallyMonth(s.attendanceMap, selectedMonth);
        const total = present + absent;
        const pct = total > 0 ? Math.round((present / total) * 100) : 0;
        const inactive = s.status === "inactive";
        return { ...s, present, absent, total, pct, inactive };
      })
      .filter((r) => !r.inactive || r.total > 0)
      .sort((a, b) => {
        // Sort by roll no numerically when possible, else by name.
        const ra = parseInt(String(a.rollNo).replace(/\D/g, ""), 10);
        const rb = parseInt(String(b.rollNo).replace(/\D/g, ""), 10);
        if (!isNaN(ra) && !isNaN(rb)) return ra - rb;
        return a.name.localeCompare(b.name);
      });
  }, [students, selectedClass, selectedMonth]);

  // Summary cards.
  const summary = useMemo(() => {
    const withData = rows.filter((r) => r.total > 0);
    const totalPresent = rows.reduce((s, r) => s + r.present, 0);
    const totalAbsent = rows.reduce((s, r) => s + r.absent, 0);
    const avg =
      withData.length > 0
        ? Math.round(
            withData.reduce((s, r) => s + r.pct, 0) / withData.length
          )
        : null;
    const atRisk = withData.filter((r) => r.pct < 75).length;
    return { avg, totalPresent, totalAbsent, atRisk };
  }, [rows]);

  const cards = [
    {
      label: "Class Average %",
      value: summary.avg == null ? "—" : `${summary.avg}%`,
      icon: "📊",
    },
    { label: "Total Present", value: summary.totalPresent, icon: "✅" },
    { label: "Total Absent", value: summary.totalAbsent, icon: "❌" },
    { label: "At-Risk (<75%)", value: summary.atRisk, icon: "⚠️" },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">Attendance</h1>
        <p className="page-subtitle">
          Attendance for <strong>{schoolCode}</strong>
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

      {/* Month selector */}
      <div className="toolbar">
        <select
          className="filter-select"
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(e.target.value)}
        >
          {months.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
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
            <span>Loading attendance…</span>
          </div>
        ) : rows.length === 0 ? (
          <div className="table-state">
            No students found for this class.
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Roll No</th>
                <th>Student Name</th>
                <th>Present</th>
                <th>Absent</th>
                <th>Total Days</th>
                <th>Percentage</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="cell-muted">{r.rollNo}</td>
                  <td className="cell-strong">
                    {r.name}
                    {r.inactive && (
                      <span
                        className="badge badge-warn"
                        style={{ marginLeft: 6, fontSize: 11 }}
                      >
                        Withdrawn
                      </span>
                    )}
                  </td>
                  <td>{r.present}</td>
                  <td>{r.absent}</td>
                  <td>{r.total}</td>
                  <td>{r.total > 0 ? `${r.pct}%` : "—"}</td>
                  <td>
                    {r.total > 0 ? (
                      <span className={"badge " + pctBadge(r.pct)}>
                        {r.pct >= 75 ? "Good" : "At Risk"}
                      </span>
                    ) : (
                      <span className="badge badge-warn">No data</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
