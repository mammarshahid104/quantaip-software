// Teachers — searchable / filterable list backed by Firestore
import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase/config";

function teacherName(d) {
  return d.fullName || d.name || "Unknown";
}

export default function Teachers() {
  const schoolCode = localStorage.getItem("schoolCode") || "your school";

  const [teachers, setTeachers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [subject, setSubject] = useState("All Subjects");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const snap = await getDocs(
          collection(db, `schools/${schoolCode}/teachers`)
        );

        if (snap.docs.length > 0) {
          console.log("Teacher fields:", snap.docs[0].data());
        }

        const rows = snap.docs.map((doc) => {
          const d = doc.data();
          return {
            id: doc.id,
            name: teacherName(d),
            subject: d.subject || "—",
            classAssigned: Array.isArray(d.classesAssigned)
              ? d.classesAssigned.join(", ")
              : d.classesAssigned || "—",
            phone: d.phone || d.phoneNumber || d.contact || "—",
            status: (d.status || "active").toLowerCase(),
          };
        });
        if (!cancelled) setTeachers(rows);
      } catch (err) {
        if (cancelled) return;
        console.error("Teachers load failed:", err);
        setError(
          err.code === "permission-denied"
            ? "You don't have access to this school's teachers."
            : "Couldn't load teachers. Please try again."
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

  // Unique subjects present in the data, for the dropdown.
  const subjects = useMemo(() => {
    const set = new Set(
      teachers.map((t) => t.subject).filter((s) => s && s !== "—")
    );
    return ["All Subjects", ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [teachers]);

  // Apply search + subject filter.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return teachers.filter((t) => {
      const matchesSearch = !q || t.name.toLowerCase().includes(q);
      const matchesSubject =
        subject === "All Subjects" || t.subject === subject;
      return matchesSearch && matchesSubject;
    });
  }, [teachers, search, subject]);

  return (
    <div className="page">
      {/* Header */}
      <div className="page-head page-head-row">
        <div>
          <h1 className="page-title">Teachers</h1>
          <p className="page-subtitle">
            Staff for <strong>{schoolCode}</strong>
          </p>
        </div>
        <button className="btn-primary">+ Add Teacher</button>
      </div>

      {error && <div className="login-error">{error}</div>}

      {/* Toolbar: search + subject filter */}
      <div className="toolbar">
        <div className="search-box">
          <span className="search-icon">🔍</span>
          <input
            className="search-input"
            type="text"
            placeholder="Search teachers by name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="filter-select"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        >
          {subjects.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {/* Stats row */}
      <div className="stats-row">
        <span>
          Total: <strong>{teachers.length}</strong>
        </span>
        <span className="stats-sep">·</span>
        <span>
          Showing: <strong>{filtered.length}</strong>
        </span>
      </div>

      {/* Table */}
      <div className="card">
        {loading ? (
          <div className="table-state">
            <div className="route-loading-spinner" />
            <span>Loading teachers…</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="table-state">No teachers found</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Subject</th>
                <th>Classes Assigned</th>
                <th>Phone</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.id}>
                  <td className="cell-muted">{t.id}</td>
                  <td className="cell-strong">{t.name}</td>
                  <td>{t.subject}</td>
                  <td>{t.classAssigned}</td>
                  <td>{t.phone}</td>
                  <td>
                    <span
                      className={
                        "badge " +
                        (t.status === "active" ? "badge-ok" : "badge-warn")
                      }
                    >
                      {t.status.charAt(0).toUpperCase() + t.status.slice(1)}
                    </span>
                  </td>
                  <td>
                    <button className="btn-view">View</button>
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
