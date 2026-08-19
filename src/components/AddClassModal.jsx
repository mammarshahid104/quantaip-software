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
import { useSections, matchSection } from "../services/sections";
import ComboBox from "./ComboBox";

function teacherName(d) {
  return d.fullName || d.name || "Unknown";
}

export default function AddClassModal({ schoolCode, onClose, onSuccess }) {
  const [form, setForm] = useState({
    name: "",
    section: "",
    classIncharge: "",
  });
  // Existing section names for this school — A/B/C, "Purple", anything.
  const { sections } = useSections(schoolCode);
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
        // Store both id and name; classIncharge needs the teacher's doc ID
        // (e.g. "GHS-001-TCH-0010") to match the mobile app.
        const list = snap.docs
          .map((d) => {
            const data = d.data();
            return { id: data.id || d.id, name: teacherName(data) };
          })
          .filter((t) => t.name && t.name !== "Unknown")
          .sort((a, b) => a.name.localeCompare(b.name));
        if (!cancelled) setTeachers(list);
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
      const teacher = teachers.find((t) => t.id === form.classIncharge);
      // Reuse the school's existing spelling when the typed name matches one.
      const section =
        matchSection(sections, form.section) || form.section.trim();
      await setDoc(
        doc(db, `schools/${schoolCode}/classes`, name),
        {
          name,
          section: section,
          // Mobile (ClassesScreen) stores sections as an array; mirror it.
          sections: section ? [section] : [],
          classIncharge: teacher?.id || "",
          classInchargeName: teacher?.name || "",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
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

            <div className="field">
              <span className="field-label">Section</span>
              <ComboBox
                value={form.section}
                onChange={(v) => update("section", v)}
                options={sections}
                placeholder="e.g. A, Purple, Mango"
              />
              <span className="field-hint">
                Pick an existing section or type a new name.
              </span>
            </div>

            <label className="field">
              <span className="field-label">Class Incharge</span>
              <select
                className="field-input"
                value={form.classIncharge}
                onChange={(e) => update("classIncharge", e.target.value)}
              >
                <option value="">— None —</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
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
