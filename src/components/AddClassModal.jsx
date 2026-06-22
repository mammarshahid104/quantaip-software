// Add Class modal — creates a formal class document at
// schools/{schoolCode}/classes/{className}. Classes are otherwise derived
// from students' "class" field; this lets a class show up before any
// students are assigned to it.
import { useEffect, useState } from "react";
import {
  collection,
  doc,
  getDocs,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase/config";

function teacherName(d) {
  return d.fullName || d.name || "Unknown";
}

export default function AddClassModal({ schoolCode, onClose, onSuccess }) {
  const [form, setForm] = useState({
    name: "",
    section: "A",
    classTeacher: "",
  });
  const [teachers, setTeachers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const update = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  // Load teacher names for the (optional) class-teacher dropdown.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(
          collection(db, `schools/${schoolCode}/teachers`)
        );
        const names = snap.docs
          .map((d) => teacherName(d.data()))
          .filter((n) => n && n !== "Unknown")
          .sort((a, b) => a.localeCompare(b));
        if (!cancelled) setTeachers(names);
      } catch (err) {
        console.error("Load teachers for class modal failed:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [schoolCode]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    const name = form.name.trim();
    if (!name) {
      setError("Please enter a class name.");
      return;
    }
    // Firestore doc IDs can't contain "/".
    if (name.includes("/")) {
      setError('Class name cannot contain a "/" character.');
      return;
    }

    setSaving(true);
    try {
      await setDoc(doc(db, `schools/${schoolCode}/classes`, name), {
        name,
        section: form.section.trim(),
        classTeacher: form.classTeacher.trim(),
        createdAt: serverTimestamp(),
      });
      onSuccess?.(`Class "${name}" added successfully!`);
      onClose?.();
    } catch (err) {
      console.error("Save class failed:", err);
      setError(
        err.code === "permission-denied"
          ? "You don't have permission to add classes."
          : "Couldn't save class. Please try again."
      );
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Add New Class</span>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="login-error">{error}</div>}

            <label className="field">
              <span className="field-label">Class Name *</span>
              <input
                className="field-input"
                type="text"
                value={form.name}
                onChange={(e) => update("name", e.target.value)}
                placeholder="e.g. Grade 8, Nursery, KG"
                autoFocus
              />
            </label>

            <label className="field">
              <span className="field-label">Section</span>
              <input
                className="field-input"
                type="text"
                value={form.section}
                onChange={(e) => update("section", e.target.value)}
                placeholder="e.g. A"
              />
            </label>

            <label className="field">
              <span className="field-label">Class Teacher</span>
              <select
                className="field-input"
                value={form.classTeacher}
                onChange={(e) => update("classTeacher", e.target.value)}
              >
                <option value="">— None —</option>
                {teachers.map((name) => (
                  <option key={name} value={name}>
                    {name}
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
              {saving ? "Saving…" : "Save Class"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
