// Classes page - View + Add modal - v2
// Classes — merged from formal class docs (schools/{schoolCode}/classes) and
// unique d["class"] values across students, so classes show even before any
// students are assigned.
import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase/config";
import AddClassModal from "../components/AddClassModal";
import ViewClassModal from "../components/ViewClassModal";
import EditInchargeModal from "../components/EditInchargeModal";

// Order: Nursery, Prep, KG, then Grade 1..12, unknowns last.
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

export default function Classes() {
  const schoolCode = localStorage.getItem("schoolCode") || "your school";

  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [success, setSuccess] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [viewClass, setViewClass] = useState(null);
  const [editInchargeClass, setEditInchargeClass] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const base = `schools/${schoolCode}`;
      const [studentsSnap, teachersSnap, classesSnap] = await Promise.all([
        getDocs(collection(db, `${base}/students`)),
        getDocs(collection(db, `${base}/teachers`)),
        getDocs(collection(db, `${base}/classes`)),
      ]);

      // Map class name -> teacher name (from teachers' classesAssigned).
      const teacherByClass = new Map();
      for (const doc of teachersSnap.docs) {
        const t = doc.data();
        const name = t.fullName || t.name || "—";
        const assigned = Array.isArray(t.classesAssigned)
          ? t.classesAssigned
          : t.classesAssigned
          ? [t.classesAssigned]
          : [];
        for (const cls of assigned) {
          if (!teacherByClass.has(cls)) teacherByClass.set(cls, name);
        }
      }

      // Group students by class -> { count, sections }.
      const byClass = new Map();
      const ensure = (cls) => {
        if (!byClass.has(cls)) {
          byClass.set(cls, { count: 0, sections: new Set() });
        }
        return byClass.get(cls);
      };

      for (const doc of studentsSnap.docs) {
        const d = doc.data();
        const cls = d["class"];
        if (!cls) continue;
        const entry = ensure(cls);
        entry.count += 1;
        if (d.section) entry.sections.add(d.section);
      }

      // Merge in formal class documents — they may have no students yet.
      // classInchargeName holds the incharge's display name (matches mobile).
      const inchargeByClass = new Map();
      for (const doc of classesSnap.docs) {
        const c = doc.data();
        const name = c.name || doc.id;
        const entry = ensure(name);
        if (c.section) entry.sections.add(c.section);
        if (c.classInchargeName && c.classInchargeName.trim()) {
          inchargeByClass.set(name, c.classInchargeName.trim());
        }
      }

      const rows = Array.from(byClass.keys())
        .sort(classSort)
        .map((name) => {
          const group = byClass.get(name);
          return {
            name,
            students: group.count,
            sections: Array.from(group.sections).sort((a, b) =>
              a.localeCompare(b)
            ),
            teacher:
              inchargeByClass.get(name) || teacherByClass.get(name) || "—",
          };
        });

      setClasses(rows);
    } catch (err) {
      console.error("Classes load failed:", err);
      setError(
        err.code === "permission-denied"
          ? "You don't have access to this school's classes."
          : "Couldn't load classes. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }, [schoolCode]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSuccess = (message) => {
    setSuccess(message);
    load();
    setTimeout(() => setSuccess(""), 4000);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return classes;
    return classes.filter((c) => c.name.toLowerCase().includes(q));
  }, [classes, search]);

  return (
    <div className="page">
      {/* Header */}
      <div className="page-head page-head-row">
        <div>
          <h1 className="page-title">Classes</h1>
          <p className="page-subtitle">
            Classes for <strong>{schoolCode}</strong>
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowAdd(true)}>
          + Add Class
        </button>
      </div>

      {success && <div className="success-banner">{success}</div>}
      {error && <div className="login-error">{error}</div>}

      {/* Toolbar: search */}
      <div className="toolbar">
        <div className="search-box">
          <span className="search-icon">🔍</span>
          <input
            className="search-input"
            type="text"
            placeholder="Search classes by name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Stats row */}
      <div className="stats-row">
        <span>
          Total Classes: <strong>{classes.length}</strong>
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
            <span>Loading classes…</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="table-state">No classes found</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Class Name</th>
                <th>Total Students</th>
                <th>Sections</th>
                <th>Class Teacher</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.name}>
                  <td className="cell-strong">{c.name}</td>
                  <td>{c.students}</td>
                  <td>{c.sections.length > 0 ? c.sections.join(", ") : "—"}</td>
                  <td>{c.teacher}</td>
                  <td>
                    <div className="action-btns">
                      <button
                        className="btn-view"
                        onClick={() => setViewClass(c.name)}
                      >
                        View
                      </button>
                      <button
                        className="btn-edit"
                        onClick={() => setEditInchargeClass(c.name)}
                      >
                        Edit Incharge
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showAdd && (
        <AddClassModal
          schoolCode={schoolCode}
          onClose={() => setShowAdd(false)}
          onSuccess={handleSuccess}
        />
      )}

      {viewClass && (
        <ViewClassModal
          schoolCode={schoolCode}
          className={viewClass}
          onClose={() => setViewClass(null)}
        />
      )}

      {editInchargeClass && (
        <EditInchargeModal
          schoolCode={schoolCode}
          className={editInchargeClass}
          onClose={() => setEditInchargeClass(null)}
          onSuccess={handleSuccess}
        />
      )}
    </div>
  );
}
