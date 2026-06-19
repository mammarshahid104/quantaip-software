// Homework — per-class assignment cards (one doc per class, with an items array)
import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase/config";

// Class ordering: Nursery → Prep → KG → Grade 1..12, unknowns last.
const NAMED_RANK = {
  "pre-nursery": -4,
  prenursery: -4,
  nursery: -3,
  prep: -2,
  kg: -1,
  kindergarten: -1,
};
function classRank(name) {
  const key = String(name).toLowerCase().trim();
  if (key in NAMED_RANK) return NAMED_RANK[key];
  const m = key.match(/(\d+)/);
  if (m) return parseInt(m[1], 10);
  return 999;
}
function classSort(a, b) {
  const ra = classRank(a);
  const rb = classRank(b);
  if (ra !== rb) return ra - rb;
  return String(a).localeCompare(String(b));
}

// Parse a due date that might be a Firestore Timestamp, millis, or string.
function parseDate(v) {
  if (!v) return null;
  if (typeof v === "object" && typeof v.toDate === "function") return v.toDate();
  if (typeof v === "number") return new Date(v);
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function formatDate(date) {
  if (!date) return "No due date";
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

// Midnight-aligned comparison of a due date vs today.
function dueStatus(date) {
  if (!date) return { label: "No date", cls: "badge-warn", bucket: "none" };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  if (d.getTime() === today.getTime())
    return { label: "Due Today", cls: "badge-warn", bucket: "upcoming" };
  if (d.getTime() > today.getTime())
    return { label: "Upcoming", cls: "badge-ok", bucket: "upcoming" };
  return { label: "Overdue", cls: "badge-red", bucket: "overdue" };
}

export default function Homework() {
  const schoolCode = localStorage.getItem("schoolCode") || "your school";

  const [docs, setDocs] = useState({}); // className -> items array
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedClass, setSelectedClass] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const snap = await getDocs(
          collection(db, `schools/${schoolCode}/homework`)
        );

        if (snap.docs.length > 0) {
          console.log("Homework doc:", snap.docs[0].id, snap.docs[0].data());
        }

        const map = {};
        snap.docs.forEach((doc) => {
          const d = doc.data();
          map[doc.id] = Array.isArray(d.items) ? d.items : [];
        });
        if (!cancelled) setDocs(map);
      } catch (err) {
        if (cancelled) return;
        console.error("Homework load failed:", err);
        setError(
          err.code === "permission-denied"
            ? "You don't have access to this school's homework."
            : "Couldn't load homework. Please try again."
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

  const classes = useMemo(() => Object.keys(docs).sort(classSort), [docs]);

  useEffect(() => {
    if (!selectedClass && classes.length > 0) setSelectedClass(classes[0]);
  }, [classes, selectedClass]);

  // Normalised homework items for the selected class.
  const items = useMemo(() => {
    const raw = docs[selectedClass] || [];
    return raw
      .map((it) => {
        const date = parseDate(it.dueDate ?? it.due ?? it.deadline);
        return {
          subject: it.subject || "—",
          title: it.title || it.name || "Untitled",
          description: it.description || it.desc || it.details || "",
          date,
          assignedBy:
            it.assignedBy || it.teacher || it.teacherName || "—",
          status: dueStatus(date),
        };
      })
      .sort((a, b) => {
        const at = a.date ? a.date.getTime() : Infinity;
        const bt = b.date ? b.date.getTime() : Infinity;
        return at - bt;
      });
  }, [docs, selectedClass]);

  const summary = useMemo(() => {
    let upcoming = 0;
    let overdue = 0;
    for (const it of items) {
      if (it.status.bucket === "upcoming") upcoming += 1;
      else if (it.status.bucket === "overdue") overdue += 1;
    }
    return { total: items.length, upcoming, overdue };
  }, [items]);

  const cards = [
    { label: "Total Assignments", value: summary.total, icon: "📚" },
    { label: "Upcoming", value: summary.upcoming, icon: "🟢" },
    { label: "Overdue", value: summary.overdue, icon: "🔴" },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">Homework</h1>
        <p className="page-subtitle">
          Assignments for <strong>{schoolCode}</strong>
        </p>
      </div>

      {error && <div className="login-error">{error}</div>}

      {/* Class chips */}
      {!loading && classes.length > 0 && (
        <div className="chip-row">
          {classes.map((c) => (
            <button
              key={c}
              className={"chip" + (c === selectedClass ? " chip-active" : "")}
              onClick={() => setSelectedClass(c)}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {/* Summary cards */}
      <div className="stat-grid">
        {cards.map((c) => (
          <div className="stat-card" key={c.label}>
            <div className="stat-icon">{c.icon}</div>
            <div className="stat-meta">
              <div className="stat-value">
                {loading ? "…" : c.value.toLocaleString()}
              </div>
              <div className="stat-label">{c.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Homework cards */}
      {loading ? (
        <div className="card">
          <div className="table-state">
            <div className="route-loading-spinner" />
            <span>Loading homework…</span>
          </div>
        </div>
      ) : items.length === 0 ? (
        <div className="card">
          <div className="table-state">No homework assigned yet</div>
        </div>
      ) : (
        <div className="hw-list">
          {items.map((it, i) => (
            <div className="hw-card" key={i}>
              <div className="hw-card-head">
                <div>
                  <div className="hw-subject">{it.subject}</div>
                  <div className="hw-title">{it.title}</div>
                </div>
                <span className={"badge " + it.status.cls}>
                  {it.status.label}
                </span>
              </div>
              {it.description && <div className="hw-desc">{it.description}</div>}
              <div className="hw-meta">
                <span>
                  Due: <strong>{formatDate(it.date)}</strong>
                </span>
                <span>
                  Assigned by: <strong>{it.assignedBy}</strong>
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
