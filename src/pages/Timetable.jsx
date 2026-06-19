// Timetable — view + inline editor (one doc per class)
import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, doc, setDoc } from "firebase/firestore";
import { db } from "../firebase/config";

const CLASSES = [
  "Nursery",
  "Prep",
  "KG",
  ...Array.from({ length: 12 }, (_, i) => `Grade ${i + 1}`),
];

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

const DAYS = [
  { short: "Mon", full: "Monday" },
  { short: "Tue", full: "Tuesday" },
  { short: "Wed", full: "Wednesday" },
  { short: "Thu", full: "Thursday" },
  { short: "Fri", full: "Friday" },
  { short: "Sat", full: "Saturday" },
];
const fullDayOf = (short) => DAYS.find((d) => d.short === short)?.full;

// Find the period array for a day regardless of how the day key is spelled.
function getDayPeriods(data, day) {
  if (!data || typeof data !== "object") return [];
  const candidates = [
    day.full,
    day.short,
    day.full.toLowerCase(),
    day.short.toLowerCase(),
    day.full.toUpperCase(),
    day.short.toUpperCase(),
  ];
  const search = (obj) => {
    for (const k of candidates) if (Array.isArray(obj[k])) return obj[k];
    return null;
  };
  return search(data) || (data.days && search(data.days)) || [];
}

// Normalise a stored period into the editor's row shape.
function toRow(p, index) {
  if (!p || typeof p !== "object") {
    return {
      periodNo: index + 1,
      startTime: "",
      endTime: "",
      subject: "",
      teacher: "",
      isBreak: false,
    };
  }
  let startTime = p.startTime || "";
  let endTime = p.endTime || "";
  if (!startTime && typeof p.time === "string" && p.time.includes("-")) {
    const [a, b] = p.time.split("-");
    startTime = (a || "").trim();
    endTime = (b || "").trim();
  }
  const isBreak =
    p.isBreak === true ||
    p.break === true ||
    p.type === "break" ||
    String(p.subject || "").toLowerCase() === "break";
  return {
    periodNo: p.period ?? p.periodNo ?? p.no ?? index + 1,
    startTime,
    endTime,
    subject: isBreak ? "Break" : p.subject || "",
    teacher: isBreak ? "" : p.teacher || p.teacherName || "",
    isBreak,
  };
}

function toRows(arr) {
  return (arr || []).map(toRow);
}

const emptyRow = (n) => ({
  periodNo: n,
  startTime: "",
  endTime: "",
  subject: "",
  teacher: "",
  isBreak: false,
});

// Add minutes to a "HH:MM" string, returning "HH:MM" (24h).
function addMinutes(time, mins) {
  const [h, m] = String(time).split(":").map((n) => parseInt(n, 10) || 0);
  const total = h * 60 + m + mins;
  const nh = Math.floor(total / 60) % 24;
  const nm = total % 60;
  return `${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}`;
}

// Standard full-day template (Mon–Thu, Sat).
const STD_TEMPLATE = [
  { periodNo: 1, startTime: "08:00", endTime: "08:40", subject: "", teacher: "", isBreak: false },
  { periodNo: 2, startTime: "08:40", endTime: "09:20", subject: "", teacher: "", isBreak: false },
  { periodNo: 3, startTime: "09:20", endTime: "10:00", subject: "", teacher: "", isBreak: false },
  { periodNo: 0, startTime: "10:00", endTime: "10:30", subject: "Break", teacher: "", isBreak: true },
  { periodNo: 4, startTime: "10:30", endTime: "11:10", subject: "", teacher: "", isBreak: false },
  { periodNo: 5, startTime: "11:10", endTime: "11:50", subject: "", teacher: "", isBreak: false },
  { periodNo: 6, startTime: "11:50", endTime: "12:30", subject: "", teacher: "", isBreak: false },
  { periodNo: 7, startTime: "12:30", endTime: "13:10", subject: "", teacher: "", isBreak: false },
];

// Shorter Friday (Jummah) template.
const FRI_TEMPLATE = [
  { periodNo: 1, startTime: "08:00", endTime: "08:40", subject: "", teacher: "", isBreak: false },
  { periodNo: 2, startTime: "08:40", endTime: "09:20", subject: "", teacher: "", isBreak: false },
  { periodNo: 3, startTime: "09:20", endTime: "10:00", subject: "", teacher: "", isBreak: false },
  { periodNo: 0, startTime: "10:00", endTime: "10:20", subject: "Break", teacher: "", isBreak: true },
  { periodNo: 4, startTime: "10:20", endTime: "11:00", subject: "", teacher: "", isBreak: false },
];

const cloneRows = (rows) => rows.map((r) => ({ ...r }));

export default function Timetable() {
  const schoolCode = localStorage.getItem("schoolCode") || "your school";

  const [docs, setDocs] = useState({}); // className -> data
  const [teachers, setTeachers] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [subjectMap, setSubjectMap] = useState({}); // subject -> teacher name
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [selectedClass, setSelectedClass] = useState("");
  const [selectedDay, setSelectedDay] = useState("Mon");

  // Edit mode state.
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState(null); // { Monday: [rows], ... }
  const [saving, setSaving] = useState(false);
  const [showGenerator, setShowGenerator] = useState(false);
  const [gen, setGen] = useState({
    startTime: "08:00",
    duration: 40,
    breakAfter: 3,
    breakDuration: 30,
    periods: 7,
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const base = `schools/${schoolCode}`;
        const [ttSnap, teachersSnap] = await Promise.all([
          getDocs(collection(db, `${base}/timetable`)),
          getDocs(collection(db, `${base}/teachers`)),
        ]);

        const map = {};
        ttSnap.docs.forEach((d) => {
          map[d.id] = d.data();
        });

        // Teacher names + subject→teacher map + unique subjects.
        const teacherNames = [];
        const sMap = {};
        const subjSet = new Set();
        teachersSnap.docs.forEach((d) => {
          const t = d.data();
          const name = t.name || t.fullName || "";
          if (name) teacherNames.push(name);
          const subj = (t.subject || "").trim();
          if (subj) {
            subjSet.add(subj);
            if (!sMap[subj]) sMap[subj] = name; // first teacher wins
          }
        });

        if (!cancelled) {
          setDocs(map);
          setTeachers(teacherNames.sort((a, b) => a.localeCompare(b)));
          setSubjects(Array.from(subjSet).sort((a, b) => a.localeCompare(b)));
          setSubjectMap(sMap);
        }
      } catch (err) {
        if (cancelled) return;
        console.error("Timetable load failed:", err);
        setError(
          err.code === "permission-denied"
            ? "You don't have access to this school's timetable."
            : "Couldn't load timetable. Please try again."
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

  // Class chips: standard classes plus any existing timetable docs.
  const classes = useMemo(() => {
    const set = new Set([...CLASSES, ...Object.keys(docs)]);
    return Array.from(set).sort(classSort);
  }, [docs]);

  useEffect(() => {
    if (!selectedClass && classes.length > 0) setSelectedClass(classes[0]);
  }, [classes, selectedClass]);

  const fullDay = fullDayOf(selectedDay);

  // Rows currently shown: from draft in edit mode, else from stored doc.
  const viewRows = useMemo(() => {
    if (editMode) return draft?.[fullDay] || [];
    const day = DAYS.find((d) => d.short === selectedDay);
    return toRows(getDayPeriods(docs[selectedClass], day));
  }, [editMode, draft, fullDay, docs, selectedClass, selectedDay]);

  const showSuccess = (msg) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(""), 4000);
  };

  // ----- Edit mode actions -----
  const enterEdit = () => {
    const data = docs[selectedClass] || {};
    const d = {};
    for (const day of DAYS) d[day.full] = toRows(getDayPeriods(data, day));
    setDraft(d);
    setEditMode(true);
  };

  const cancelEdit = () => {
    setEditMode(false);
    setDraft(null);
  };

  const updateRow = (index, key, value) => {
    setDraft((prev) => {
      const copy = { ...prev };
      const arr = [...copy[fullDay]];
      arr[index] = { ...arr[index], [key]: value };
      copy[fullDay] = arr;
      return copy;
    });
  };

  const toggleBreak = (index, checked) => {
    setDraft((prev) => {
      const copy = { ...prev };
      const arr = [...copy[fullDay]];
      arr[index] = checked
        ? { ...arr[index], isBreak: true, subject: "Break", teacher: "" }
        : { ...arr[index], isBreak: false, subject: "" };
      copy[fullDay] = arr;
      return copy;
    });
  };

  const addPeriod = () => {
    setDraft((prev) => {
      const copy = { ...prev };
      const arr = copy[fullDay] || [];
      copy[fullDay] = [...arr, emptyRow(arr.length + 1)];
      return copy;
    });
  };

  const deletePeriod = (index) => {
    setDraft((prev) => {
      const copy = { ...prev };
      copy[fullDay] = copy[fullDay].filter((_, i) => i !== index);
      return copy;
    });
  };

  const copyMondayToAll = () => {
    setDraft((prev) => {
      const mon = prev["Monday"] || [];
      const copy = { ...prev };
      for (const day of DAYS) {
        if (day.full === "Monday") continue;
        copy[day.full] = mon.map((r) => ({ ...r }));
      }
      return copy;
    });
  };

  // Subject dropdown change → auto-fill teacher (still editable).
  const handleSubjectChange = (index, value) => {
    setDraft((prev) => {
      const copy = { ...prev };
      const arr = [...copy[fullDay]];
      const teacher = subjectMap[value];
      arr[index] = {
        ...arr[index],
        subject: value,
        ...(teacher ? { teacher } : {}),
      };
      copy[fullDay] = arr;
      return copy;
    });
  };

  // Automation 1: load the standard / Friday template for the current day.
  const loadTemplate = () => {
    const existing = draft?.[fullDay] || [];
    if (
      existing.length > 0 &&
      !window.confirm("This will replace existing periods. Continue?")
    )
      return;
    const template = fullDay === "Friday" ? FRI_TEMPLATE : STD_TEMPLATE;
    setDraft((prev) => ({ ...prev, [fullDay]: cloneRows(template) }));
  };

  // Automation 2: generate periods from start time / duration / break config.
  const generatePeriods = () => {
    const existing = draft?.[fullDay] || [];
    if (
      existing.length > 0 &&
      !window.confirm("This will replace existing periods. Continue?")
    )
      return;

    const duration = Number(gen.duration) || 40;
    const breakAfter = Number(gen.breakAfter) || 0;
    const breakDuration = Number(gen.breakDuration) || 0;
    const periods = Number(gen.periods) || 0;
    let cursor = gen.startTime || "08:00";
    const rows = [];

    for (let i = 1; i <= periods; i++) {
      const end = addMinutes(cursor, duration);
      rows.push({
        periodNo: i,
        startTime: cursor,
        endTime: end,
        subject: "",
        teacher: "",
        isBreak: false,
      });
      cursor = end;
      if (i === breakAfter && breakDuration > 0) {
        const bEnd = addMinutes(cursor, breakDuration);
        rows.push({
          periodNo: 0,
          startTime: cursor,
          endTime: bEnd,
          subject: "Break",
          teacher: "",
          isBreak: true,
        });
        cursor = bEnd;
      }
    }

    setDraft((prev) => ({ ...prev, [fullDay]: rows }));
    setShowGenerator(false);
  };

  const saveTimetable = async () => {
    setSaving(true);
    setError("");
    try {
      const payload = {};
      for (const day of DAYS) {
        payload[day.full] = (draft[day.full] || []).map((r) => ({
          period: Number(r.periodNo) || 0,
          startTime: r.startTime || "",
          endTime: r.endTime || "",
          subject: r.isBreak ? "Break" : r.subject || "",
          teacher: r.isBreak ? "" : r.teacher || "",
          isBreak: !!r.isBreak,
        }));
      }
      await setDoc(
        doc(db, `schools/${schoolCode}/timetable/${selectedClass}`),
        payload
      );
      setDocs((prev) => ({ ...prev, [selectedClass]: payload }));
      setEditMode(false);
      setDraft(null);
      showSuccess("Timetable saved successfully!");
    } catch (err) {
      console.error("Save timetable failed:", err);
      setError(
        err.code === "permission-denied"
          ? "You don't have permission to edit the timetable."
          : "Couldn't save timetable. Please try again."
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head page-head-row">
        <div>
          <h1 className="page-title">Timetable</h1>
          <p className="page-subtitle">
            Schedule for <strong>{schoolCode}</strong>
          </p>
        </div>
        <div className="header-actions">
          {!editMode ? (
            <button
              className="btn-edit"
              onClick={enterEdit}
              disabled={loading || !selectedClass}
            >
              Edit Timetable
            </button>
          ) : (
            <>
              <button
                className="btn-cancel"
                onClick={cancelEdit}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={saveTimetable}
                disabled={saving}
              >
                {saving ? "Saving…" : "Save Timetable"}
              </button>
            </>
          )}
        </div>
      </div>

      {success && <div className="success-banner">{success}</div>}
      {error && <div className="login-error">{error}</div>}

      {/* Class chips (locked while editing) */}
      {!loading && classes.length > 0 && (
        <div className="chip-row">
          {classes.map((c) => (
            <button
              key={c}
              className={"chip" + (c === selectedClass ? " chip-active" : "")}
              onClick={() => setSelectedClass(c)}
              disabled={editMode}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {/* Day chips */}
      <div className="chip-row">
        {DAYS.map((d) => (
          <button
            key={d.short}
            className={"chip" + (d.short === selectedDay ? " chip-active" : "")}
            onClick={() => setSelectedDay(d.short)}
          >
            {d.short}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="card">
        {/* Automation toolbar */}
        {editMode && !loading && (
          <>
            <div className="editor-toolbar">
              <button className="btn-edit" onClick={loadTemplate}>
                📋 Load Template
              </button>
              <button
                className="btn-edit"
                onClick={() => setShowGenerator((v) => !v)}
              >
                ⚙️ Generate Periods
              </button>
            </div>

            {showGenerator && (
              <div className="gen-toolbar">
                <label className="gen-field">
                  School starts at
                  <input
                    className="tt-input"
                    type="time"
                    value={gen.startTime}
                    onChange={(e) =>
                      setGen((g) => ({ ...g, startTime: e.target.value }))
                    }
                  />
                </label>
                <label className="gen-field">
                  Period duration (min)
                  <input
                    className="tt-input"
                    type="number"
                    value={gen.duration}
                    onChange={(e) =>
                      setGen((g) => ({ ...g, duration: e.target.value }))
                    }
                  />
                </label>
                <label className="gen-field">
                  Break after period
                  <input
                    className="tt-input"
                    type="number"
                    value={gen.breakAfter}
                    onChange={(e) =>
                      setGen((g) => ({ ...g, breakAfter: e.target.value }))
                    }
                  />
                </label>
                <label className="gen-field">
                  Break duration (min)
                  <input
                    className="tt-input"
                    type="number"
                    value={gen.breakDuration}
                    onChange={(e) =>
                      setGen((g) => ({ ...g, breakDuration: e.target.value }))
                    }
                  />
                </label>
                <label className="gen-field">
                  Number of periods
                  <input
                    className="tt-input"
                    type="number"
                    value={gen.periods}
                    onChange={(e) =>
                      setGen((g) => ({ ...g, periods: e.target.value }))
                    }
                  />
                </label>
                <button className="btn-primary" onClick={generatePeriods}>
                  Generate ✓
                </button>
              </div>
            )}
          </>
        )}

        {loading ? (
          <div className="table-state">
            <div className="route-loading-spinner" />
            <span>Loading timetable…</span>
          </div>
        ) : !editMode && viewRows.length === 0 ? (
          <div className="table-state">No timetable set for this class yet</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Period No</th>
                <th>{editMode ? "Start" : "Time"}</th>
                {editMode && <th>End</th>}
                <th>Subject</th>
                <th>Teacher</th>
                {editMode && <th>Break?</th>}
                {editMode && <th></th>}
              </tr>
            </thead>
            <tbody>
              {viewRows.map((p, i) =>
                editMode ? (
                  <tr key={i} className={p.isBreak ? "row-break" : ""}>
                    <td>
                      <input
                        className="tt-input tt-num"
                        type="number"
                        value={p.periodNo}
                        onChange={(e) =>
                          updateRow(i, "periodNo", e.target.value)
                        }
                      />
                    </td>
                    <td>
                      <input
                        className="tt-input tt-time"
                        type="time"
                        value={p.startTime}
                        onChange={(e) =>
                          updateRow(i, "startTime", e.target.value)
                        }
                      />
                    </td>
                    <td>
                      <input
                        className="tt-input tt-time"
                        type="time"
                        value={p.endTime}
                        onChange={(e) =>
                          updateRow(i, "endTime", e.target.value)
                        }
                      />
                    </td>
                    <td>
                      <select
                        className="tt-input"
                        value={p.subject}
                        disabled={p.isBreak}
                        onChange={(e) =>
                          handleSubjectChange(i, e.target.value)
                        }
                      >
                        <option value="">— Subject —</option>
                        {subjects.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                        {/* Preserve a subject not in the current list */}
                        {p.subject &&
                          p.subject !== "Break" &&
                          !subjects.includes(p.subject) && (
                            <option value={p.subject}>{p.subject}</option>
                          )}
                      </select>
                    </td>
                    <td>
                      <select
                        className="tt-input"
                        value={p.teacher}
                        disabled={p.isBreak}
                        onChange={(e) =>
                          updateRow(i, "teacher", e.target.value)
                        }
                      >
                        <option value="">— Select —</option>
                        {teachers.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                        {/* Preserve a teacher value not in the current list */}
                        {p.teacher && !teachers.includes(p.teacher) && (
                          <option value={p.teacher}>{p.teacher}</option>
                        )}
                      </select>
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={p.isBreak}
                        onChange={(e) => toggleBreak(i, e.target.checked)}
                      />
                    </td>
                    <td>
                      <button
                        className="btn-icon-del"
                        onClick={() => deletePeriod(i)}
                        title="Delete period"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ) : (
                  <tr key={i} className={p.isBreak ? "row-break" : ""}>
                    <td className="cell-muted">
                      {p.isBreak ? "—" : p.periodNo}
                    </td>
                    <td>
                      {p.startTime && p.endTime
                        ? `${p.startTime} - ${p.endTime}`
                        : p.startTime || "—"}
                    </td>
                    <td className={p.isBreak ? "" : "cell-strong"}>
                      {p.subject || "—"}
                    </td>
                    <td>{p.isBreak ? "—" : p.teacher || "—"}</td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        )}

        {/* Editor controls below the table */}
        {editMode && (
          <div className="editor-actions">
            <button className="btn-edit" onClick={addPeriod}>
              + Add Period
            </button>
            <button className="btn-edit" onClick={copyMondayToAll}>
              Copy Monday to All Days
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
