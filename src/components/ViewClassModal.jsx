// View Class detail modal — shows class info, the students in the class, and
// the teachers who teach it. Students come from schools/{schoolCode}/students
// where d["class"] === className; teachers from .../teachers where
// classesAssigned includes className.
import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase/config";

function studentName(d) {
  return d.fullName || d.name || "Unknown";
}
function teacherName(d) {
  return d.fullName || d.name || "Unknown";
}
function sectionSort(a, b) {
  return String(a).localeCompare(String(b));
}

export default function ViewClassModal({ schoolCode, className, onClose }) {
  const [students, setStudents] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [classTeacher, setClassTeacher] = useState("—");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const base = `schools/${schoolCode}`;
        const [studentsSnap, teachersSnap, classesSnap] = await Promise.all([
          getDocs(collection(db, `${base}/students`)),
          getDocs(collection(db, `${base}/teachers`)),
          getDocs(collection(db, `${base}/classes`)),
        ]);

        // Students in this class.
        const classStudents = studentsSnap.docs
          .map((doc) => ({ id: doc.id, ...doc.data() }))
          .filter((d) => d["class"] === className)
          .map((d) => ({
            id: d.id,
            rollNo: d.rollNo || "—",
            name: studentName(d),
            section: d.section || "—",
            status: (d.status || "active").toLowerCase(),
          }))
          .sort((a, b) =>
            String(a.rollNo).localeCompare(String(b.rollNo), undefined, {
              numeric: true,
            })
          );

        // Teachers who teach this class.
        const classTeachers = teachersSnap.docs
          .map((doc) => doc.data())
          .filter((t) => {
            const assigned = Array.isArray(t.classesAssigned)
              ? t.classesAssigned
              : t.classesAssigned
              ? [t.classesAssigned]
              : [];
            return assigned.includes(className);
          })
          .map((t) => ({
            name: teacherName(t),
            subject: t.subject || "—",
          }));

        // Class teacher: prefer the formal class doc, fall back to any teacher
        // assigned to the class.
        const classDoc = classesSnap.docs.find((d) => d.id === className);
        const formalTeacher = classDoc?.data()?.classTeacher;
        const resolvedTeacher =
          (formalTeacher && formalTeacher.trim()) ||
          classTeachers[0]?.name ||
          "—";

        if (!cancelled) {
          setStudents(classStudents);
          setTeachers(classTeachers);
          setClassTeacher(resolvedTeacher);
        }
      } catch (err) {
        if (cancelled) return;
        console.error("Class detail load failed:", err);
        setError(
          err.code === "permission-denied"
            ? "You don't have access to this class."
            : "Couldn't load class details. Please try again."
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [schoolCode, className]);

  const sections = useMemo(() => {
    const set = new Set(
      students.map((s) => s.section).filter((s) => s && s !== "—")
    );
    return Array.from(set).sort(sectionSort);
  }, [students]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-card modal-card-large"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <span className="modal-title">{className}</span>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal-body">
          {error && <div className="login-error">{error}</div>}

          {loading ? (
            <div className="table-state">
              <div className="route-loading-spinner" />
              <span>Loading class details…</span>
            </div>
          ) : (
            <>
              {/* A) Class info */}
              <h3 className="section-heading">Class Info</h3>
              <div className="class-info-grid">
                <div className="info-item">
                  <span className="info-label">Class Name</span>
                  <span className="info-value">{className}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">Total Students</span>
                  <span className="info-value">{students.length}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">Sections</span>
                  <span className="info-value">
                    {sections.length > 0 ? sections.join(", ") : "—"}
                  </span>
                </div>
                <div className="info-item">
                  <span className="info-label">Class Teacher</span>
                  <span className="info-value">{classTeacher}</span>
                </div>
              </div>

              {/* B) Students list */}
              <h3 className="section-heading">
                Students <span className="section-count">({students.length})</span>
              </h3>
              <div className="modal-table-scroll">
                {students.length === 0 ? (
                  <div className="table-state">
                    No students assigned to this class yet
                  </div>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Roll No</th>
                        <th>Name</th>
                        <th>Section</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {students.map((s) => (
                        <tr key={s.id}>
                          <td>{s.rollNo}</td>
                          <td className="cell-strong">{s.name}</td>
                          <td>{s.section}</td>
                          <td>
                            <span
                              className={
                                "badge " +
                                (s.status === "active"
                                  ? "badge-ok"
                                  : "badge-warn")
                              }
                            >
                              {s.status.charAt(0).toUpperCase() +
                                s.status.slice(1)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* C) Teachers list */}
              <h3 className="section-heading">
                Teachers <span className="section-count">({teachers.length})</span>
              </h3>
              {teachers.length === 0 ? (
                <div className="table-state">
                  No teachers assigned to this class yet
                </div>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Subject</th>
                    </tr>
                  </thead>
                  <tbody>
                    {teachers.map((t, i) => (
                      <tr key={`${t.name}-${i}`}>
                        <td className="cell-strong">{t.name}</td>
                        <td>{t.subject}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
