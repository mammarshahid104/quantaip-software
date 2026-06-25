// Student detail modal — read-only overview of a single student.
// Pulls together three Firestore docs the mobile app also uses:
//   schools/{schoolCode}/students/{studentId}              full profile
//   schools/{schoolCode}/parents/{student.parentId}        parent account
//   schools/{schoolCode}/fees/{month}/students/{studentId} this month's fee
// Attendance is derived from the student's own attendanceMap.
import { useCallback, useEffect, useMemo, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase/config";

// Fee month doc key, in the SAME format the mobile app / Fees page writes: "June 2026".
const feeMonthKey = (date) =>
  date.toLocaleString("default", { month: "long", year: "numeric" });

// Attendance keys are ISO dates ("2026-06-01"); prefix to filter the current month.
const monthPrefix = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

// Tally P / A within the given "YYYY-MM" prefix — mirrors Attendance.jsx.
function tallyMonth(attendanceMap, prefix) {
  let present = 0;
  let absent = 0;
  if (attendanceMap && typeof attendanceMap === "object") {
    for (const [date, val] of Object.entries(attendanceMap)) {
      if (!date.startsWith(prefix)) continue;
      const v = String(val).trim().toLowerCase();
      if (v === "p" || v === "present" || v === "true") present += 1;
      else if (v === "a" || v === "absent" || v === "false") absent += 1;
    }
  }
  return { present, absent };
}

const money = (n) => `Rs ${Number(n || 0).toLocaleString()}`;

// Firestore Timestamp / null → readable date.
function formatDate(ts) {
  if (!ts) return "—";
  try {
    const d =
      typeof ts.toDate === "function"
        ? ts.toDate()
        : new Date(ts.seconds ? ts.seconds * 1000 : ts);
    return d.toLocaleDateString("default", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "—";
  }
}

function DetailItem({ label, children }) {
  return (
    <div className="detail-item">
      <span className="detail-label">{label}</span>
      <span className="detail-value">{children}</span>
    </div>
  );
}

export default function StudentDetailModal({ schoolCode, studentId, onClose }) {
  const now = useMemo(() => new Date(), []);
  const feeMonth = useMemo(() => feeMonthKey(now), [now]);
  const attMonth = useMemo(() => monthPrefix(now), [now]);

  const [student, setStudent] = useState(null);
  const [parent, setParent] = useState(null);
  const [fee, setFee] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [showStudentPwd, setShowStudentPwd] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const base = `schools/${schoolCode}`;
      const studentSnap = await getDoc(doc(db, `${base}/students/${studentId}`));
      if (!studentSnap.exists()) {
        setError("This student no longer exists.");
        setLoading(false);
        return;
      }
      const sData = { id: studentSnap.id, ...studentSnap.data() };
      setStudent(sData);

      // Parent + fee docs are independent — fetch in parallel, tolerate misses.
      const [parentSnap, feeSnap] = await Promise.all([
        sData.parentId
          ? getDoc(doc(db, `${base}/parents/${sData.parentId}`))
          : Promise.resolve(null),
        getDoc(doc(db, `${base}/fees/${feeMonth}/students/${studentId}`)),
      ]);

      setParent(
        parentSnap && parentSnap.exists()
          ? { id: parentSnap.id, ...parentSnap.data() }
          : null
      );
      setFee(feeSnap.exists() ? feeSnap.data() : null);
    } catch (err) {
      console.error("Student detail load failed:", err);
      setError(
        err.code === "permission-denied"
          ? "You don't have access to this student's details."
          : "Couldn't load student details. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }, [schoolCode, studentId, feeMonth]);

  useEffect(() => {
    load();
  }, [load]);

  const d = student || {};
  const status = (d.status || "active").toLowerCase();

  // Attendance summary for the current month.
  const { present, absent } = useMemo(
    () => tallyMonth(d.attendanceMap, attMonth),
    [d.attendanceMap, attMonth]
  );
  const totalDays = present + absent;
  const attPct = totalDays > 0 ? Math.round((present / totalDays) * 100) : null;
  const attBadge =
    attPct == null
      ? { cls: "badge-warn", label: "No data" }
      : attPct >= 75
      ? { cls: "badge-ok", label: "Good" }
      : attPct >= 50
      ? { cls: "badge-warn", label: "At Risk" }
      : { cls: "badge-red", label: "Critical" };

  const parentId = parent?.id || d.parentId || "";
  const loginEmail = parentId
    ? `${parentId.toLowerCase()}@quantaip.edu.pk`
    : "—";

  const feePaid = fee?.status === "paid";

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-card modal-card-large"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <span className="modal-title">{d.fullName || "Student"}</span>
            {!loading && student && (
              <div className="modal-subtitle">
                {d.class || "—"} · Section {d.section || "—"} · Roll No{" "}
                {d.rollNo || "—"}
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
              <span>Loading student details…</span>
            </div>
          ) : student ? (
            <>
              {/* Section 1: Student info */}
              <div className="detail-section">
                <div className="detail-section-title">🎓 Student Info</div>
                <div className="detail-grid">
                  <DetailItem label="Student ID">{d.id}</DetailItem>
                  <div className="detail-item">
                    <span className="detail-label">Password</span>
                    <div className="pwd-row">
                      <span className="detail-value">
                        {showStudentPwd ? d.password || "—" : "••••••••"}
                      </span>
                      <button
                        type="button"
                        className="pwd-toggle"
                        onClick={() => setShowStudentPwd((p) => !p)}
                      >
                        {showStudentPwd ? "Hide" : "Show"}
                      </button>
                    </div>
                  </div>
                  <DetailItem label="Full Name">{d.fullName || "—"}</DetailItem>
                  <DetailItem label="Class">{d.class || "—"}</DetailItem>
                  <DetailItem label="Section">{d.section || "—"}</DetailItem>
                  <DetailItem label="Roll No">{d.rollNo || "—"}</DetailItem>
                  <DetailItem label="Father Name">
                    {d.fatherName || "—"}
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
                </div>
              </div>

              {/* Section 2: Parent info */}
              <div className="detail-section">
                <div className="detail-section-title">👨‍👩‍👧 Parent Info</div>
                {parentId ? (
                  <div className="detail-grid">
                    <DetailItem label="Parent ID">{parentId}</DetailItem>
                    <DetailItem label="Phone">
                      {d.parentPhone || parent?.phone || "—"}
                    </DetailItem>
                    <DetailItem label="Login Email">{loginEmail}</DetailItem>
                    <div className="detail-item">
                      <span className="detail-label">Password</span>
                      <div className="pwd-row">
                        <span className="detail-value">
                          {parent?.password
                            ? showPwd
                              ? parent.password
                              : "••••••••"
                            : "—"}
                        </span>
                        {parent?.password && (
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
                ) : (
                  <div className="table-state">Parent account not set up yet</div>
                )}
              </div>

              {/* Section 3: Attendance */}
              <div className="detail-section">
                <div className="detail-section-title">📊 Attendance</div>
                <div className="att-summary">
                  <div className="att-stat">
                    <div className="att-stat-value">
                      {attPct == null ? "—" : `${attPct}%`}
                    </div>
                    <div className="att-stat-label">This Month</div>
                  </div>
                  <div className="att-stat">
                    <div className="att-stat-value">{present}</div>
                    <div className="att-stat-label">Present</div>
                  </div>
                  <div className="att-stat">
                    <div className="att-stat-value">{absent}</div>
                    <div className="att-stat-label">Absent</div>
                  </div>
                </div>
                <span className={"badge " + attBadge.cls}>{attBadge.label}</span>
              </div>

              {/* Section 4: Fee status */}
              <div className="detail-section">
                <div className="detail-section-title">💰 Fee Status</div>
                {fee ? (
                  <div className="detail-grid">
                    <DetailItem label="Month">{feeMonth}</DetailItem>
                    <DetailItem label="Fee Amount">
                      {money(fee.amount)}
                    </DetailItem>
                    <div className="detail-item">
                      <span className="detail-label">Status</span>
                      <span>
                        <span
                          className={
                            "badge " + (feePaid ? "badge-ok" : "badge-warn")
                          }
                        >
                          {feePaid ? "Paid ✅" : "Pending ⏳"}
                        </span>
                      </span>
                    </div>
                    {feePaid && (
                      <>
                        <DetailItem label="Paid On">
                          {formatDate(fee.paidOn)}
                        </DetailItem>
                        <DetailItem label="Payment Method">
                          {fee.paymentMethod || "—"}
                        </DetailItem>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="table-state">
                    No fee record for {feeMonth}
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
