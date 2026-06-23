// Dashboard — live Firestore stat cards + recent students table
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection,
  getCountFromServer,
  getDocs,
} from "firebase/firestore";
import { db } from "../firebase/config";

// Pull a display name out of a student doc regardless of how it's shaped.
function studentName(d) {
  return d.fullName || "Unknown";
}

// Count "present" vs total entries in a single student's attendanceMap.
// Handles values like "P"/"A", "present"/"absent", or booleans.
function tallyAttendance(attendanceMap) {
  let present = 0;
  let total = 0;
  if (attendanceMap && typeof attendanceMap === "object") {
    for (const val of Object.values(attendanceMap)) {
      total += 1;
      const v = String(val).trim().toLowerCase();
      if (v === "p" || v === "present" || v === "true") present += 1;
    }
  }
  return { present, total };
}

export default function Dashboard() {
  const schoolCode = localStorage.getItem("schoolCode") || "your school";
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [counts, setCounts] = useState({
    students: 0,
    teachers: 0,
    classes: 0,
    attendancePct: null, // null = no data yet
    fees: 0,
  });
  const [recent, setRecent] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");

      try {
        const base = `schools/${schoolCode}`;
        const studentsRef = collection(db, `${base}/students`);
        const teachersRef = collection(db, `${base}/teachers`);

        // Fetch all students once — we derive count, classes, attendance % and
        // the recent list from this single read. Teachers count alongside.
        const [studentsSnap, teacherCount] = await Promise.all([
          getDocs(studentsRef),
          getCountFromServer(teachersRef),
        ]);

        // Classes = unique grade+section combinations across students
        // (matches the mobile app — 8 grade docs expand into 15 classes).
        const uniqueClasses = new Set(
          studentsSnap.docs
            .map((doc) => {
              const d = doc.data();
              const grade = d["class"] || "";
              const section = d.section || "";
              return `${grade}-${section}`;
            })
            .filter(Boolean)
        );

        // Attendance % across all students.
        let presentTotal = 0;
        let entryTotal = 0;
        for (const doc of studentsSnap.docs) {
          const { present, total } = tallyAttendance(doc.data().attendanceMap);
          presentTotal += present;
          entryTotal += total;
        }
        const attendancePct =
          entryTotal > 0 ? Math.round((presentTotal / entryTotal) * 100) : null;

        // Last 10 students by createdAt (sorted client-side from the full set,
        // so students missing createdAt still appear, just last).
        const recentStudents = [...studentsSnap.docs]
          .sort((a, b) => {
            const av = a.data().createdAt;
            const bv = b.data().createdAt;
            const at = av?.toMillis ? av.toMillis() : av ? +new Date(av) : 0;
            const bt = bv?.toMillis ? bv.toMillis() : bv ? +new Date(bv) : 0;
            return bt - at;
          })
          .slice(0, 10)
          .map((doc) => {
            const d = doc.data();
            return {
              id: doc.id,
              name: studentName(d),
              grade: d["class"] || "—",
              cls: d.section || "—",
              status: d.status || "Active",
            };
          });

        // Fees collected — sum this month's paid records from the same
        // subcollection the Fee Management page reads:
        //   schools/{schoolCode}/fees/{month}/students   (month = "June 2026")
        const month = new Date().toLocaleString("default", {
          month: "long",
          year: "numeric",
        });
        let feesCollected = 0;
        try {
          const feesSnap = await getDocs(
            collection(db, `${base}/fees/${month}/students`)
          );
          for (const doc of feesSnap.docs) {
            const f = doc.data();
            if (String(f.status || "").toLowerCase() === "paid") {
              feesCollected += Number(f.amount || 0);
            }
          }
        } catch (feeErr) {
          console.warn("Fees fetch failed:", feeErr);
        }

        if (cancelled) return;
        setCounts({
          students: studentsSnap.size,
          teachers: teacherCount.data().count,
          classes: uniqueClasses.size,
          attendancePct,
          fees: feesCollected,
        });
        setRecent(recentStudents);
      } catch (err) {
        if (cancelled) return;
        console.error("Dashboard load failed:", err);
        setError(
          err.code === "permission-denied"
            ? "You don't have access to this school's data."
            : "Couldn't load dashboard data. Please try again."
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

  // Order matches the mobile app dashboard.
  const stats = [
    { label: "Total Students", display: counts.students.toLocaleString(), icon: "🎓" },
    { label: "Teachers", display: counts.teachers.toLocaleString(), icon: "🧑‍🏫" },
    { label: "Classes", display: counts.classes.toLocaleString(), icon: "🏫" },
    {
      label: "Attendance %",
      display: counts.attendancePct == null ? "—" : `${counts.attendancePct}%`,
      icon: "🗓️",
    },
    {
      label: "Fees Collected",
      display: `Rs ${counts.fees.toLocaleString()}`,
      icon: "💰",
    },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">Dashboard</h1>
        <p className="page-subtitle">
          Overview for <strong>{schoolCode}</strong>
        </p>
      </div>

      {error && <div className="login-error">{error}</div>}

      {/* Stat cards */}
      <div className="stat-grid">
        {stats.map((s) => (
          <div className="stat-card" key={s.label}>
            <div className="stat-icon">{s.icon}</div>
            <div className="stat-meta">
              <div className="stat-value">
                {loading ? "…" : s.display}
              </div>
              <div className="stat-label">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Recent students */}
      <div className="card">
        <div className="card-head">
          <h2 className="card-title">Recent Students</h2>
          <span
            className="card-action"
            onClick={() => navigate("/students")}
            style={{ cursor: "pointer" }}
          >
            View all
          </span>
        </div>

        {loading ? (
          <div className="table-state">Loading students…</div>
        ) : recent.length === 0 ? (
          <div className="table-state">No students found yet.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Grade</th>
                <th>Class</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((stu) => (
                <tr key={stu.id}>
                  <td className="cell-muted">{stu.id}</td>
                  <td className="cell-strong">{stu.name}</td>
                  <td>{stu.grade}</td>
                  <td>{stu.cls}</td>
                  <td>
                    <span
                      className={
                        "badge " +
                        (stu.status === "Active" ? "badge-ok" : "badge-warn")
                      }
                    >
                      {stu.status}
                    </span>
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
