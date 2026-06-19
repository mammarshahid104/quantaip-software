// Add / Edit Teacher modal — writes to schools/{schoolCode}/teachers
// Pass a `teacher` prop ({ id, ...data }) to open in edit mode.
import { useMemo, useState } from "react";
import {
  collection,
  doc,
  setDoc,
  updateDoc,
  getCountFromServer,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase/config";

const CLASSES = [
  "Nursery",
  "Prep",
  "KG",
  ...Array.from({ length: 12 }, (_, i) => `Grade ${i + 1}`),
];

const firstNameOf = (name) => name.trim().split(/\s+/)[0] || "";

export default function AddTeacherModal({
  schoolCode,
  teacher,
  onClose,
  onSuccess,
}) {
  const isEdit = !!teacher;

  const randomNum = useMemo(
    () => Math.floor(1000 + Math.random() * 9000),
    []
  );

  const [form, setForm] = useState({
    name: teacher?.name || "",
    subject: teacher?.subject || "",
    classesAssigned: Array.isArray(teacher?.classesAssigned)
      ? teacher.classesAssigned
      : [],
    phone: teacher?.phone || "",
    password: teacher?.password || "",
  });
  const [passwordTouched, setPasswordTouched] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const update = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const handleNameChange = (value) => {
    setForm((f) => ({
      ...f,
      name: value,
      password: passwordTouched
        ? f.password
        : `${firstNameOf(value)}${randomNum}`,
    }));
  };

  const toggleClass = (cls) => {
    setForm((f) => ({
      ...f,
      classesAssigned: f.classesAssigned.includes(cls)
        ? f.classesAssigned.filter((c) => c !== cls)
        : [...f.classesAssigned, cls],
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (
      !form.name.trim() ||
      !form.subject.trim() ||
      !form.phone.trim() ||
      !form.password.trim()
    ) {
      setError("Please fill in all required fields.");
      return;
    }

    setSaving(true);
    try {
      const colRef = collection(db, `schools/${schoolCode}/teachers`);
      const fields = {
        name: form.name.trim(),
        subject: form.subject.trim(),
        classesAssigned: form.classesAssigned,
        phone: form.phone.trim(),
        password: form.password,
      };

      if (isEdit) {
        await updateDoc(doc(colRef, teacher.id), fields);
        onSuccess?.("Teacher updated successfully!");
      } else {
        const countSnap = await getCountFromServer(colRef);
        const next = countSnap.data().count + 1;
        const padded = String(next).padStart(4, "0");
        const generatedId = `${schoolCode}-TCH-${padded}`;
        await setDoc(doc(colRef, generatedId), {
          ...fields,
          role: "teacher",
          school: schoolCode,
          status: "active",
          id: generatedId,
          createdAt: serverTimestamp(),
        });
        onSuccess?.("Teacher added successfully!");
      }
      onClose?.();
    } catch (err) {
      console.error("Save teacher failed:", err);
      setError(
        err.code === "permission-denied"
          ? "You don't have permission to save teachers."
          : "Couldn't save teacher. Please try again."
      );
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">
            {isEdit ? "Edit Teacher" : "Add Teacher"}
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
                value={form.name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="e.g. Sara Ahmed"
                autoFocus
              />
            </label>

            <label className="field">
              <span className="field-label">Subject *</span>
              <input
                className="field-input"
                type="text"
                value={form.subject}
                onChange={(e) => update("subject", e.target.value)}
                placeholder="e.g. Mathematics"
              />
            </label>

            <div className="field">
              <span className="field-label">Classes Assigned</span>
              <div className="checkbox-grid">
                {CLASSES.map((c) => (
                  <label className="checkbox-item" key={c}>
                    <input
                      type="checkbox"
                      checked={form.classesAssigned.includes(c)}
                      onChange={() => toggleClass(c)}
                    />
                    {c}
                  </label>
                ))}
              </div>
            </div>

            <label className="field">
              <span className="field-label">Phone *</span>
              <input
                className="field-input"
                type="tel"
                value={form.phone}
                onChange={(e) => update("phone", e.target.value)}
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
                ? "Update Teacher"
                : "Save Teacher"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
