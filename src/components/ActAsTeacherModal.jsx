// Teacher picker for proxy mode. Lists the school's active teachers; picking
// one puts the app into "acting as" mode until the banner's exit button.
// Props: schoolCode, onClose
import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase/config";
import { useActingTeacher } from "../services/actingTeacher";

function teacherName(d) {
  return d.fullName || d.name || "Unknown";
}

export default function ActAsTeacherModal({ schoolCode, onClose }) {
  const { actAs } = useActingTeacher();

  const [teachers, setTeachers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(
          collection(db, `schools/${schoolCode}/teachers`)
        );
        const rows = snap.docs
          .map((d) => {
            const t = d.data();
            return {
              id: d.id,
              name: teacherName(t),
              subject: t.subject || "",
              status: String(t.status || "active").toLowerCase(),
              classesAssigned: Array.isArray(t.classesAssigned)
                ? t.classesAssigned
                : t.classesAssigned
                ? [t.classesAssigned]
                : [],
            };
          })
          // Teachers who have left can't be acted as.
          .filter((t) => t.status !== "inactive")
          .sort((a, b) => a.name.localeCompare(b.name));
        if (!cancelled) setTeachers(rows);
      } catch (err) {
        if (cancelled) return;
        console.error("Load teachers (act as) failed:", err);
        setError(
          err.code === "permission-denied"
            ? "You don't have access to this school's teachers."
            : "Couldn't load teachers. Please try again."
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [schoolCode]);

  const selected = useMemo(
    () => teachers.find((t) => t.id === selectedId) || null,
    [teachers, selectedId]
  );

  const start = () => {
    if (!selected) return;
    actAs({
      id: selected.id,
      name: selected.name,
      subject: selected.subject,
      classesAssigned: selected.classesAssigned,
    });
    onClose?.();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Act as Teacher</span>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal-body">
          {error && <div className="login-error">{error}</div>}

          <p className="page-subtitle" style={{ marginTop: 0 }}>
            Operate the app on a teacher&apos;s behalf — for staff who
            don&apos;t have a phone to use the mobile app. Their name is
            recorded on the work exactly as if they had entered it themselves.
          </p>

          <label className="field">
            <span className="field-label">Teacher</span>
            <select
              className="field-input"
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              disabled={loading || teachers.length === 0}
              autoFocus
            >
              <option value="">
                {loading ? "Loading teachers…" : "— Select a teacher —"}
              </option>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.subject ? ` · ${t.subject}` : ""}
                </option>
              ))}
            </select>
          </label>

          {!loading && teachers.length === 0 && !error && (
            <div className="warn-banner" style={{ fontSize: 13 }}>
              ⚠️ No active teachers found. Add a teacher from the{" "}
              <strong>Teachers</strong> tab first.
            </div>
          )}

          {selected && (
            <div className="import-step" style={{ marginTop: 4 }}>
              <div className="import-step-title">
                Classes you&apos;ll see as {selected.name}
              </div>
              {selected.classesAssigned.length ? (
                <p className="page-subtitle" style={{ margin: 0 }}>
                  {selected.classesAssigned.join(" · ")}
                </p>
              ) : (
                <p className="field-hint" style={{ margin: 0 }}>
                  ⚠️ This teacher has no classes assigned, so the class lists
                  will be empty. Assign classes from the Teachers tab first.
                </p>
              )}
            </div>
          )}

          <p className="field-hint">
            You stay signed in as the admin the whole time — this only changes
            what the screen shows and whose name goes on the work. Every action
            is also stamped with your admin ID for the audit trail.
          </p>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn-cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={start}
            disabled={!selected}
          >
            Act as Teacher
          </button>
        </div>
      </div>
    </div>
  );
}
