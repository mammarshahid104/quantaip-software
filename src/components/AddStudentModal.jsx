// Add / Edit Student modal — writes to schools/{schoolCode}/students
// Pass a `student` prop ({ id, ...data }) to open in edit mode.
import { useMemo, useState } from "react";
import {
  collection,
  doc,
  setDoc,
  updateDoc,
  getDocs,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase/config";

// Next sequential number from the max existing doc ID (delete-safe).
function nextNumberFrom(docs) {
  let max = 0;
  for (const d of docs) {
    const m = String(d.id).match(/(\d+)\s*$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max + 1;
}

const CLASSES = [
  "Nursery",
  "Prep",
  "KG",
  ...Array.from({ length: 12 }, (_, i) => `Grade ${i + 1}`),
];
const SECTIONS = ["A", "B", "C"];

const firstNameOf = (name) => name.trim().split(/\s+/)[0] || "";

export default function AddStudentModal({
  schoolCode,
  student,
  onClose,
  onSuccess,
}) {
  const isEdit = !!student;

  // Random 4-digit suffix generated once when the modal opens (add mode only).
  const randomNum = useMemo(
    () => Math.floor(1000 + Math.random() * 9000),
    []
  );

  const [form, setForm] = useState({
    fullName: student?.fullName || "",
    class: student?.class || "",
    section: student?.section || "",
    rollNo: student?.rollNo || "",
    fatherName: student?.fatherName || "",
    parentPhone: student?.parentPhone || "",
    password: student?.password || "",
  });
  // In edit mode the password is pre-filled; don't auto-regenerate it.
  const [passwordTouched, setPasswordTouched] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const update = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  // Name drives the auto-generated password until the user edits it.
  const handleNameChange = (value) => {
    setForm((f) => ({
      ...f,
      fullName: value,
      password: passwordTouched
        ? f.password
        : `${firstNameOf(value)}${randomNum}`,
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    const required = [
      "fullName",
      "class",
      "section",
      "rollNo",
      "fatherName",
      "parentPhone",
      "password",
    ];
    if (required.some((k) => !String(form[k]).trim())) {
      setError("Please fill in all required fields.");
      return;
    }

    setSaving(true);
    try {
      const colRef = collection(db, `schools/${schoolCode}/students`);
      const fields = {
        fullName: form.fullName.trim(),
        class: form.class,
        section: form.section,
        rollNo: form.rollNo.trim(),
        fatherName: form.fatherName.trim(),
        parentPhone: form.parentPhone.trim(),
        password: form.password,
      };

      if (isEdit) {
        await updateDoc(doc(colRef, student.id), fields);
        onSuccess?.("Student updated successfully!");
      } else {
        const snap = await getDocs(colRef);
        const next = nextNumberFrom(snap.docs);
        const padded = String(next).padStart(4, "0");
        const generatedId = `${schoolCode}-STU-${padded}`;
        await setDoc(doc(colRef, generatedId), {
          ...fields,
          role: "student",
          school: schoolCode,
          status: "active",
          id: generatedId,
          parentId: `${schoolCode}-PAR-${padded}`,
          createdAt: serverTimestamp(),
        });
        onSuccess?.("Student added successfully!");
      }
      onClose?.();
    } catch (err) {
      console.error("Save student failed:", err);
      setError(
        err.code === "permission-denied"
          ? "You don't have permission to save students."
          : "Couldn't save student. Please try again."
      );
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">
            {isEdit ? "Edit Student" : "Add Student"}
          </span>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="login-error">{error}</div>}

            <label className="field">
              <span className="field-label">Full Name *</span>
              <input
                className="field-input"
                type="text"
                value={form.fullName}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="e.g. Abdullah Khan"
                autoFocus
              />
            </label>

            <label className="field">
              <span className="field-label">Class *</span>
              <select
                className="field-input"
                value={form.class}
                onChange={(e) => update("class", e.target.value)}
              >
                <option value="">Select class…</option>
                {CLASSES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field-label">Section *</span>
              <select
                className="field-input"
                value={form.section}
                onChange={(e) => update("section", e.target.value)}
              >
                <option value="">Select section…</option>
                {SECTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field-label">Roll No *</span>
              <input
                className="field-input"
                type="text"
                value={form.rollNo}
                onChange={(e) => update("rollNo", e.target.value)}
                placeholder="e.g. 15"
              />
            </label>

            <label className="field">
              <span className="field-label">Father Name *</span>
              <input
                className="field-input"
                type="text"
                value={form.fatherName}
                onChange={(e) => update("fatherName", e.target.value)}
                placeholder="e.g. Imran Khan"
              />
            </label>

            <label className="field">
              <span className="field-label">Parent Phone *</span>
              <input
                className="field-input"
                type="tel"
                value={form.parentPhone}
                onChange={(e) => update("parentPhone", e.target.value)}
                placeholder="e.g. 0300-1234567"
              />
            </label>

            <label className="field">
              <span className="field-label">Password *</span>
              <input
                className="field-input"
                type="text"
                value={form.password}
                onChange={(e) => {
                  setPasswordTouched(true);
                  update("password", e.target.value);
                }}
                placeholder="Auto-generated"
              />
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
              {saving
                ? "Saving…"
                : isEdit
                ? "Update Student"
                : "Save Student"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
