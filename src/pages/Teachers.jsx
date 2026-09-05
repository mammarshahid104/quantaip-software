// Teachers — searchable / filterable list backed by Firestore
import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, getDocs, doc, deleteDoc } from "firebase/firestore";
import { db } from "../firebase/config";
import AddTeacherModal from "../components/AddTeacherModal";
import TeacherDetailModal from "../components/TeacherDetailModal";
import ConfirmDialog from "../components/ConfirmDialog";
import ImportExcelModal from "../components/ImportExcelModal";
import BulkUpdateModal from "../components/BulkUpdateModal";
import { exportTeachers } from "../services/excelExport";
import { useClasses, classSort } from "../services/classes";

function teacherName(d) {
  return d.fullName || d.name || "Unknown";
}

export default function Teachers() {
  const schoolCode = localStorage.getItem("schoolCode") || "your school";

  // Class filter options come from schools/{schoolCode}/classes.
  const {
    classes,
    empty: noClasses,
    reload: reloadClasses,
  } = useClasses(schoolCode);

  const [teachers, setTeachers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [subject, setSubject] = useState("All Subjects");
  const [classFilter, setClassFilter] = useState("All Classes");
  const [showModal, setShowModal] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showBulkUpdate, setShowBulkUpdate] = useState(false);
  // Teachers who have left are kept on record but hidden by default.
  const [statusFilter, setStatusFilter] = useState("Active");
  const [editTeacher, setEditTeacher] = useState(null);
  const [viewTeacher, setViewTeacher] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [success, setSuccess] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const snap = await getDocs(
        collection(db, `schools/${schoolCode}/teachers`)
      );
      const rows = snap.docs.map((doc) => {
        const d = doc.data();
        return {
          id: doc.id,
          name: teacherName(d),
          subject: d.subject || "—",
          classesAssigned: Array.isArray(d.classesAssigned)
            ? d.classesAssigned
            : d.classesAssigned
            ? [d.classesAssigned]
            : [],
          classAssigned: Array.isArray(d.classesAssigned)
            ? d.classesAssigned.join(", ")
            : d.classesAssigned || "—",
          phone: d.phone || d.phoneNumber || d.contact || "—",
          status: (d.status || "active").toLowerCase(),
          raw: d,
        };
      });
      setTeachers(rows);
    } catch (err) {
      console.error("Teachers load failed:", err);
      setError(
        err.code === "permission-denied"
          ? "You don't have access to this school's teachers."
          : "Couldn't load teachers. Please try again."
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
    reloadClasses();
    setTimeout(() => setSuccess(""), 4000);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditTeacher(null);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteDoc(
        doc(db, `schools/${schoolCode}/teachers/${deleteTarget.id}`)
      );
      setDeleteTarget(null);
      handleSuccess("Teacher deleted successfully!");
    } catch (err) {
      console.error("Delete teacher failed:", err);
      setError(
        err.code === "permission-denied"
          ? "You don't have permission to delete teachers."
          : "Couldn't delete teacher. Please try again."
      );
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  // Unique subjects present in the data, for the dropdown.
  const subjects = useMemo(() => {
    const set = new Set(
      teachers.map((t) => t.subject).filter((s) => s && s !== "—")
    );
    return ["All Subjects", ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [teachers]);

  // Filter options: the school's defined classes, plus any class already on a
  // teacher record so nobody becomes unfilterable.
  const classOptions = useMemo(() => {
    const set = new Set(classes);
    teachers.forEach((t) => t.classesAssigned.forEach((c) => c && set.add(c)));
    return ["All Classes", ...Array.from(set).sort(classSort)];
  }, [classes, teachers]);

  // The bulk-update sheet is a snapshot of the raw stored values rather than
  // the table's "—" placeholders, so a round-trip can't write a dash back into
  // Firestore. nameKey records which field this doc actually keeps its name in.
  const bulkUpdateRoster = useMemo(
    () =>
      teachers.map((t) => ({
        id: t.id,
        name: t.raw.fullName || t.raw.name || "",
        nameKey: t.raw.fullName !== undefined ? "fullName" : "name",
        subject: t.raw.subject || "",
        classesAssigned: Array.isArray(t.raw.classesAssigned)
          ? t.raw.classesAssigned
          : t.raw.classesAssigned
          ? [t.raw.classesAssigned]
          : [],
        phone: t.raw.phone || t.raw.phoneNumber || t.raw.contact || "",
        status: String(t.raw.status || "active").toLowerCase(),
      })),
    [teachers]
  );

  // Apply search + subject + class filters.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return teachers.filter((t) => {
      const matchesSearch = !q || t.name.toLowerCase().includes(q);
      const matchesSubject =
        subject === "All Subjects" || t.subject === subject;
      const matchesClass =
        classFilter === "All Classes" ||
        t.classesAssigned.includes(classFilter);
      const matchesStatus =
        statusFilter === "All" || t.status === statusFilter.toLowerCase();
      return matchesSearch && matchesSubject && matchesClass && matchesStatus;
    });
  }, [teachers, search, subject, classFilter, statusFilter]);

  const inactiveCount = useMemo(
    () => teachers.filter((t) => t.status === "inactive").length,
    [teachers]
  );

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
        <div className="header-actions">
          <button
            className="btn-excel-import"
            onClick={() => setShowImport(true)}
          >
            📤 Import Excel
          </button>
          <button
            className="btn-excel-import"
            onClick={() => setShowBulkUpdate(true)}
          >
            📝 Bulk Update Teachers
          </button>
          <button
            className="btn-excel-export"
            onClick={() =>
              exportTeachers(
                teachers.map((t) => ({
                  name: t.name,
                  subject: t.raw.subject || "",
                  phone: t.raw.phone || "",
                  classesAssigned: t.raw.classesAssigned || [],
                })),
                schoolCode
              )
            }
          >
            📥 Export Excel
          </button>
          <button
            className="btn-primary"
            onClick={() => setShowModal(true)}
            disabled={noClasses}
            title={
              noClasses
                ? "Add classes from the Classes tab before adding teachers."
                : undefined
            }
          >
            + Add Teacher
          </button>
        </div>
      </div>

      {success && <div className="success-banner">{success}</div>}
      {error && <div className="login-error">{error}</div>}
      {noClasses && (
        <div className="warn-banner">
          ⚠️ No classes defined yet. Add classes from the{" "}
          <strong>Classes</strong> tab before adding teachers.
        </div>
      )}

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
        <select
          className="filter-select"
          value={classFilter}
          onChange={(e) => setClassFilter(e.target.value)}
        >
          {classOptions.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          className="filter-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          {["Active", "Inactive", "All"].map((s) => (
            <option key={s} value={s}>
              {s === "All" ? "All Statuses" : s}
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
        {inactiveCount > 0 && (
          <>
            <span className="stats-sep">·</span>
            <span>
              Inactive: <strong>{inactiveCount}</strong>
            </span>
          </>
        )}
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
                    <div className="action-btns">
                      <button
                        className="btn-view"
                        onClick={() => setViewTeacher(t.id)}
                      >
                        View
                      </button>
                      <button
                        className="btn-edit"
                        onClick={() =>
                          setEditTeacher({ id: t.id, ...t.raw })
                        }
                      >
                        Edit
                      </button>
                      <button
                        className="btn-delete"
                        onClick={() => setDeleteTarget(t)}
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

      {viewTeacher && (
        <TeacherDetailModal
          schoolCode={schoolCode}
          teacherId={viewTeacher}
          onClose={() => setViewTeacher(null)}
        />
      )}

      {(showModal || editTeacher) && (
        <AddTeacherModal
          schoolCode={schoolCode}
          teacher={editTeacher || undefined}
          onClose={closeModal}
          onSuccess={handleSuccess}
        />
      )}

      {showBulkUpdate && (
        <BulkUpdateModal
          type="teachers"
          schoolCode={schoolCode}
          rows={bulkUpdateRoster}
          onClose={() => setShowBulkUpdate(false)}
          onSuccess={(msg) => {
            setShowBulkUpdate(false);
            handleSuccess(msg);
          }}
        />
      )}

      {showImport && (
        <ImportExcelModal
          type="teachers"
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
          title="Delete Teacher"
          message={`Are you sure you want to delete ${deleteTarget.name}? This cannot be undone.`}
          loading={deleting}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}
