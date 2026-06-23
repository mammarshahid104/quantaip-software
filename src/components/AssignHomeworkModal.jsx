// Assign Homework modal — appends an item to schools/{schoolCode}/homework/{className}
// using arrayUnion + setDoc(merge) so existing homework is preserved.
import { useEffect, useMemo, useState } from "react";
import {
  collection,
  getDocs,
  doc,
  setDoc,
  arrayUnion,
} from "firebase/firestore";
import { db } from "../firebase/config";

const CLASSES = [
  "Nursery",
  "Prep",
  "KG",
  ...Array.from({ length: 12 }, (_, i) => `Grade ${i + 1}`),
];

// Today as YYYY-MM-DD (local) for the date input's min + default.
function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function AssignHomeworkModal({
  schoolCode,
  defaultClass,
  onClose,
  onSuccess,
}) {
  const today = todayStr();

  const [teachers, setTeachers] = useState([]); // [{ name, subject }]
  const [form, setForm] = useState({
    className: defaultClass && CLASSES.includes(defaultClass) ? defaultClass : "Nursery",
    subject: "",
    title: "",
    description: "",
    dueDate: today,
    assignedBy: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const update = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  // Load teachers to populate the Subject + Assigned By dropdowns.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(
          collection(db, `schools/${schoolCode}/teachers`)
        );
        const rows = snap.docs.map((d) => {
          const t = d.data();
          return {
            name: t.name || t.fullName || "",
            subject: (t.subject || "").trim(),
          };
        });
        if (!cancelled) setTeachers(rows);
      } catch (err) {
        console.error("Load teachers (homework) failed:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [schoolCode]);

  const subjects = useMemo(() => {
    const set = new Set(teachers.map((t) => t.subject).filter(Boolean));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [teachers]);

  const teacherNames = useMemo(() => {
    const set = new Set(teachers.map((t) => t.name).filter(Boolean));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [teachers]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!form.subject.trim()) {
      setError("Please select a subject.");
      return;
    }
    if (!form.title.trim() || !form.description.trim() || !form.dueDate) {
      setError("Please fill in all required fields.");
      return;
    }

    setSaving(true);
    try {
      const item = {
        id: Date.now().toString(),
        subject: form.subject,
        title: form.title.trim(),
        description: form.description.trim(),
        dueDate: form.dueDate,
        assignedBy: form.assignedBy || "—",
        // Mobile reads `teacherName` and `assignedDate` (YYYY-MM-DD) for the
        // homework footer; write them alongside the web's own fields.
        teacherName: form.assignedBy || "",
        assignedDate: new Date().toISOString().split("T")[0],
        assignedAt: new Date().toISOString(),
        // NOTE: serverTimestamp() cannot be used inside arrayUnion (Firestore
        // forbids sentinels inside arrays), so we store a client timestamp.
        createdAt: Date.now(),
      };

      await setDoc(
        doc(db, `schools/${schoolCode}/homework/${form.className}`),
        { items: arrayUnion(item) },
        { merge: true }
      );

      onSuccess?.(`Homework assigned to ${form.className} successfully!`);
      onClose?.();
    } catch (err) {
      console.error("Assign homework failed:", err);
      setError(
        err.code === "permission-denied"
          ? "You don't have permission to assign homework."
          : "Couldn't assign homework. Please try again."
      );
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={saving ? undefined : onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Assign Homework</span>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="login-error">{error}</div>}

            <label className="field">
              <span className="field-label">Class *</span>
              <select
                className="field-input"
                value={form.className}
                onChange={(e) => update("className", e.target.value)}
              >
                {CLASSES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field-label">Subject *</span>
              <select
                className="field-input"
                value={form.subject}
                onChange={(e) => update("subject", e.target.value)}
              >
                <option value="">— Select subject —</option>
                {subjects.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
                {/* Preserve a chosen subject not in the current list */}
                {form.subject && !subjects.includes(form.subject) && (
                  <option value={form.subject}>{form.subject}</option>
                )}
              </select>
            </label>

            <label className="field">
              <span className="field-label">Title *</span>
              <input
                className="field-input"
                type="text"
                value={form.title}
                onChange={(e) => update("title", e.target.value)}
                placeholder="e.g. Complete Exercise 5"
                autoFocus
              />
            </label>

            <label className="field">
              <span className="field-label">Description *</span>
              <textarea
                className="field-input"
                rows={3}
                value={form.description}
                onChange={(e) => update("description", e.target.value)}
                placeholder="e.g. Solve all questions from page 45-47"
              />
            </label>

            <label className="field">
              <span className="field-label">Due Date *</span>
              <input
                className="field-input"
                type="date"
                min={today}
                value={form.dueDate}
                onChange={(e) => update("dueDate", e.target.value)}
              />
            </label>

            <label className="field">
              <span className="field-label">Assigned By</span>
              <select
                className="field-input"
                value={form.assignedBy}
                onChange={(e) => update("assignedBy", e.target.value)}
              >
                <option value="">— Select teacher —</option>
                {teacherNames.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="btn-cancel"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? "Assigning…" : "Assign Homework"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
