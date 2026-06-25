// Students — searchable / filterable roster backed by Firestore
import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, getDocs, doc, deleteDoc } from "firebase/firestore";
import { db } from "../firebase/config";
import AddStudentModal from "../components/AddStudentModal";
import StudentDetailModal from "../components/StudentDetailModal";
import ConfirmDialog from "../components/ConfirmDialog";
import ImportExcelModal from "../components/ImportExcelModal";
import { exportStudents } from "../services/excelExport";

function studentName(d) {
  return d.fullName || "Unknown";
}

// Natural sort for grade labels like "Grade 5" ... "Grade 12".
function gradeSort(a, b) {
  const na = parseInt(String(a).replace(/\D/g, ""), 10);
  const nb = parseInt(String(b).replace(/\D/g, ""), 10);
  if (!isNaN(na) && !isNaN(nb)) return na - nb;
  return String(a).localeCompare(String(b));
}

export default function Students() {
  const schoolCode = localStorage.getItem("schoolCode") || "your school";

  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [grade, setGrade] = useState("All Grades");
  const [showModal, setShowModal] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editStudent, setEditStudent] = useState(null);
  const [viewStudent, setViewStudent] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [success, setSuccess] = useState("");

  const load = useCallback(async () => {
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
          grade: d["class"] || "—",
          section: d.section || "—",
          status: (d.status || "active").toLowerCase(),
          raw: d,
        };
      });
      setStudents(rows);
    } catch (err) {
      console.error("Students load failed:", err);
      setError(
        err.code === "permission-denied"
          ? "You don't have access to this school's students."
          : "Couldn't load students. Please try again."
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

  const closeModal = () => {
    setShowModal(false);
    setEditStudent(null);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteDoc(
        doc(db, `schools/${schoolCode}/students/${deleteTarget.id}`)
      );
      setDeleteTarget(null);
      handleSuccess("Student deleted successfully!");
    } catch (err) {
      console.error("Delete student failed:", err);
      setError(
        err.code === "permission-denied"
          ? "You don't have permission to delete students."
          : "Couldn't delete student. Please try again."
      );
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  // Unique grades present in the data, for the dropdown.
  const grades = useMemo(() => {
    const set = new Set(
      students.map((s) => s.grade).filter((g) => g && g !== "—")
    );
    return ["All Grades", ...Array.from(set).sort(gradeSort)];
  }, [students]);

  // Apply search + grade filter.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return students.filter((s) => {
      const matchesSearch = !q || s.name.toLowerCase().includes(q);
      const matchesGrade = grade === "All Grades" || s.grade === grade;
      return matchesSearch && matchesGrade;
    });
  }, [students, search, grade]);

  return (
    <div className="page">
      {/* Header */}
      <div className="page-head page-head-row">
        <div>
          <h1 className="page-title">Students</h1>
          <p className="page-subtitle">
            Roster for <strong>{schoolCode}</strong>
          </p>
        </div>
        <div className="header-actions">
          <button
            className="btn-excel-import"
            onClick={() => setShowImport(true)}
          >
            📤 Import Excel
          </button>
          <button
            className="btn-excel-export"
            onClick={() =>
              exportStudents(
                students.map((s) => ({
                  ...s,
                  fatherName: s.raw.fatherName,
                  parentPhone: s.raw.parentPhone,
                })),
                schoolCode
              )
            }
          >
            📥 Export Excel
          </button>
          <button className="btn-primary" onClick={() => setShowModal(true)}>
            + Add Student
          </button>
        </div>
      </div>

      {success && <div className="success-banner">{success}</div>}
      {error && <div className="login-error">{error}</div>}

      {/* Toolbar: search + grade filter */}
      <div className="toolbar">
        <div className="search-box">
          <span className="search-icon">🔍</span>
          <input
            className="search-input"
            type="text"
            placeholder="Search students by name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="filter-select"
          value={grade}
          onChange={(e) => setGrade(e.target.value)}
        >
          {grades.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </div>

      {/* Stats row */}
      <div className="stats-row">
        <span>
          Total: <strong>{students.length}</strong>
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
            <span>Loading students…</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="table-state">No students found</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Roll No</th>
                <th>Name</th>
                <th>Grade</th>
                <th>Section</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id}>
                  <td className="cell-muted">{s.id}</td>
                  <td>{s.rollNo}</td>
                  <td className="cell-strong">{s.name}</td>
                  <td>{s.grade}</td>
                  <td>{s.section}</td>
                  <td>
                    <span
                      className={
                        "badge " +
                        (s.status === "active" ? "badge-ok" : "badge-warn")
                      }
                    >
                      {s.status.charAt(0).toUpperCase() + s.status.slice(1)}
                    </span>
                  </td>
                  <td>
                    <div className="action-btns">
                      <button
                        className="btn-view"
                        onClick={() => setViewStudent(s.id)}
                      >
                        View
                      </button>
                      <button
                        className="btn-edit"
                        onClick={() =>
                          setEditStudent({ id: s.id, ...s.raw })
                        }
                      >
                        Edit
                      </button>
                      <button
                        className="btn-delete"
                        onClick={() => setDeleteTarget(s)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {(showModal || editStudent) && (
        <AddStudentModal
          schoolCode={schoolCode}
          student={editStudent || undefined}
          onClose={closeModal}
          onSuccess={handleSuccess}
        />
      )}

      {viewStudent && (
        <StudentDetailModal
          schoolCode={schoolCode}
          studentId={viewStudent}
          onClose={() => setViewStudent(null)}
        />
      )}

      {showImport && (
        <ImportExcelModal
          type="students"
          schoolCode={schoolCode}
          onClose={() => setShowImport(false)}
          onSuccess={(msg) => {
            setShowImport(false);
            handleSuccess(msg);
          }}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete Student"
          message={`Are you sure you want to delete ${deleteTarget.name}? This cannot be undone.`}
          loading={deleting}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}
