// AI-powered timetable generation via the OpenAI API (browser-direct).
//
// SECURITY NOTE: This calls the OpenAI API directly from the browser using
// VITE_OPENAI_API_KEY, which is inlined into the client bundle at build time.
// That key is therefore extractable by anyone who uses the deployed app. This is
// acceptable only for a trusted/internal admin audience. For a public or
// multi-tenant deployment, move this call behind a backend (e.g. a Firebase
// Cloud Function) so the key never reaches the browser.
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "../firebase/config";

const API_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o-mini";

// Read the class's own subject list (subject + weekly frequency + teacher).
// Returns [] when the class has none defined, so the caller can fall back.
async function fetchClassSubjects(schoolCode, className) {
  if (!schoolCode || !className) return [];
  try {
    const snap = await getDoc(
      doc(db, `schools/${schoolCode}/classes`, className)
    );
    const arr = snap.exists() ? snap.data().subjects : null;
    return Array.isArray(arr) ? arr : [];
  } catch (err) {
    console.error("Couldn't load class subjects:", err);
    return [];
  }
}

// Fetch every other class's saved timetable and collapse it into a map of
// teachers who are already occupied per day + time slot:
//   { "Monday": { "08:00-08:40": ["Ms. Ayesha (Grade 9)", ...] } }
// The selected class is skipped so we don't clash a teacher with themselves.
async function buildTeacherBusyMap(schoolCode, selectedClass) {
  const busyMap = {};
  if (!schoolCode) return busyMap;

  const snap = await getDocs(
    collection(db, `schools/${schoolCode}/timetable`)
  );
  snap.docs.forEach((docSnap) => {
    const className = docSnap.id;
    if (className === selectedClass) return;
    const data = docSnap.data() || {};
    Object.entries(data).forEach(([day, periods]) => {
      if (!Array.isArray(periods)) return;
      periods.forEach((period) => {
        if (!period || period.isBreak || period.isAssembly || !period.teacher) {
          return;
        }
        const timeKey = `${period.startTime}-${period.endTime}`;
        if (!busyMap[day]) busyMap[day] = {};
        if (!busyMap[day][timeKey]) busyMap[day][timeKey] = [];
        busyMap[day][timeKey].push(`${period.teacher} (${className})`);
      });
    });
  });
  return busyMap;
}

// Flatten the busy map into human-readable lines for the prompt.
function formatBusyMap(busyMap) {
  return Object.entries(busyMap)
    .map(([day, slots]) =>
      Object.entries(slots)
        .map(([time, teachers]) => `${day} ${time}: ${teachers.join(", ")}`)
        .join("\n")
    )
    .filter((block) => block.length > 0)
    .join("\n");
}

// Safety net: the model occasionally ignores the busy constraint, so after
// parsing we walk every assigned period and clear any teacher who is already
// busy in another class at that day + time. Mutates the timetable in place.
function removeClashes(timetable, busyMap) {
  let clashesFixed = 0;

  Object.entries(timetable).forEach(([day, periods]) => {
    if (!Array.isArray(periods)) return;

    periods.forEach((period) => {
      if (!period || !period.teacher || period.isBreak || period.isAssembly) {
        return;
      }

      const timeKey = `${period.startTime}-${period.endTime}`;
      const busyTeachers = busyMap[day]?.[timeKey] || [];

      // busyTeachers entries look like "Ms. Ayesha (Grade 9)" — match on name.
      const isBusy = busyTeachers.some((entry) =>
        entry.toLowerCase().includes(period.teacher.toLowerCase())
      );

      if (isBusy) {
        console.warn(`Clash fixed: ${period.teacher} on ${day} ${timeKey}`);
        period.teacher = ""; // clear the busy teacher; admin reassigns manually
        period.clashWarning = true;
        clashesFixed += 1;
      }
    });
  });

  console.log(`Auto-fixed ${clashesFixed} clashes`);
  return { timetable, clashesFixed };
}

function buildPrompt(params, busyText) {
  const {
    subjects,
    teachers,
    periods,
    startTime,
    duration,
    breakAfter,
    breakDuration,
    days,
    assembly,
    className,
    classSubjects,
  } = params;

  const hasClassSubjects =
    Array.isArray(classSubjects) && classSubjects.length > 0;

  // Subject + teacher section. When the class defines its own subjects we use
  // them (with exact weekly frequencies); otherwise we fall back to every
  // teacher's subject.
  let subjectsSection;
  let subjectRules;
  if (hasClassSubjects) {
    const freqLines = classSubjects
      .map(
        (s) =>
          `- ${s.subject} (${s.periodsPerWeek || 1}x/week) → ${
            s.teacherName || "(unassigned)"
          }`
      )
      .join("\n");
    subjectsSection = `SUBJECTS AND WEEKLY FREQUENCY (use ONLY these subjects and teachers):
Each subject must appear EXACTLY the specified number of times per week.
${freqLines}`;
    subjectRules = classSubjects
      .map(
        (s) =>
          `   - ${s.subject} MUST appear exactly ${
            s.periodsPerWeek || 1
          } time(s) across the week, taught by ${s.teacherName || "its teacher"}`
      )
      .join("\n");
  } else {
    const teacherLines = teachers
      .map(
        (t) =>
          `- ${t.name}: ${t.subject || "—"} (assigned to: ${
            Array.isArray(t.classesAssigned)
              ? t.classesAssigned.join(", ")
              : t.classesAssigned || "—"
          })`
      )
      .join("\n");
    subjectsSection = `TEACHERS AND SUBJECTS:
${teacherLines}

Subjects needed: ${subjects.join(", ")}`;
    subjectRules = `   - Each subject should appear roughly equally across the week
   - Distribute subjects evenly — avoid the same subject twice in one day`;
  }

  const busySection = busyText
    ? `
⚠️ CRITICAL HARD CONSTRAINT ⚠️
The following teachers are ALREADY TEACHING other classes at these times.
You MUST NOT assign them at these times. This is NON-NEGOTIABLE:

${busyText}

Any timetable that violates the above will be REJECTED and regenerated.
`
    : "";

  return `You are a school timetable expert. Generate a clash-free weekly timetable for ${className}.
${busySection}
${subjectsSection}

REQUIREMENTS:
- Class: ${className}
- Periods per day: ${periods}
- School starts: ${startTime}
- Period duration: ${duration} minutes
- Break after: ${breakAfter}th period (${breakDuration} min)
${
  assembly
    ? `- Assembly/Zero period: ${assembly.duration} min before school (label: ${assembly.label})`
    : ""
}
- Days: ${days.join(", ")}

STRICT RULES:
1. No teacher can teach two classes at the same time
2. Each subject's weekly frequency must be respected — no subject may exceed its weekly limit
${subjectRules}
3. Place core/science subjects in earlier periods (better focus)
4. Break must be included on all days
5. Friday should have fewer periods (Jummah prayer)
6. Avoid scheduling the same subject twice in one day unless its weekly frequency requires it

RESPOND WITH VALID JSON ONLY. No explanation. Format:
{
  "Monday": [
    { "period": 0, "startTime": "07:45", "endTime": "08:00", "subject": "Assembly", "teacher": "", "isBreak": false, "isAssembly": true },
    { "period": 1, "startTime": "08:00", "endTime": "08:40", "subject": "Physics", "teacher": "Ammar Shahid", "isBreak": false, "isAssembly": false },
    { "period": 0, "startTime": "10:00", "endTime": "10:30", "subject": "Break", "teacher": "", "isBreak": true, "isAssembly": false }
  ],
  "Tuesday": [],
  "Wednesday": [],
  "Thursday": [],
  "Friday": [],
  "Saturday": []
}`;
}

// Extract the first balanced JSON object from a string.
function extractJson(text) {
  const clean = text.replace(/```json|```/g, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start === -1 || end === -1) return clean;
  return clean.slice(start, end + 1);
}

export async function generateTimetable(params) {
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing OpenAI API key. Add VITE_OPENAI_API_KEY to your .env.local file and restart the dev server."
    );
  }

  // Prefer the class's own subjects (with weekly frequencies). When none are
  // defined we fall back to teacher subjects and warn the caller.
  const classSubjects = await fetchClassSubjects(
    params.schoolCode,
    params.className
  );

  // Gather teachers already occupied in other classes so the AI can avoid
  // cross-class clashes. A read failure here shouldn't block generation.
  let busyMap = {};
  let busyText = "";
  try {
    busyMap = await buildTeacherBusyMap(params.schoolCode, params.className);
    busyText = formatBusyMap(busyMap);
  } catch (err) {
    console.error("Couldn't load existing timetables for clash check:", err);
  }

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: "user",
          content: buildPrompt({ ...params, classSubjects }, busyText),
        },
      ],
      max_tokens: 4000,
    }),
  });

  if (!response.ok) {
    let detail = "";
    try {
      const err = await response.json();
      detail = err?.error?.message || "";
    } catch {
      // ignore parse failure
    }
    throw new Error(
      `AI request failed (${response.status}). ${detail}`.trim()
    );
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content || "";
  if (!text) throw new Error("AI returned an empty response.");

  let timetable;
  try {
    timetable = JSON.parse(extractJson(text));
  } catch {
    throw new Error("Couldn't parse the AI's timetable. Please try again.");
  }

  // Safety net: clear any teacher the model assigned despite being busy
  // elsewhere. Highlighted slots (clashWarning) are for the admin to reassign.
  const { timetable: fixedTimetable, clashesFixed } = removeClashes(
    timetable,
    busyMap
  );

  const warning =
    clashesFixed > 0
      ? `${clashesFixed} teacher clash(es) were auto-fixed. Please assign teachers manually for the highlighted slots.`
      : classSubjects.length === 0
      ? "No subjects defined for this class. Used teacher subjects as a fallback — add subjects via '📚 Subjects' for a class-appropriate timetable."
      : "";

  return { timetable: fixedTimetable, warning };
}
