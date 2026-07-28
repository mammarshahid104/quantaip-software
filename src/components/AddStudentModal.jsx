// Add / Edit Student modal — writes to schools/{schoolCode}/students
// Pass a `student` prop ({ id, ...data }) to open in edit mode.
// Adding a student also creates the paired parent doc plus the Firebase Auth
// login accounts for both, so they can sign into the mobile app straight away.
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
import { useClasses, NO_CLASSES_MESSAGE } from "../services/classes";
import { createAuthAccount } from "../services/authAccounts";

// Next sequential number from the max existing doc ID (delete-safe).
function nextNumberFrom(docs) {
  let max = 0;
  for (const d of docs) {
    const m = String(d.id).match(/(\d+)\s*$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max + 1;
}

const SECTIONS = ["A", "B", "C"];

const firstNameOf = (name) => name.trim().split(/\s+/)[0] || "";

export default function AddStudentModal({
  schoolCode,
  student,
  onClose,
  onSuccess,
}) {
  const isEdit = !!student;

  // Class options come from schools/{schoolCode}/classes — never a fixed list.
  const {
    classes,
    loading: classesLoading,
    empty: noClasses,
  } = useClasses(schoolCode);

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

  // Keep a student's existing class selectable even if it was later removed
  // from the classes collection.
  const classOptions = useMemo(
    () =>
      form.class && !classes.includes(form.class)
        ? [...classes, form.class]
        : classes,
    [classes, form.class]
  );

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
        const parentId = `${schoolCode}-PAR-${padded}`;
        await setDoc(doc(colRef, generatedId), {
          ...fields,
          role: "student",
          school: schoolCode,
          status: "active",
          id: generatedId,
          parentId,
          createdAt: serverTimestamp(),
        });

        // Paired parent account. Parent and student share one password so the
        // admin has a single credential to hand to the family.
        await setDoc(doc(db, `schools/${schoolCode}/parents/${parentId}`), {
          id: parentId,
          name: fields.fatherName,
          phone: fields.parentPhone,
          password: fields.password,
          role: "parent",
          school: schoolCode,
          status: "active",
          studentId: generatedId,
          studentName: fields.fullName,
          createdAt: serverTimestamp(),
        });

        // The Firestore docs are not logins — create the Auth accounts too.
        // Failures here must not roll back or hide the saved student, so they
        // only downgrade the success banner to a warning.
        const failed = [];
        for (const [label, id] of [
          ["student", generatedId],
          ["parent", parentId],
        ]) {
          try {
            await createAuthAccount(id, fields.password);
          } catch (authErr) {
            console.error(`${label} auth account creation failed:`, authErr);
            failed.push(label);
          }
        }

        onSuccess?.(
          failed.length
            ? `Student added — but ${failed.join(" and ")} login account ` +
                `creation failed. Run the account setup script for this student.`
            : "Student added successfully!"
        );
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
                disabled={classesLoading || noClasses}
              >
                <option value="">
                  {classesLoading ? "Loading classes…" : "Select class…"}
                </option>
                {classOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              {noClasses && (
                <span className="field-hint">⚠️ {NO_CLASSES_MESSAGE}</span>
              )}
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
