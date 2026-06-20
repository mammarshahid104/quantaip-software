// Daily Diary PDF generator (QUANTAIP version of the Chand Bagh Daily Diary).
//
// Pulls the subjects taught to a class (from teachers) and that day's homework,
// then renders an A4 portrait diary as a downloadable PDF via jsPDF + autoTable.
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { collection, getDocs, doc, getDoc } from "firebase/firestore";
import { db } from "../firebase/config";

const NAVY = [13, 31, 60];
const HEADER_BLUE = [184, 212, 240]; // #b8d4f0
const ROW_ALT = [245, 245, 245]; // #f5f5f5
const BORDER = [51, 51, 51]; // #333

// Parse a "YYYY-MM-DD" string as a *local* date (avoids UTC day-shift).
function localDate(dateStr) {
  const [y, m, d] = String(dateStr).split("-").map((n) => parseInt(n, 10));
  return new Date(y || 1970, (m || 1) - 1, d || 1);
}

function dayName(dateStr) {
  return localDate(dateStr).toLocaleDateString("en-GB", { weekday: "long" });
}

function prettyDate(dateStr) {
  return localDate(dateStr).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

// STEP 1 — subjects taught to this class, from teachers' classesAssigned.
async function fetchClassSubjects(schoolCode, className) {
  const snap = await getDocs(collection(db, `schools/${schoolCode}/teachers`));
  const set = new Set();
  snap.docs.forEach((d) => {
    const t = d.data();
    const assigned = Array.isArray(t.classesAssigned) ? t.classesAssigned : [];
    if (assigned.includes(className) && t.subject) {
      set.add(String(t.subject).trim());
    }
  });
  return Array.from(set);
}

// STEP 2 — homework due/assigned on the given date, mapped subject -> task(s).
async function fetchHomeworkMap(schoolCode, className, date) {
  const ref = doc(db, `schools/${schoolCode}/homework/${className}`);
  const snap = await getDoc(ref);
  const items = Array.isArray(snap.data()?.items) ? snap.data().items : [];

  const map = {};
  for (const it of items) {
    const matchesDue = it.dueDate === date;
    const matchesAssigned =
      typeof it.assignedAt === "string" && it.assignedAt.startsWith(date);
    if (!matchesDue && !matchesAssigned) continue;

    const subject = String(it.subject || "").trim();
    if (!subject) continue;
    const task = it.title
      ? it.description
        ? `${it.title} — ${it.description}`
        : it.title
      : it.description || "";
    map[subject] = map[subject] ? `${map[subject]}\n${task}` : task;
  }
  return map;
}

// Draw a small atom mark (QUANTAIP logo stand-in) at (cx, cy) in navy.
function drawAtom(pdf, cx, cy, r) {
  pdf.setDrawColor(...NAVY);
  pdf.setLineWidth(0.4);
  pdf.ellipse(cx, cy, r, r * 0.42, "S"); // horizontal orbit
  pdf.ellipse(cx, cy, r * 0.42, r, "S"); // vertical orbit
  pdf.circle(cx, cy, r * 0.7, "S"); // outer ring
  pdf.setFillColor(...NAVY);
  pdf.circle(cx, cy, r * 0.18, "F"); // nucleus
}

// jsPDF image format from a base64 data URL (defaults to PNG).
function imageFormat(dataUrl) {
  const m = /^data:image\/(png|jpe?g|webp)/i.exec(dataUrl || "");
  const t = m?.[1]?.toLowerCase();
  if (t === "jpg" || t === "jpeg") return "JPEG";
  if (t === "webp") return "WEBP";
  return "PNG";
}

export async function generateDiary({ schoolCode, className, date, schoolName }) {
  const [subjects, hwMap] = await Promise.all([
    fetchClassSubjects(schoolCode, className),
    fetchHomeworkMap(schoolCode, className, date),
  ]);

  // Row set: subjects from teachers, plus any homework subject not already in
  // that list (so a task is never silently dropped). Sorted alphabetically.
  const subjectSet = new Set(subjects);
  Object.keys(hwMap).forEach((s) => subjectSet.add(s));
  const rowSubjects = Array.from(subjectSet).sort((a, b) =>
    a.localeCompare(b)
  );

  const body = rowSubjects.map((s) => [s, hwMap[s] || ""]);

  const pdf = new jsPDF("p", "mm", "a4");
  const pageW = pdf.internal.pageSize.getWidth(); // 210
  const pageH = pdf.internal.pageSize.getHeight(); // 297
  const margin = 20;
  const usableW = pageW - margin * 2;

  // ----- Header: saved school logo (or atom placeholder) + school name -----
  const savedLogo = localStorage.getItem("schoolLogo") || "";
  const name =
    String(schoolName || "").trim() ||
    localStorage.getItem("schoolName") ||
    "Green Hills School";

  let nameX = margin + 20;
  if (savedLogo) {
    try {
      // Logo on the left, 25mm × 25mm.
      pdf.addImage(savedLogo, imageFormat(savedLogo), margin, 8, 25, 25);
      nameX = margin + 30;
    } catch (err) {
      console.warn("Couldn't embed school logo, using placeholder:", err);
      drawAtom(pdf, margin + 7, 20, 8);
    }
  } else {
    drawAtom(pdf, margin + 7, 20, 8);
  }

  pdf.setTextColor(...NAVY);
  pdf.setFont("times", "bold");
  pdf.setFontSize(26);
  pdf.text(name, nameX, 24);

  // ----- Gray "Daily Diary" bar -----
  const barY = 36;
  pdf.setFillColor(220, 220, 220);
  pdf.rect(margin, barY, usableW, 9, "F");
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(14);
  pdf.setTextColor(...NAVY);
  pdf.text("Daily Diary", pageW / 2, barY + 6, { align: "center" });

  // ----- Info row: DATE / DAY / Grade -----
  const infoY = barY + 18;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.setTextColor(30, 30, 30);
  pdf.text(`DATE: ${prettyDate(date)}`, margin, infoY);
  pdf.text(`DAY: ${dayName(date)}`, pageW / 2, infoY, { align: "center" });
  pdf.text(`Grade: ${className}`, pageW - margin, infoY, { align: "right" });

  // ----- Table: Subjects (30%) | Daily Tasks (70%) -----
  autoTable(pdf, {
    startY: infoY + 6,
    margin: { left: margin, right: margin },
    head: [["Subjects", "Daily Tasks"]],
    body: body.length ? body : [["—", ""]],
    theme: "grid",
    styles: {
      lineColor: BORDER,
      lineWidth: 0.3,
      fontSize: 11,
      cellPadding: 3,
      minCellHeight: 12, // ~40px so blank rows stay visible
      valign: "middle",
      textColor: [20, 20, 20],
    },
    headStyles: {
      fillColor: HEADER_BLUE,
      textColor: NAVY,
      fontStyle: "bold",
      halign: "center",
    },
    alternateRowStyles: { fillColor: ROW_ALT },
    columnStyles: {
      0: {
        cellWidth: usableW * 0.3,
        fontStyle: "bolditalic",
        halign: "center",
      },
      1: { cellWidth: usableW * 0.7, halign: "left" },
    },
  });

  // ----- Footer -----
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(120, 120, 120);
  pdf.text("Generated by QUANTAIP EduOS", pageW / 2, pageH - 14, {
    align: "center",
  });
  pdf.text("quantaip.org", pageW / 2, pageH - 9, { align: "center" });

  pdf.save(`Diary_${className}_${date}.pdf`);
}
