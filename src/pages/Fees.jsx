// Fee Management — full system.
// Reads/writes the same Firestore paths the mobile app uses:
//   schools/{schoolCode}/feeStructure/{className}            { monthlyFee }
//   schools/{schoolCode}/fees/{month}/students/{studentId}   payment record
//   schools/{schoolCode}/students/{studentId}                { discountPercent, discountType }
// month format matches the mobile app: "June 2026".
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  collection,
  getDocs,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase/config";
import ConfirmDialog from "../components/ConfirmDialog";

// The 15 classes, in order — source of truth for the fee-structure table.
const CLASSES = [
  "Nursery",
  "Prep",
  "KG",
  ...Array.from({ length: 12 }, (_, i) => `Grade ${i + 1}`),
];

const PAYMENT_METHODS = ["Cash", "Bank Transfer", "Other"];
const DISCOUNT_TYPES = ["Scholarship", "Sibling", "Orphan", "Other"];

const money = (n) => `Rs ${Number(n || 0).toLocaleString()}`;

// Final fee after a percentage discount.
const calcFinal = (amount, discountPercent) =>
  Math.round(Number(amount || 0) * (1 - Number(discountPercent || 0) / 100));

// Month key in the SAME format the mobile app writes with.
const monthKey = (date) =>
  date.toLocaleString("default", { month: "long", year: "numeric" });

// Last 6 months, current first.
function getLast6Months() {
  const list = [];
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    list.push(monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)));
  }
  return list;
}

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

export default function Fees() {
  const schoolCode = localStorage.getItem("schoolCode") || "your school";

  const months = useMemo(() => getLast6Months(), []);
  const [month, setMonth] = useState(months[0]);
  const [tab, setTab] = useState("fees"); // "fees" | "structure"

  const [students, setStudents] = useState([]);
  const [feeStructure, setFeeStructure] = useState({}); // className -> monthlyFee
  const [feeMap, setFeeMap] = useState({}); // studentId -> record

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState("All Classes");
  const [statusFilter, setStatusFilter] = useState("All");

  // Modal / dialog state
  const [paymentModal, setPaymentModal] = useState(null); // {} or { student }
  const [viewRow, setViewRow] = useState(null);
  const [discountStudent, setDiscountStudent] = useState(null);
  const [unpaidTarget, setUnpaidTarget] = useState(null);
  const [markingUnpaid, setMarkingUnpaid] = useState(false);

  // Fee-structure inline editing
  const [editingClass, setEditingClass] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [savingClass, setSavingClass] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [studentsSnap, structSnap, feesSnap] = await Promise.all([
        getDocs(collection(db, `schools/${schoolCode}/students`)),
        getDocs(collection(db, `schools/${schoolCode}/feeStructure`)),
        getDocs(collection(db, `schools/${schoolCode}/fees/${month}/students`)),
      ]);

      const studentRows = studentsSnap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          fullName: data.fullName || data.name || "Unknown",
          cls: data["class"] || "—",
          section: data.section || "—",
          rollNo: data.rollNo || "—",
          status: data.status || "active",
          discountPercent: Number(data.discountPercent || 0),
          discountType: data.discountType || "",
        };
      });

      const struct = {};
      structSnap.docs.forEach((d) => {
        struct[d.id] = Number(d.data().monthlyFee || 0);
      });

      const fees = {};
      feesSnap.docs.forEach((d) => {
        fees[d.id] = d.data();
      });

      setStudents(studentRows);
      setFeeStructure(struct);
      setFeeMap(fees);
    } catch (err) {
      console.error("Fees load failed:", err);
      setError(
        err.code === "permission-denied"
          ? "You don't have access to this school's fee data."
          : "Couldn't load fee data. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }, [schoolCode, month]);

  useEffect(() => {
    load();
  }, [load]);

  const flashSuccess = (message) => {
    setSuccess(message);
    setTimeout(() => setSuccess(""), 4000);
  };

  const refresh = async (message) => {
    await load();
    if (message) flashSuccess(message);
  };

  // Merge roster + structure + fee records into display rows.
  const rows = useMemo(() => {
    return students.map((s) => {
      const classFee = feeStructure[s.cls] || 0;
      const rec = feeMap[s.id];
      if (rec) {
        const original = Number(rec.originalAmount ?? rec.amount ?? classFee);
        const discount = Number(rec.discount ?? 0);
        const finalAmount = Number(rec.amount ?? calcFinal(original, discount));
        return {
          ...s,
          classFee,
          originalAmount: original,
          discount,
          finalAmount,
          status: rec.status || "pending",
          paidOn: rec.paidOn || null,
          paymentMethod: rec.paymentMethod || "—",
          notes: rec.notes || "",
          hasRecord: true,
        };
      }
      // No record this month → expected fee from structure + student discount.
      const discount = s.discountPercent || 0;
      return {
        ...s,
        classFee,
        originalAmount: classFee,
        discount,
        finalAmount: calcFinal(classFee, discount),
        status: "pending",
        paidOn: null,
        paymentMethod: "—",
        notes: "",
        hasRecord: false,
      };
    });
  }, [students, feeStructure, feeMap]);

  const classes = useMemo(() => {
    const set = new Set(rows.map((r) => r.cls).filter((c) => c && c !== "—"));
    return ["All Classes", ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const matchesSearch = !q || r.fullName.toLowerCase().includes(q);
      const matchesClass =
        classFilter === "All Classes" || r.cls === classFilter;
      const matchesStatus =
        statusFilter === "All" || r.status === statusFilter.toLowerCase();
      return matchesSearch && matchesClass && matchesStatus;
    });
  }, [rows, search, classFilter, statusFilter]);

  const totals = useMemo(() => {
    let total = 0;
    let collected = 0;
    let defaulters = 0;
    for (const r of rows) {
      total += r.finalAmount;
      if (r.status === "paid") collected += r.finalAmount;
      else defaulters += 1;
    }
    return {
      total,
      collected,
      pending: Math.max(total - collected, 0),
      defaulters,
    };
  }, [rows]);

  const summary = [
    { label: "Total Fee", value: money(totals.total), icon: "💵" },
    { label: "Collected", value: money(totals.collected), icon: "✅" },
    { label: "Pending", value: money(totals.pending), icon: "⏳" },
    { label: "Defaulters", value: String(totals.defaulters), icon: "⚠️" },
  ];

  // ---- Fee structure editing ----
  const startEdit = (cls) => {
    setEditingClass(cls);
    setEditValue(String(feeStructure[cls] || ""));
  };

  const saveClassFee = async (cls) => {
    setSavingClass(true);
    try {
      const monthlyFee = Number(editValue || 0);
      await setDoc(doc(db, `schools/${schoolCode}/feeStructure/${cls}`), {
        monthlyFee,
      });
      setFeeStructure((prev) => ({ ...prev, [cls]: monthlyFee }));
      setEditingClass(null);
      setEditValue("");
      flashSuccess(`${cls} fee set to ${money(monthlyFee)}/month.`);
    } catch (err) {
      console.error("Save fee structure failed:", err);
      setError(
        err.code === "permission-denied"
          ? "You don't have permission to set fees."
          : "Couldn't save the fee. Please try again."
      );
    } finally {
      setSavingClass(false);
    }
  };

  // ---- Mark unpaid ----
  const handleMarkUnpaid = async () => {
    if (!unpaidTarget) return;
    setMarkingUnpaid(true);
    try {
      await deleteDoc(
        doc(db, `schools/${schoolCode}/fees/${month}/students/${unpaidTarget.id}`)
      );
      setUnpaidTarget(null);
      await refresh(`${unpaidTarget.fullName} marked as unpaid.`);
    } catch (err) {
      console.error("Mark unpaid failed:", err);
      setError(
        err.code === "permission-denied"
          ? "You don't have permission to change payments."
          : "Couldn't update the payment. Please try again."
      );
      setUnpaidTarget(null);
    } finally {
      setMarkingUnpaid(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head page-head-row">
        <div>
          <h1 className="page-title">Fee Management</h1>
          <p className="page-subtitle">
            Fees for <strong>{schoolCode}</strong> · <strong>{month}</strong>
          </p>
        </div>
        <button className="btn-primary" onClick={() => setPaymentModal({})}>
          + Record Payment
        </button>
      </div>

      {success && <div className="success-banner">{success}</div>}
      {error && <div className="login-error">{error}</div>}

      {/* Tabs */}
      <div className="fee-tabs">
        <button
          className={"fee-tab" + (tab === "fees" ? " active" : "")}
          onClick={() => setTab("fees")}
        >
          Student Fees
        </button>
        <button
          className={"fee-tab" + (tab === "structure" ? " active" : "")}
          onClick={() => setTab("structure")}
        >
          Fee Structure
        </button>
      </div>

      {tab === "fees" ? (
        <>
          {/* Summary cards */}
          <div className="stat-grid">
            {summary.map((s) => (
              <div className="stat-card" key={s.label}>
                <div className="stat-icon">{s.icon}</div>
                <div className="stat-meta">
                  <div className="stat-value">{loading ? "…" : s.value}</div>
                  <div className="stat-label">{s.label}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Toolbar */}
          <div className="toolbar">
            <div className="search-box">
              <span className="search-icon">🔍</span>
              <input
                className="search-input"
                type="text"
                placeholder="Search by student name…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select
              className="filter-select"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            >
              {months.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <select
              className="filter-select"
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
            >
              {classes.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              className="filter-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              {["All", "Paid", "Pending"].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div className="stats-row">
            <span>
              Total: <strong>{rows.length}</strong>
            </span>
            <span className="stats-sep">·</span>
            <span>
              Showing: <strong>{filtered.length}</strong>
            </span>
          </div>

          {/* Student fee table */}
          <div className="card">
            {loading ? (
              <div className="table-state">
                <div className="route-loading-spinner" />
                <span>Loading fee data…</span>
              </div>
            ) : filtered.length === 0 ? (
              <div className="table-state">No fee records found</div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Student Name</th>
                    <th>Class</th>
                    <th>Fee Amount</th>
                    <th>Discount</th>
                    <th>Final Amount</th>
                    <th>Status</th>
                    <th>Paid On</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id}>
                      <td className="cell-strong">{r.fullName}</td>
                      <td>
                        {r.cls}
                        {r.section !== "—" ? ` · ${r.section}` : ""}
                      </td>
                      <td>{money(r.originalAmount)}</td>
                      <td>{r.discount ? `${r.discount}%` : "—"}</td>
                      <td className="cell-strong">{money(r.finalAmount)}</td>
                      <td>
                        <span
                          className={
                            "badge " +
                            (r.status === "paid" ? "badge-ok" : "badge-warn")
                          }
                        >
                          {r.status === "paid" ? "Paid" : "Pending"}
                        </span>
                      </td>
                      <td className="cell-muted">{formatDate(r.paidOn)}</td>
                      <td>
                        <div className="action-btns">
                          {r.status === "paid" ? (
                            <button
                              className="btn-delete"
                              onClick={() => setUnpaidTarget(r)}
                            >
                              ✗ Unpaid
                            </button>
                          ) : (
                            <button
                              className="btn-ok"
                              onClick={() => setPaymentModal({ student: r })}
                            >
                              ✓ Mark Paid
                            </button>
                          )}
                          <button
                            className="btn-view"
                            onClick={() => setViewRow(r)}
                          >
                            View
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      ) : (
        /* ---- Fee Structure tab ---- */
        <div className="card">
          {loading ? (
            <div className="table-state">
              <div className="route-loading-spinner" />
              <span>Loading fee structure…</span>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Class</th>
                  <th>Monthly Fee</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {CLASSES.map((cls) => (
                  <tr key={cls}>
                    <td className="cell-strong">{cls}</td>
                    <td>
                      {editingClass === cls ? (
                        <input
                          className="fee-inline"
                          type="number"
                          min="0"
                          autoFocus
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          placeholder="0"
                        />
                      ) : (
                        money(feeStructure[cls] || 0)
                      )}
                    </td>
                    <td>
                      <div className="action-btns">
                        {editingClass === cls ? (
                          <>
                            <button
                              className="btn-ok"
                              disabled={savingClass}
                              onClick={() => saveClassFee(cls)}
                            >
                              {savingClass ? "Saving…" : "Save"}
                            </button>
                            <button
                              className="btn-delete"
                              disabled={savingClass}
                              onClick={() => {
                                setEditingClass(null);
                                setEditValue("");
                              }}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            className="btn-edit"
                            onClick={() => startEdit(cls)}
                          >
                            Edit
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ---- Modals ---- */}
      {paymentModal && (
        <RecordPaymentModal
          schoolCode={schoolCode}
          students={students}
          feeStructure={feeStructure}
          months={months}
          defaultMonth={month}
          preStudent={paymentModal.student}
          onClose={() => setPaymentModal(null)}
          onSuccess={(msg) => {
            setPaymentModal(null);
            refresh(msg);
          }}
        />
      )}

      {viewRow && (
        <ViewPaymentModal
          row={viewRow}
          month={month}
          formatDate={formatDate}
          onClose={() => setViewRow(null)}
          onSetDiscount={() => {
            setDiscountStudent(viewRow);
            setViewRow(null);
          }}
        />
      )}

      {discountStudent && (
        <SetDiscountModal
          schoolCode={schoolCode}
          student={discountStudent}
          onClose={() => setDiscountStudent(null)}
          onSuccess={(msg) => {
            setDiscountStudent(null);
            refresh(msg);
          }}
        />
      )}

      {unpaidTarget && (
        <ConfirmDialog
          title="Mark as Unpaid"
          message={`Remove ${unpaidTarget.fullName}'s payment for ${month}? This clears the recorded payment.`}
          confirmLabel="Mark Unpaid"
          loading={markingUnpaid}
          onCancel={() => setUnpaidTarget(null)}
          onConfirm={handleMarkUnpaid}
        />
      )}
    </div>
  );
}

/* ============================================================
   Record Payment modal
   ============================================================ */
function RecordPaymentModal({
  schoolCode,
  students,
  feeStructure,
  months,
  defaultMonth,
  preStudent,
  onClose,
  onSuccess,
}) {
  const findStudent = (id) => students.find((s) => s.id === id) || null;

  const [selectedId, setSelectedId] = useState(preStudent?.id || "");
  const [comboSearch, setComboSearch] = useState("");
  const [comboOpen, setComboOpen] = useState(false);

  const initFee = preStudent
    ? String(feeStructure[preStudent.cls] || "")
    : "";
  const [month, setMonth] = useState(defaultMonth);
  const [feeAmount, setFeeAmount] = useState(initFee);
  const [discount, setDiscount] = useState(
    preStudent?.discountPercent ? String(preStudent.discountPercent) : "0"
  );
  const [method, setMethod] = useState("Cash");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const selected = findStudent(selectedId);
  const finalAmount = calcFinal(Number(feeAmount), Number(discount));

  const chooseStudent = (s) => {
    setSelectedId(s.id);
    setComboOpen(false);
    setComboSearch("");
    setFeeAmount(String(feeStructure[s.cls] || ""));
    setDiscount(s.discountPercent ? String(s.discountPercent) : "0");
  };

  const comboMatches = useMemo(() => {
    const q = comboSearch.trim().toLowerCase();
    const list = q
      ? students.filter(
          (s) =>
            s.fullName.toLowerCase().includes(q) ||
            String(s.rollNo).toLowerCase().includes(q)
        )
      : students;
    return list.slice(0, 40);
  }, [students, comboSearch]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!selected) {
      setError("Please select a student.");
      return;
    }
    if (!feeAmount || Number(feeAmount) <= 0) {
      setError("Please enter a fee amount.");
      return;
    }
    const d = Number(discount);
    if (d < 0 || d > 100) {
      setError("Discount must be between 0 and 100.");
      return;
    }

    setSaving(true);
    try {
      await setDoc(
        doc(db, `schools/${schoolCode}/fees/${month}/students/${selected.id}`),
        {
          id: selected.id,
          name: selected.fullName,
          class: selected.cls,
          section: selected.section,
          amount: finalAmount,
          originalAmount: Number(feeAmount),
          discount: d,
          status: "paid",
          paymentMethod: method,
          notes: notes.trim(),
          paidOn: serverTimestamp(),
        }
      );
      onSuccess?.(`Payment recorded for ${selected.fullName} (${month}).`);
    } catch (err) {
      console.error("Record payment failed:", err);
      setError(
        err.code === "permission-denied"
          ? "You don't have permission to record payments."
          : "Couldn't record the payment. Please try again."
      );
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Record Payment</span>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="login-error">{error}</div>}

            {/* Student picker */}
            <label className="field">
              <span className="field-label">Student *</span>
              {selected ? (
                <div className="fee-preview" style={{ marginBottom: 0 }}>
                  <div>
                    <div className="fee-preview-label" style={{ color: "var(--navy)" }}>
                      {selected.fullName}
                    </div>
                    <div className="combo-item-sub">
                      {selected.cls} · Roll {selected.rollNo}
                    </div>
                  </div>
                  {!preStudent && (
                    <button
                      type="button"
                      className="btn-edit"
                      onClick={() => {
                        setSelectedId("");
                        setComboOpen(true);
                      }}
                    >
                      Change
                    </button>
                  )}
                </div>
              ) : (
                <div className="combo">
                  <input
                    className="field-input"
                    type="text"
                    placeholder="Search student by name or roll no…"
                    value={comboSearch}
                    onChange={(e) => {
                      setComboSearch(e.target.value);
                      setComboOpen(true);
                    }}
                    onFocus={() => setComboOpen(true)}
                  />
                  {comboOpen && comboMatches.length > 0 && (
                    <div className="combo-list">
                      {comboMatches.map((s) => (
                        <div
                          key={s.id}
                          className="combo-item"
                          onMouseDown={() => chooseStudent(s)}
                        >
                          <div>{s.fullName}</div>
                          <div className="combo-item-sub">
                            {s.cls} · Roll {s.rollNo}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </label>

            <div className="fee-row-grid">
              <label className="field">
                <span className="field-label">Month *</span>
                <select
                  className="field-input"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                >
                  {months.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span className="field-label">Payment Method *</span>
                <select
                  className="field-input"
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="fee-row-grid">
              <label className="field">
                <span className="field-label">Fee Amount *</span>
                <input
                  className="field-input"
                  type="number"
                  min="0"
                  value={feeAmount}
                  onChange={(e) => setFeeAmount(e.target.value)}
                  placeholder="Auto-filled from class"
                />
              </label>

              <label className="field">
                <span className="field-label">Discount %</span>
                <input
                  className="field-input"
                  type="number"
                  min="0"
                  max="100"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  placeholder="0"
                />
              </label>
            </div>

            <label className="field">
              <span className="field-label">Notes</span>
              <input
                className="field-input"
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional"
              />
            </label>

            <div className="fee-preview">
              <span className="fee-preview-label">Final Amount</span>
              <span className="fee-preview-value">{money(finalAmount)}</span>
            </div>
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
              {saving ? "Saving…" : "Record Payment"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ============================================================
   View Payment details modal
   ============================================================ */
function ViewPaymentModal({ row, month, formatDate, onClose, onSetDiscount }) {
  const paid = row.status === "paid";
  const details = [
    ["Student", row.fullName],
    ["Class", `${row.cls}${row.section !== "—" ? ` · ${row.section}` : ""}`],
    ["Roll No", row.rollNo],
    ["Month", month],
    ["Fee Amount", money(row.originalAmount)],
    ["Discount", row.discount ? `${row.discount}%` : "None"],
    ["Final Amount", money(row.finalAmount)],
    ["Status", paid ? "Paid" : "Pending"],
  ];
  if (paid) {
    details.push(["Payment Method", row.paymentMethod || "—"]);
    details.push(["Paid On", formatDate(row.paidOn)]);
    if (row.notes) details.push(["Notes", row.notes]);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Payment Details</span>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal-body">
          {!paid && (
            <div className="login-error" style={{ marginBottom: 16 }}>
              Not paid yet — amount shown is the expected fee for {month}.
            </div>
          )}
          <div className="detail-list">
            {details.map(([label, value]) => (
              <div className="detail-row" key={label}>
                <span className="detail-label">{label}</span>
                <span className="detail-value">{value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn-edit" onClick={onSetDiscount}>
            Set Discount
          </button>
          <button type="button" className="btn-cancel" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Set Discount modal — writes to the student profile doc
   ============================================================ */
function SetDiscountModal({ schoolCode, student, onClose, onSuccess }) {
  const [percent, setPercent] = useState(
    student.discountPercent ? String(student.discountPercent) : "0"
  );
  const [type, setType] = useState(student.discountType || "Scholarship");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    const p = Number(percent);
    if (p < 0 || p > 100) {
      setError("Discount must be between 0 and 100.");
      return;
    }
    setSaving(true);
    try {
      await updateDoc(doc(db, `schools/${schoolCode}/students/${student.id}`), {
        discountPercent: p,
        discountType: type,
      });
      onSuccess?.(`Discount updated for ${student.fullName}.`);
    } catch (err) {
      console.error("Set discount failed:", err);
      setError(
        err.code === "permission-denied"
          ? "You don't have permission to set discounts."
          : "Couldn't save the discount. Please try again."
      );
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Set Discount</span>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="login-error">{error}</div>}
            <p className="page-subtitle" style={{ marginBottom: 16 }}>
              {student.fullName} · {student.cls}
            </p>

            <div className="fee-row-grid">
              <label className="field">
                <span className="field-label">Discount %</span>
                <input
                  className="field-input"
                  type="number"
                  min="0"
                  max="100"
                  autoFocus
                  value={percent}
                  onChange={(e) => setPercent(e.target.value)}
                  placeholder="0"
                />
              </label>

              <label className="field">
                <span className="field-label">Discount Type</span>
                <select
                  className="field-input"
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                >
                  {DISCOUNT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
            </div>
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
              {saving ? "Saving…" : "Save Discount"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
