// Teacher detail modal — read-only overview of a single teacher.
// Pulls the teacher doc plus the classes this teacher is incharge of:
//   schools/{schoolCode}/teachers/{teacherId}                full profile
//   schools/{schoolCode}/classes where classIncharge === teacherId
import { useCallback, useEffect, useState } from "react";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase/config";

function DetailItem({ label, children }) {
  return (
    <div className="detail-item">
      <span className="detail-label">{label}</span>
      <span className="detail-value">{children}</span>
    </div>
  );
}

// A class doc's display name, falling back through the common field names.
function className(d, id) {
  return d.name || d.className || d.grade || id;
}

export default function TeacherDetailModal({ schoolCode, teacherId, onClose }) {
  const [teacher, setTeacher] = useState(null);
  const [inchargeClasses, setInchargeClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showPwd, setShowPwd] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const base = `schools/${schoolCode}`;
      const teacherSnap = await getDoc(doc(db, `${base}/teachers/${teacherId}`));
      if (!teacherSnap.exists()) {
        setError("This teacher no longer exists.");
        setLoading(false);
        return;
      }
      setTeacher({ id: teacherSnap.id, ...teacherSnap.data() });

      // Classes where this teacher is the incharge — tolerate a miss.
      try {
        const classSnap = await getDocs(
          query(
            collection(db, `${base}/classes`),
            where("classIncharge", "==", teacherId)
          )
        );
        setInchargeClasses(
          classSnap.docs.map((c) => className(c.data(), c.id))
        );
      } catch (classErr) {
        console.error("Class incharge lookup failed:", classErr);
        setInchargeClasses([]);
      }
    } catch (err) {
      console.error("Teacher detail load failed:", err);
      setError(
        err.code === "permission-denied"
          ? "You don't have access to this teacher's details."
          : "Couldn't load teacher details. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }, [schoolCode, teacherId]);

  useEffect(() => {
    load();
  }, [load]);

  const d = teacher || {};
  const status = (d.status || "active").toLowerCase();
  const name = d.fullName || d.name || "Teacher";
  const classesAssigned = Array.isArray(d.classesAssigned)
    ? d.classesAssigned
    : d.classesAssigned
    ? [d.classesAssigned]
    : [];
  const loginEmail = `${teacherId.toLowerCase()}@quantaip.edu.pk`;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-card modal-card-large"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <span className="modal-title">{name}</span>
            {!loading && teacher && (
              <div className="modal-subtitle">
                {d.subject || "—"} · {d.id}
              </div>
            )}
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal-body">
          {error && <div className="login-error">{error}</div>}

          {loading ? (
            <div className="table-state">
              <div className="route-loading-spinner" />
              <span>Loading teacher details…</span>
            </div>
          ) : teacher ? (
            <>
              {/* Section 1: Teacher info */}
              <div className="detail-section">
                <div className="detail-section-title">🧑‍🏫 Teacher Info</div>
                <div className="detail-grid">
                  <DetailItem label="Teacher ID">{d.id}</DetailItem>
                  <DetailItem label="Full Name">{name}</DetailItem>
                  <DetailItem label="Subject">{d.subject || "—"}</DetailItem>
                  <DetailItem label="Phone">
                    {d.phone || d.phoneNumber || d.contact || "—"}
                  </DetailItem>
                  <div className="detail-item">
                    <span className="detail-label">Status</span>
                    <span>
                      <span
                        className={
                          "badge " +
                          (status === "active" ? "badge-ok" : "badge-warn")
                        }
                      >
                        {status.charAt(0).toUpperCase() + status.slice(1)}
                      </span>
                    </span>
                  </div>
                  <DetailItem label="School">{d.school || schoolCode}</DetailItem>
                  <DetailItem label="Role">Teacher</DetailItem>
                  <div className="detail-item">
                    <span className="detail-label">Password</span>
                    <div className="pwd-row">
                      <span className="detail-value">
                        {d.password
                          ? showPwd
                            ? d.password
                            : "••••••••"
                          : "—"}
                      </span>
                      {d.password && (
                        <button
                          type="button"
                          className="pwd-toggle"
                          onClick={() => setShowPwd((s) => !s)}
                        >
                          {showPwd ? "Hide" : "Show"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Section 2: Classes assigned */}
              <div className="detail-section">
                <div className="detail-section-title">📚 Classes Assigned</div>
                {classesAssigned.length > 0 ? (
                  <div className="class-chips">
                    {classesAssigned.map((c, i) => (
                      <span className="class-chip" key={`${c}-${i}`}>
                        {c}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="table-state">No classes assigned yet</div>
                )}
              </div>

              {/* Section 3: Class incharge + login */}
              <div className="detail-section">
                <div className="detail-section-title">🏫 Class Incharge</div>
                {inchargeClasses.length > 0 ? (
                  <div className="class-chips">
                    {inchargeClasses.map((c, i) => (
                      <span className="class-chip incharge" key={`${c}-${i}`}>
                        {c}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="table-state">Not a class incharge</div>
                )}
                <div className="detail-grid" style={{ marginTop: 14 }}>
                  <DetailItem label="Login Email">{loginEmail}</DetailItem>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
