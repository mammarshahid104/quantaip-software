// Daily Diary generator modal — pick class/date/school, then export a PDF.
import { useState } from "react";
import { generateDiary } from "../services/generateDiary";
import { useClasses, NO_CLASSES_MESSAGE } from "../services/classes";

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function DiaryModal({
  schoolCode,
  defaultClass,
  onClose,
  onSuccess,
}) {
  // Class options come from schools/{schoolCode}/classes — never a fixed list.
  const {
    classes,
    loading: classesLoading,
    empty: noClasses,
  } = useClasses(schoolCode);

  const [form, setForm] = useState({
    className: defaultClass || "",
    date: todayStr(),
    schoolName: localStorage.getItem("schoolName") || "Green Hills School",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const update = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  // Nothing picked yet → fall back to the first class once the list arrives.
  const className = form.className || classes[0] || "";

  const handleGenerate = async (e) => {
    e.preventDefault();
    setError("");

    if (!className || !form.date || !form.schoolName.trim()) {
      setError("Please fill in all fields.");
      return;
    }

    setBusy(true);
    try {
      await generateDiary({
        schoolCode,
        className,
        date: form.date,
        schoolName: form.schoolName.trim(),
      });
      onSuccess?.(`Diary generated for ${className}.`);
      onClose?.();
    } catch (err) {
      console.error("Generate diary failed:", err);
      setError(
        err.code === "permission-denied"
          ? "You don't have access to this school's data."
          : "Couldn't generate the diary. Please try again."
      );
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">📄 Generate Daily Diary</span>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <form onSubmit={handleGenerate}>
          <div className="modal-body">
            {error && <div className="login-error">{error}</div>}

            <label className="field">
              <span className="field-label">Class *</span>
              <select
                className="field-input"
                value={className}
                onChange={(e) => update("className", e.target.value)}
                disabled={classesLoading || noClasses}
              >
                <option value="">
                  {classesLoading ? "Loading classes…" : "Select class…"}
                </option>
                {classes.map((c) => (
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
              <span className="field-label">Date *</span>
              <input
                className="field-input"
                type="date"
                value={form.date}
                onChange={(e) => update("date", e.target.value)}
              />
            </label>

            <label className="field">
              <span className="field-label">School Name *</span>
              <input
                className="field-input"
                type="text"
                value={form.schoolName}
                onChange={(e) => update("schoolName", e.target.value)}
                placeholder="e.g. Green Hills School"
              />
            </label>
          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="btn-cancel"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? "Generating…" : "Generate PDF"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
