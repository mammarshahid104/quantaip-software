// Manage Subjects modal — define the subjects a class studies, each with a
// weekly period count and the teacher who teaches it. Persisted as a `subjects`
// array on schools/{schoolCode}/classes/{className}, which the AI timetable
// generator then uses instead of every teacher's subjects.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase/config";
import ConfirmDialog from "./ConfirmDialog";

function teacherName(d) {
  return d.fullName || d.name || "Unknown";
}

// Split a teacher's `subject` field ("Physics, General Science") into parts.
function splitSubjects(value) {
  return String(value || "")
    .split(/[,/]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const FREQ_OPTIONS = [1, 2, 3, 4, 5, 6];

export default function ManageSubjectsModal({
  schoolCode,
  className,
  onClose,
  onSuccess,
}) {
  const [subjects, setSubjects] = useState([]);
  const [teachers, setTeachers] = useState([]); // {id, name, subject, classesAssigned}
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteIndex, setDeleteIndex] = useState(null);

  // Add / edit form state.
  const [subjectName, setSubjectName] = useState("");
  const [periodsPerWeek, setPeriodsPerWeek] = useState(5);
  const [teacherId, setTeacherId] = useState("");
  const [editingIndex, setEditingIndex] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const base = `schools/${schoolCode}`;
      const [classSnap, teachersSnap] = await Promise.all([
        getDoc(doc(db, `${base}/classes`, className)),
        getDocs(collection(db, `${base}/teachers`)),
      ]);

      const arr = classSnap.exists() ? classSnap.data().subjects : null;
      setSubjects(Array.isArray(arr) ? arr : []);

      setTeachers(
        teachersSnap.docs.map((d) => {
          const data = d.data();
          return {
            id: data.id || d.id,
            name: teacherName(data),
            subject: data.subject || "",
            classesAssigned: Array.isArray(data.classesAssigned)
              ? data.classesAssigned
              : data.classesAssigned
              ? [data.classesAssigned]
              : [],
          };
        })
      );
    } catch (err) {
      console.error("Manage subjects load failed:", err);
      setError(
        err.code === "permission-denied"
          ? "You don't have access to this class."
          : "Couldn't load subjects. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }, [schoolCode, className]);

  useEffect(() => {
    load();
  }, [load]);

  // Teachers assigned to this class — the candidates for teaching a subject.
  // When editing a row whose teacher is no longer assigned, keep them visible.
  const teacherOptions = useMemo(() => {
    const assigned = teachers.filter((t) =>
      t.classesAssigned.includes(className)
    );
    if (teacherId && !assigned.some((t) => t.id === teacherId)) {
      const current = teachers.find((t) => t.id === teacherId);
      if (current) return [current, ...assigned];
    }
    return assigned;
  }, [teachers, className, teacherId]);

  // Subject suggestions from every teacher's subject field, deduped.
  const subjectSuggestions = useMemo(() => {
    const set = new Set();
    teachers.forEach((t) => splitSubjects(t.subject).forEach((s) => set.add(s)));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [teachers]);

  const resetForm = () => {
    setSubjectName("");
    setPeriodsPerWeek(5);
    setTeacherId("");
    setEditingIndex(null);
  };

  const persist = async (next) => {
    const base = `schools/${schoolCode}`;
    await setDoc(
      doc(db, `${base}/classes`, className),
      { name: className, subjects: next, updatedAt: serverTimestamp() },
      { merge: true }
    );
    setSubjects(next);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    const name = subjectName.trim();
    if (!name) {
      setError("Subject name is required.");
      return;
    }
    const teacher = teachers.find((t) => t.id === teacherId);
    const entry = {
      subject: name,
      periodsPerWeek: Number(periodsPerWeek) || 1,
      teacherId: teacher?.id || "",
      teacherName: teacher?.name || "",
    };

    setSaving(true);
    try {
      const next =
        editingIndex == null
          ? [...subjects, entry]
          : subjects.map((s, i) => (i === editingIndex ? entry : s));
      await persist(next);
      resetForm();
      onSuccess?.(
        editingIndex == null
          ? `${name} added to ${className}.`
          : `${name} updated.`
      );
    } catch (err) {
      console.error("Save subject failed:", err);
      setError(
        err.code === "permission-denied"
          ? "You don't have permission to update this class."
          : "Couldn't save the subject. Please try again."
      );
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (index) => {
    const s = subjects[index];
    setSubjectName(s.subject || "");
    setPeriodsPerWeek(Number(s.periodsPerWeek) || 1);
    setTeacherId(s.teacherId || "");
    setEditingIndex(index);
  };

  const handleDelete = async () => {
    if (deleteIndex == null) return;
    setSaving(true);
    try {
      const next = subjects.filter((_, i) => i !== deleteIndex);
      await persist(next);
      if (editingIndex === deleteIndex) resetForm();
      setDeleteIndex(null);
    } catch (err) {
      console.error("Delete subject failed:", err);
      setError("Couldn't delete the subject. Please try again.");
      setDeleteIndex(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-card modal-card-large"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <span className="modal-title">Subjects — {className}</span>
            <div className="modal-subtitle">
              Define subjects and weekly periods
            </div>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal-body">
          {error && <div className="login-error">{error}</div>}

          {loading ? (
            <div className="table-state">
              <div className="route-loading-spinner" />
              <span>Loading subjects…</span>
            </div>
          ) : (
            <>
              {/* Section 1: current subjects */}
              <h3 className="section-heading">
                Current Subjects{" "}
                <span className="section-count">({subjects.length})</span>
              </h3>
              {subjects.length === 0 ? (
                <div className="table-state">No subjects defined yet</div>
              ) : (
                <table className="subject-table">
                  <thead>
                    <tr>
                      <th>Subject</th>
                      <th>Periods/Week</th>
                      <th>Teacher</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subjects.map((s, i) => (
                      <tr key={`${s.subject}-${i}`}>
                        <td className="cell-strong">{s.subject}</td>
                        <td>
                          <span className="periods-badge">
                            {s.periodsPerWeek || 1}x/week
                          </span>
                        </td>
                        <td>{s.teacherName || "—"}</td>
                        <td>
                          <div className="action-btns">
                            <button
                              className="btn-edit"
                              onClick={() => startEdit(i)}
                            >
                              Edit
                            </button>
                            <button
                              className="btn-delete"
                              onClick={() => setDeleteIndex(i)}
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

              {/* Section 2: add / edit subject */}
              <h3 className="section-heading">
                {editingIndex == null ? "Add New Subject" : "Edit Subject"}
              </h3>
              <form onSubmit={handleSubmit}>
                <label className="field">
                  <span className="field-label">Subject Name *</span>
                  <input
                    className="field-input"
                    list="subject-suggestions"
                    value={subjectName}
                    onChange={(e) => setSubjectName(e.target.value)}
                    placeholder="e.g. General Science"
                  />
                  <datalist id="subject-suggestions">
                    {subjectSuggestions.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                </label>

                <div className="field">
                  <span className="field-label">Periods Per Week</span>
                  <div className="freq-btns">
                    {FREQ_OPTIONS.map((n) => (
                      <button
                        type="button"
                        key={n}
                        className={
                          "freq-btn" +
                          (Number(periodsPerWeek) === n ? " active" : "")
                        }
                        onClick={() => setPeriodsPerWeek(n)}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="field">
                  <span className="field-label">Teacher</span>
                  <select
                    className="field-input"
                    value={teacherId}
                    onChange={(e) => setTeacherId(e.target.value)}
                  >
                    <option value="">— Select teacher —</option>
                    {teacherOptions.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                        {t.subject ? ` — ${t.subject}` : ""}
                      </option>
                    ))}
                  </select>
                  {teacherOptions.length === 0 && (
                    <span className="field-hint">
                      No teachers are assigned to {className}. Assign teachers to
                      this class first.
                    </span>
                  )}
                </label>

                <div className="modal-footer">
                  {editingIndex != null && (
                    <button
                      type="button"
                      className="btn-cancel"
                      onClick={resetForm}
                      disabled={saving}
                    >
                      Cancel Edit
                    </button>
                  )}
                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={saving}
                  >
                    {saving
                      ? "Saving…"
                      : editingIndex == null
                      ? "+ Add Subject"
                      : "Update Subject"}
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>

      {deleteIndex != null && (
        <ConfirmDialog
          title="Delete Subject"
          message={`Remove ${subjects[deleteIndex]?.subject} from ${className}?`}
          loading={saving}
          onCancel={() => setDeleteIndex(null)}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}
