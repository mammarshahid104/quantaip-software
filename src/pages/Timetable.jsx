// Timetable — view + inline editor (one doc per class)
import { useEffect, useMemo, useRef, useState } from "react";
import { collection, getDocs, doc, setDoc } from "firebase/firestore";
import { db } from "../firebase/config";
import { generateTimetable } from "../services/aiTimetable";
import {
  getAiUsage,
  recordAiGeneration,
  formatCountdown,
  DAILY_LIMIT,
  MONTHLY_LIMIT,
} from "../services/aiUsageLimit";

// Rotating status messages shown while the AI generates.
const AI_MESSAGES = [
  "🤖 AI is solving the timetable puzzle...",
  "Checking teacher availability...",
  "Eliminating clashes...",
  "Optimizing subject distribution...",
];

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
  const isAssembly = p.isAssembly === true || p.type === "assembly";
  const isBreak =
    !isAssembly &&
    (p.isBreak === true ||
      p.break === true ||
      p.type === "break" ||
      String(p.subject || "").toLowerCase() === "break");
  return {
    periodNo: p.period ?? p.periodNo ?? p.no ?? index + 1,
    startTime,
    endTime,
    subject: isBreak ? "Break" : p.subject || (isAssembly ? "Assembly" : ""),
    teacher: isBreak ? "" : p.teacher || p.teacherName || "",
    isBreak,
    isAssembly,
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
  isAssembly: false,
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
  const [teacherDetails, setTeacherDetails] = useState([]); // {name, subject, classesAssigned}
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
    assembly: false,
    assemblyLabel: "Assembly",
    assemblyDuration: 15,
  });

  // Load-template options dialog.
  const [templateOpen, setTemplateOpen] = useState(false);
  const [tpl, setTpl] = useState({
    assembly: false,
    label: "Assembly",
    duration: 15,
    startTime: "07:45",
  });

  // AI generator state.
  const [showAi, setShowAi] = useState(false);
  const [aiForm, setAiForm] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiStatus, setAiStatus] = useState(0);
  const [aiError, setAiError] = useState("");
  const aiTimer = useRef(null);

  // AI usage limits (per school, localStorage-backed). Re-read every second so
  // the cooldown counts down and the daily/monthly counters stay current.
  const [usage, setUsage] = useState(() => getAiUsage(schoolCode));
  useEffect(() => {
    const id = setInterval(() => setUsage(getAiUsage(schoolCode)), 1000);
    return () => clearInterval(id);
  }, [schoolCode]);

  // Label/state for the "AI Generate" button based on current usage.
  const aiButton = useMemo(() => {
    if (usage.dailyReached) {
      return { label: `🔒 AI Generate (${DAILY_LIMIT}/${DAILY_LIMIT} used today)`, disabled: true };
    }
    if (usage.monthlyReached) {
      return { label: `🔒 AI Generate (monthly limit reached)`, disabled: true };
    }
    if (usage.cooldownLeft > 0) {
      return { label: `🕐 Next generation in ${formatCountdown(usage.cooldownLeft)}`, disabled: true };
    }
    return { label: `🤖 AI Generate (${usage.dailyCount}/${DAILY_LIMIT} used today)`, disabled: false };
  }, [usage]);

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

        // Teacher names + full details + subject→teacher map + unique subjects.
        const teacherNames = [];
        const details = [];
        const sMap = {};
        const subjSet = new Set();
        teachersSnap.docs.forEach((d) => {
          const t = d.data();
          const name = t.name || t.fullName || "";
          if (name) teacherNames.push(name);
          const subj = (t.subject || "").trim();
          details.push({
            name,
            subject: subj,
            classesAssigned: Array.isArray(t.classesAssigned)
              ? t.classesAssigned
              : [],
          });
          if (subj) {
            subjSet.add(subj);
            if (!sMap[subj]) sMap[subj] = name; // first teacher wins
          }
        });

        if (!cancelled) {
          setDocs(map);
          setTeachers(teacherNames.sort((a, b) => a.localeCompare(b)));
          setTeacherDetails(details);
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

  // Clash index: teacher busy at day+startTime across OTHER classes' saved timetables.
  const clashIndex = useMemo(() => {
    const map = {};
    for (const [cls, data] of Object.entries(docs)) {
      if (cls === selectedClass) continue;
      for (const day of DAYS) {
        for (const p of getDayPeriods(data, day)) {
          if (p.teacher && p.startTime) {
            map[`${p.teacher.toLowerCase()}||${day.full}||${p.startTime}`] = cls;
          }
        }
      }
    }
    return map;
  }, [docs, selectedClass]);

  const findClash = (teacher, dayFull, startTime) => {
    if (!teacher || !startTime) return null;
    return clashIndex[`${teacher.toLowerCase()}||${dayFull}||${startTime}`] || null;
  };

  // ----- AI generator -----
  const openAiModal = () => {
    const fresh = getAiUsage(schoolCode);
    setUsage(fresh);
    if (!fresh.canGenerate) return; // limit reached / cooling down — button is disabled anyway
    setAiForm({
      subjects: [...subjects],
      periods: 7,
      startTime: "08:00",
      duration: 40,
      breakAfter: 3,
      breakDuration: 30,
      assembly: true,
      assemblyLabel: "Assembly",
      assemblyDuration: 15,
      days: DAYS.map((d) => d.full),
    });
    setAiError("");
    setShowAi(true);
  };

  const toggleAiSubject = (s) =>
    setAiForm((f) => ({
      ...f,
      subjects: f.subjects.includes(s)
        ? f.subjects.filter((x) => x !== s)
        : [...f.subjects, s],
    }));

  const toggleAiDay = (day) =>
    setAiForm((f) => ({
      ...f,
      days: f.days.includes(day)
        ? f.days.filter((x) => x !== day)
        : [...f.days, day],
    }));

  const handleAiGenerate = async () => {
    const current = getAiUsage(schoolCode);
    if (!current.canGenerate) {
      setAiError(
        current.dailyReached
          ? `Daily AI limit reached (${DAILY_LIMIT}/${DAILY_LIMIT}). Try again tomorrow! 🕐`
          : current.monthlyReached
          ? `Monthly AI limit reached (${MONTHLY_LIMIT}/${MONTHLY_LIMIT}).`
          : `Please wait ${formatCountdown(current.cooldownLeft)} before generating again.`
      );
      setUsage(current);
      return;
    }
    if (aiForm.subjects.length === 0) {
      setAiError("Select at least one subject.");
      return;
    }
    if (aiForm.days.length === 0) {
      setAiError("Select at least one day.");
      return;
    }
    setAiError("");
    setAiLoading(true);
    setAiStatus(0);
    aiTimer.current = setInterval(() => {
      setAiStatus((s) => (s + 1) % AI_MESSAGES.length);
    }, 2000);

    try {
      const result = await generateTimetable({
        subjects: aiForm.subjects,
        teachers: teacherDetails,
        periods: Number(aiForm.periods) || 7,
        startTime: aiForm.startTime,
        duration: Number(aiForm.duration) || 40,
        breakAfter: Number(aiForm.breakAfter) || 3,
        breakDuration: Number(aiForm.breakDuration) || 30,
        days: aiForm.days,
        assembly: aiForm.assembly
          ? {
              label: aiForm.assemblyLabel,
              duration: Number(aiForm.assemblyDuration) || 15,
            }
          : null,
        className: selectedClass,
      });

      // Load the AI result into the editor draft (all days).
      const d = {};
      for (const day of DAYS) {
        d[day.full] = toRows(
          Array.isArray(result[day.full]) ? result[day.full] : []
        );
      }
      setDraft(d);
      setEditMode(true);
      setShowAi(false);
      // Count this successful generation toward the daily/monthly limits and
      // start the 10-minute cooldown.
      setUsage(recordAiGeneration(schoolCode));
      showSuccess(
        "✨ AI generated clash-free timetable! Review and save when ready."
      );
    } catch (err) {
      setAiError(err.message || "AI generation failed. Please try again.");
    } finally {
      clearInterval(aiTimer.current);
      setAiLoading(false);
    }
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
        ? {
            ...arr[index],
            isBreak: true,
            isAssembly: false,
            subject: "Break",
            teacher: "",
          }
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

  // Build an assembly row (period 0, before regular periods).
  const assemblyRow = (label, startTime, endTime) => ({
    periodNo: 0,
    startTime,
    endTime,
    subject: label || "Assembly",
    teacher: "",
    isBreak: false,
    isAssembly: true,
  });

  // Automation 1: open the template options dialog.
  const loadTemplate = () => setTemplateOpen(true);

  const applyTemplate = () => {
    const existing = draft?.[fullDay] || [];
    if (
      existing.length > 0 &&
      !window.confirm("This will replace existing periods. Continue?")
    )
      return;

    const base = fullDay === "Friday" ? FRI_TEMPLATE : STD_TEMPLATE;
    let rows = cloneRows(base);
    if (tpl.assembly) {
      const dur = Number(tpl.duration) || 15;
      const start = tpl.startTime || "07:45";
      rows = [assemblyRow(tpl.label, start, addMinutes(start, dur)), ...rows];
    }
    setDraft((prev) => ({ ...prev, [fullDay]: rows }));
    setTemplateOpen(false);
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

    // Optional assembly before regular periods.
    if (gen.assembly) {
      const aDur = Number(gen.assemblyDuration) || 15;
      rows.push(
        assemblyRow(gen.assemblyLabel, addMinutes(cursor, -aDur), cursor)
      );
    }

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
          isAssembly: !!r.isAssembly,
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
              <button
                className="btn-ai"
                onClick={openAiModal}
                disabled={aiButton.disabled}
                title={
                  aiButton.disabled
                    ? "AI generation is currently unavailable"
                    : "Generate a clash-free timetable with AI"
                }
              >
                {aiButton.label}
              </button>
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

            {/* AI usage / cooldown status */}
            <div className="ai-usage-bar">
              {usage.dailyReached ? (
                <span className="ai-usage-locked">
                  🔒 Daily AI limit reached ({DAILY_LIMIT}/{DAILY_LIMIT}). Try
                  again tomorrow! 🕐
                </span>
              ) : usage.monthlyReached ? (
                <span className="ai-usage-locked">
                  🔒 Monthly AI limit reached ({MONTHLY_LIMIT}/{MONTHLY_LIMIT}).
                </span>
              ) : usage.cooldownLeft > 0 ? (
                <span className="ai-usage-cooldown">
                  🕐 Next generation available in{" "}
                  {formatCountdown(usage.cooldownLeft)}
                </span>
              ) : (
                <span className="ai-usage-ok">
                  🤖 {usage.dailyCount}/{DAILY_LIMIT} daily AI generations used
                </span>
              )}
              <span className="ai-usage-monthly">
                {usage.monthlyCount}/{MONTHLY_LIMIT} monthly generations used
              </span>
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
                <label className="gen-field">
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={gen.assembly}
                      onChange={(e) =>
                        setGen((g) => ({ ...g, assembly: e.target.checked }))
                      }
                    />
                    Zero Period / Assembly
                  </span>
                </label>
                {gen.assembly && (
                  <>
                    <label className="gen-field">
                      Assembly label
                      <input
                        className="tt-input"
                        type="text"
                        value={gen.assemblyLabel}
                        onChange={(e) =>
                          setGen((g) => ({
                            ...g,
                            assemblyLabel: e.target.value,
                          }))
                        }
                      />
                    </label>
                    <label className="gen-field">
                      Assembly duration (min)
                      <input
                        className="tt-input"
                        type="number"
                        value={gen.assemblyDuration}
                        onChange={(e) =>
                          setGen((g) => ({
                            ...g,
                            assemblyDuration: e.target.value,
                          }))
                        }
                      />
                    </label>
                  </>
                )}
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
              {viewRows.map((p, i) => {
                if (editMode) {
                  const clash =
                    !p.isBreak && !p.isAssembly
                      ? findClash(p.teacher, fullDay, p.startTime)
                      : null;
                  return (
                  <tr
                    key={i}
                    className={
                      clash
                        ? "row-clash"
                        : p.isBreak
                        ? "row-break"
                        : p.isAssembly
                        ? "row-assembly"
                        : ""
                    }
                  >
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
                      {p.isAssembly ? (
                        <input
                          className="tt-input"
                          type="text"
                          value={p.subject}
                          placeholder="Assembly label"
                          onChange={(e) =>
                            updateRow(i, "subject", e.target.value)
                          }
                        />
                      ) : (
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
                      )}
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
                      {clash && (
                        <span className="clash-warning">
                          ⚠️ {p.teacher} is already teaching {clash} at this time!
                        </span>
                      )}
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
                  );
                }
                return (
                  <tr
                    key={i}
                    className={
                      p.isBreak
                        ? "row-break"
                        : p.isAssembly
                        ? "row-assembly"
                        : ""
                    }
                  >
                    <td className="cell-muted">
                      {p.isBreak ? "—" : p.periodNo}
                    </td>
                    <td>
                      {p.startTime && p.endTime
                        ? `${p.startTime} - ${p.endTime}`
                        : p.startTime || "—"}
                    </td>
                    <td className={p.isBreak || p.isAssembly ? "" : "cell-strong"}>
                      {p.subject || "—"}
                    </td>
                    <td>{p.isBreak ? "—" : p.teacher || "—"}</td>
                  </tr>
                );
              })}
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

      {/* Load Template options dialog */}
      {templateOpen && (
        <div className="modal-overlay" onClick={() => setTemplateOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">
                Load Template — {fullDay}
              </span>
              <button
                className="modal-close"
                onClick={() => setTemplateOpen(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <p className="page-subtitle" style={{ marginBottom: 16 }}>
                {fullDay === "Friday"
                  ? "Loads the short Friday (Jummah) schedule."
                  : "Loads the standard full-day schedule."}
              </p>

              <label className="checkbox-item" style={{ marginBottom: 14 }}>
                <input
                  type="checkbox"
                  checked={tpl.assembly}
                  onChange={(e) =>
                    setTpl((t) => ({ ...t, assembly: e.target.checked }))
                  }
                />
                Add Zero Period / Assembly before regular periods
              </label>

              {tpl.assembly && (
                <>
                  <label className="field">
                    <span className="field-label">Label</span>
                    <input
                      className="field-input"
                      type="text"
                      value={tpl.label}
                      placeholder="e.g. Assembly, Quran Recitation"
                      onChange={(e) =>
                        setTpl((t) => ({ ...t, label: e.target.value }))
                      }
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">Start time</span>
                    <input
                      className="field-input"
                      type="time"
                      value={tpl.startTime}
                      onChange={(e) =>
                        setTpl((t) => ({ ...t, startTime: e.target.value }))
                      }
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">Duration (minutes)</span>
                    <input
                      className="field-input"
                      type="number"
                      value={tpl.duration}
                      onChange={(e) =>
                        setTpl((t) => ({ ...t, duration: e.target.value }))
                      }
                    />
                  </label>
                </>
              )}
            </div>
            <div className="modal-footer">
              <button
                className="btn-cancel"
                onClick={() => setTemplateOpen(false)}
              >
                Cancel
              </button>
              <button className="btn-primary" onClick={applyTemplate}>
                Apply Template
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Timetable Generator modal */}
      {showAi && aiForm && (
        <div
          className="modal-overlay"
          onClick={aiLoading ? undefined : () => setShowAi(false)}
        >
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">🤖 AI Timetable Generator</span>
              {!aiLoading && (
                <button
                  className="modal-close"
                  onClick={() => setShowAi(false)}
                  aria-label="Close"
                >
                  ✕
                </button>
              )}
            </div>

            {aiLoading ? (
              <div className="ai-loading">
                <div className="ai-spinner" />
                <div className="ai-loading-title">{AI_MESSAGES[0]}</div>
                <div className="ai-loading-status">{AI_MESSAGES[aiStatus]}</div>
              </div>
            ) : (
              <>
                <div className="modal-body">
                  {aiError && <div className="login-error">{aiError}</div>}

                  <p className="page-subtitle" style={{ marginBottom: 16 }}>
                    Generating a clash-free timetable for{" "}
                    <strong>{selectedClass}</strong>.
                  </p>

                  {/* Subjects */}
                  <div className="field">
                    <span className="field-label">Subjects needed</span>
                    {subjects.length === 0 ? (
                      <p className="page-subtitle">
                        No subjects found — add teachers with subjects first.
                      </p>
                    ) : (
                      <div className="checkbox-grid">
                        {subjects.map((s) => (
                          <label className="checkbox-item" key={s}>
                            <input
                              type="checkbox"
                              checked={aiForm.subjects.includes(s)}
                              onChange={() => toggleAiSubject(s)}
                            />
                            {s}
                            {subjectMap[s] ? ` (${subjectMap[s]})` : ""}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Config grid */}
                  <div className="gen-toolbar" style={{ marginTop: 4 }}>
                    <label className="gen-field">
                      Periods per day
                      <input
                        className="tt-input"
                        type="number"
                        value={aiForm.periods}
                        onChange={(e) =>
                          setAiForm((f) => ({ ...f, periods: e.target.value }))
                        }
                      />
                    </label>
                    <label className="gen-field">
                      School start time
                      <input
                        className="tt-input"
                        type="time"
                        value={aiForm.startTime}
                        onChange={(e) =>
                          setAiForm((f) => ({ ...f, startTime: e.target.value }))
                        }
                      />
                    </label>
                    <label className="gen-field">
                      Period duration (min)
                      <input
                        className="tt-input"
                        type="number"
                        value={aiForm.duration}
                        onChange={(e) =>
                          setAiForm((f) => ({ ...f, duration: e.target.value }))
                        }
                      />
                    </label>
                    <label className="gen-field">
                      Break after period
                      <input
                        className="tt-input"
                        type="number"
                        value={aiForm.breakAfter}
                        onChange={(e) =>
                          setAiForm((f) => ({
                            ...f,
                            breakAfter: e.target.value,
                          }))
                        }
                      />
                    </label>
                    <label className="gen-field">
                      Break duration (min)
                      <input
                        className="tt-input"
                        type="number"
                        value={aiForm.breakDuration}
                        onChange={(e) =>
                          setAiForm((f) => ({
                            ...f,
                            breakDuration: e.target.value,
                          }))
                        }
                      />
                    </label>
                  </div>

                  {/* Assembly */}
                  <label
                    className="checkbox-item"
                    style={{ marginTop: 14, marginBottom: 8 }}
                  >
                    <input
                      type="checkbox"
                      checked={aiForm.assembly}
                      onChange={(e) =>
                        setAiForm((f) => ({ ...f, assembly: e.target.checked }))
                      }
                    />
                    Include Assembly / Zero Period
                  </label>
                  {aiForm.assembly && (
                    <div className="gen-toolbar">
                      <label className="gen-field">
                        Assembly label
                        <input
                          className="tt-input"
                          type="text"
                          value={aiForm.assemblyLabel}
                          onChange={(e) =>
                            setAiForm((f) => ({
                              ...f,
                              assemblyLabel: e.target.value,
                            }))
                          }
                        />
                      </label>
                      <label className="gen-field">
                        Assembly duration (min)
                        <input
                          className="tt-input"
                          type="number"
                          value={aiForm.assemblyDuration}
                          onChange={(e) =>
                            setAiForm((f) => ({
                              ...f,
                              assemblyDuration: e.target.value,
                            }))
                          }
                        />
                      </label>
                    </div>
                  )}

                  {/* Days */}
                  <div className="field" style={{ marginTop: 14 }}>
                    <span className="field-label">Days</span>
                    <div className="checkbox-grid">
                      {DAYS.map((d) => (
                        <label className="checkbox-item" key={d.full}>
                          <input
                            type="checkbox"
                            checked={aiForm.days.includes(d.full)}
                            onChange={() => toggleAiDay(d.full)}
                          />
                          {d.full}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="modal-footer">
                  <button
                    className="btn-cancel"
                    onClick={() => setShowAi(false)}
                  >
                    Cancel
                  </button>
                  <button className="btn-ai" onClick={handleAiGenerate}>
                    Generate with AI ✨
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
