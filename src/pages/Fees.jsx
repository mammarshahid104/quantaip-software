// Fee Management — fee data lives inside each student document
import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase/config";

function studentName(d) {
  return d.fullName || d.name || "Unknown";
}

// Badge class per fee status.
function statusBadge(status) {
  if (status === "paid") return "badge-ok";
  if (status === "overdue") return "badge-danger";
  return "badge-warn"; // pending / anything else
}

const money = (n) => `Rs ${Number(n || 0).toLocaleString()}`;

export default function Fees() {
  const schoolCode = localStorage.getItem("schoolCode") || "your school";

  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState("All Classes");
  const [statusFilter, setStatusFilter] = useState("All");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const snap = await getDocs(
          collection(db, `schools/${schoolCode}/students`)
        );

        if (snap.docs.length > 0) {
          const sample = snap.docs[0].data();
          console.log("Student doc — ALL keys:", Object.keys(sample));
          console.log("Student doc — full data:", sample);
          // Highlight any key that mentions fee/paid/amount/due.
          const feeKeys = Object.keys(sample).filter((k) =>
            /fee|paid|amount|due|payment|balance/i.test(k)
          );
          console.log("Student doc — fee-related keys:", feeKeys);
        }

        // Probe a separate fees collection in case fee data lives there.
        try {
          const feesSnap = await getDocs(
            collection(db, `schools/${schoolCode}/fees`)
          );
          console.log("Separate /fees collection size:", feesSnap.size);
          if (feesSnap.size > 0) {
            console.log("First /fees doc:", feesSnap.docs[0].id, feesSnap.docs[0].data());
          }
        } catch (probeErr) {
          console.log("No accessible /fees collection:", probeErr.code || probeErr);
        }

        const rows = snap.docs.map((doc) => {
          const d = doc.data();
          const feeAmount = Number(d.feeAmount ?? d.fee ?? d.monthlyFee ?? 0);
          const paidAmount = Number(d.paidAmount ?? d.feePaid ?? 0);

          // Prefer an explicit fee status field; otherwise derive one.
          let status = (d.feeStatus || d.paymentStatus || "").toLowerCase();
          if (!status) {
            if (feeAmount > 0 && paidAmount >= feeAmount) status = "paid";
            else if (paidAmount > 0) status = "pending";
            else status = "pending";
          }

          return {
            id: doc.id,
            name: studentName(d),
            cls: d["class"] || "—",
            feeAmount,
            paidAmount,
            status,
          };
        });
        if (!cancelled) setRecords(rows);
      } catch (err) {
        if (cancelled) return;
        console.error("Fees load failed:", err);
        setError(
          err.code === "permission-denied"
            ? "You don't have access to this school's fee data."
            : "Couldn't load fee data. Please try again."
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [schoolCode]);

  // Class dropdown options, derived from data.
  const classes = useMemo(() => {
    const set = new Set(
      records.map((r) => r.cls).filter((c) => c && c !== "—")
    );
    return ["All Classes", ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [records]);

  // Apply search + class + status filters.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return records.filter((r) => {
      const matchesSearch = !q || r.name.toLowerCase().includes(q);
      const matchesClass =
        classFilter === "All Classes" || r.cls === classFilter;
      const matchesStatus =
        statusFilter === "All" || r.status === statusFilter.toLowerCase();
      return matchesSearch && matchesClass && matchesStatus;
    });
  }, [records, search, classFilter, statusFilter]);

  // Summary totals (across all records, not just filtered).
  const totals = useMemo(() => {
    let total = 0;
    let collected = 0;
    for (const r of records) {
      total += r.feeAmount;
      collected += r.paidAmount;
    }
    return { total, collected, pending: Math.max(total - collected, 0) };
  }, [records]);

  const summary = [
    { label: "Total Fee", value: money(totals.total), icon: "💵" },
    { label: "Collected", value: money(totals.collected), icon: "✅" },
    { label: "Pending", value: money(totals.pending), icon: "⏳" },
  ];

  return (
    <div className="page">
      {/* Header */}
      <div className="page-head page-head-row">
        <div>
          <h1 className="page-title">Fee Management</h1>
          <p className="page-subtitle">
            Fees for <strong>{schoolCode}</strong>
          </p>
        </div>
        <button className="btn-primary">+ Record Payment</button>
      </div>

      {error && <div className="login-error">{error}</div>}

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

      {/* Toolbar: search + class + status */}
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
          {["All", "Paid", "Pending", "Overdue"].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {/* Stats row */}
      <div className="stats-row">
        <span>
          Total: <strong>{records.length}</strong>
        </span>
        <span className="stats-sep">·</span>
        <span>
          Showing: <strong>{filtered.length}</strong>
        </span>
      </div>

      {/* Table */}
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
                <th>Student ID</th>
                <th>Student Name</th>
                <th>Class</th>
                <th>Fee Amount</th>
                <th>Paid Amount</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td className="cell-muted">{r.id}</td>
                  <td className="cell-strong">{r.name}</td>
                  <td>{r.cls}</td>
                  <td>{money(r.feeAmount)}</td>
                  <td>{money(r.paidAmount)}</td>
                  <td>
                    <span className={"badge " + statusBadge(r.status)}>
                      {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                    </span>
                  </td>
                  <td>
                    <button className="btn-view">View</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
