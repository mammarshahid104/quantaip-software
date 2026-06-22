// Edit Class Incharge modal — updates classIncharge (teacher doc ID) and
// classInchargeName (display name) on schools/{schoolCode}/classes/{className},
// matching the mobile app's field format.
import { useEffect, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase/config";

function teacherName(d) {
  return d.fullName || d.name || "Unknown";
}

export default function EditInchargeModal({
  schoolCode,
  className,
  onClose,
  onSuccess,
}) {
  const [teachers, setTeachers] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Load teachers + the class's current incharge.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [teachersSnap, classDoc] = await Promise.all([
          getDocs(collection(db, `schools/${schoolCode}/teachers`)),
          getDoc(doc(db, `schools/${schoolCode}/classes`, className)),
        ]);

        const list = teachersSnap.docs
          .map((d) => {
            const data = d.data();
            return { id: data.id || d.id, name: teacherName(data) };
          })
          .filter((t) => t.name && t.name !== "Unknown")
          .sort((a, b) => a.name.localeCompare(b.name));

        if (!cancelled) {
          setTeachers(list);
          setSelectedId(classDoc.exists() ? classDoc.data().classIncharge || "" : "");
        }
      } catch (err) {
        console.error("Load incharge modal failed:", err);
        if (!cancelled) setError("Couldn't load teachers. Please try again.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [schoolCode, className]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const teacher = teachers.find((t) => t.id === selectedId);
      await setDoc(
        doc(db, `schools/${schoolCode}/classes`, className),
        {
          name: className,
          classIncharge: teacher?.id || "",
          classInchargeName: teacher?.name || "",
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      onSuccess?.(
        teacher
          ? `${teacher.name} set as incharge of ${className}.`
          : `Incharge removed from ${className}.`
      );
      onClose?.();
    } catch (err) {
      console.error("Save incharge failed:", err);
      setError(
        err.code === "permission-denied"
          ? "You don't have permission to update this class."
          : "Couldn't save. Please try again."
      );
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Edit Incharge — {className}</span>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="login-error">{error}</div>}

            <label className="field">
              <span className="field-label">Class Incharge</span>
              <select
                className="field-input"
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
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
              {saving ? "Saving…" : "Save Incharge"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
