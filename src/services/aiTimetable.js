// AI-powered timetable generation via the OpenAI API (browser-direct).
//
// SECURITY NOTE: This calls the OpenAI API directly from the browser using
// VITE_OPENAI_API_KEY, which is inlined into the client bundle at build time.
// That key is therefore extractable by anyone who uses the deployed app. This is
// acceptable only for a trusted/internal admin audience. For a public or
// multi-tenant deployment, move this call behind a backend (e.g. a Firebase
// Cloud Function) so the key never reaches the browser.
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase/config";

const API_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o-mini";

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
  } = params;

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

  const busySection = busyText
    ? `\nIMPORTANT — Teachers already busy in OTHER classes (DO NOT assign them at these times):
${busyText}

Never assign any of the teachers listed above to the same day + time slot — it would create a cross-class clash.\n`
    : "";

  return `You are a school timetable expert. Generate a clash-free weekly timetable for ${className}.

TEACHERS AND SUBJECTS:
${teacherLines}
${busySection}
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
- Subjects needed: ${subjects.join(", ")}

STRICT RULES:
1. Each subject should appear roughly equally across the week
2. No teacher can teach two classes at the same time
3. Physics/Maths/Science in morning periods (better focus)
4. Break must be included on all days
5. Friday should have fewer periods (Jummah prayer)
6. Distribute subjects evenly — avoid same subject twice in one day

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

  // Gather teachers already occupied in other classes so the AI can avoid
  // cross-class clashes. A read failure here shouldn't block generation.
  let busyText = "";
  try {
    const busyMap = await buildTeacherBusyMap(
      params.schoolCode,
      params.className
    );
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
      messages: [{ role: "user", content: buildPrompt(params, busyText) }],
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

  try {
    return JSON.parse(extractJson(text));
  } catch {
    throw new Error("Couldn't parse the AI's timetable. Please try again.");
  }
}
