// Add / Edit Teacher modal — writes to schools/{schoolCode}/teachers
// Pass a `teacher` prop ({ id, ...data }) to open in edit mode.
import { useEffect, useMemo, useState } from "react";
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

  // Classes where this teacher is currently checked as incharge, plus the
  // original set (from Firestore) so we only write the diff on save.
  const [inchargeClasses, setInchargeClasses] = useState([]);
  const [originalIncharge, setOriginalIncharge] = useState([]);

  const update = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  // On edit, load which classes already have this teacher as incharge
  // (class.classIncharge === teacher.id), to pre-check the boxes.
  useEffect(() => {
    if (!isEdit) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(
          collection(db, `schools/${schoolCode}/classes`)
        );
        const mine = snap.docs
          .filter((d) => d.data().classIncharge === teacher.id)
          .map((d) => d.data().name || d.id);
        if (!cancelled) {
          setInchargeClasses(mine);
          setOriginalIncharge(mine);
        }
      } catch (err) {
        console.error("Load incharge classes failed:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isEdit, schoolCode, teacher?.id]);

  const toggleIncharge = (cls) =>
    setInchargeClasses((prev) =>
      prev.includes(cls) ? prev.filter((c) => c !== cls) : [...prev, cls]
    );

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

      let teacherId;
      if (isEdit) {
        teacherId = teacher.id;
        await updateDoc(doc(colRef, teacherId), fields);
      } else {
        const snap = await getDocs(colRef);
        const next = nextNumberFrom(snap.docs);
        const padded = String(next).padStart(4, "0");
        teacherId = `${schoolCode}-TCH-${padded}`;
        await setDoc(doc(colRef, teacherId), {
          ...fields,
          role: "teacher",
          school: schoolCode,
          status: "active",
          id: teacherId,
          createdAt: serverTimestamp(),
        });
      }

      // Sync class-incharge assignments — only for classes still assigned,
      // and only the diff against what was loaded.
      const classesRef = collection(db, `schools/${schoolCode}/classes`);
      for (const cls of form.classesAssigned) {
        const isChecked = inchargeClasses.includes(cls);
        const wasChecked = originalIncharge.includes(cls);
        if (isChecked && !wasChecked) {
          await setDoc(
            doc(classesRef, cls),
            {
              classIncharge: teacherId,
              classInchargeName: fields.name,
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        } else if (!isChecked && wasChecked) {
          await updateDoc(doc(classesRef, cls), {
            classIncharge: "",
            classInchargeName: "",
            updatedAt: serverTimestamp(),
          });
        }
      }

      onSuccess?.(
        isEdit ? "Teacher updated successfully!" : "Teacher added successfully!"
      );
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

            <div className="field">
              <span className="field-label field-label-incharge">
                Class Incharge
              </span>
              <span className="field-subtext">
                Select classes where this teacher is the class incharge
              </span>
              {form.classesAssigned.length === 0 ? (
                <div className="incharge-empty">Assign classes first</div>
              ) : (
                <div className="checkbox-grid">
                  {form.classesAssigned.map((c) => (
                    <label className="checkbox-item incharge-checkbox-label" key={c}>
                      <input
                        type="checkbox"
                        className="incharge-checkbox-item"
                        checked={inchargeClasses.includes(c)}
                        onChange={() => toggleIncharge(c)}
                      />
                      {c}
                    </label>
                  ))}
                </div>
              )}
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
