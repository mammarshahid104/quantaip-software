// Excel export + template generation.
// Deliberately minimal — one flat sheet per entity, and exactly these columns:
//   Students → Full Name | Class | Section | Roll No. | Father Name | Parents Phone
//   Teachers → Full Name | Subject | Class Assigned | Phone No.
import * as XLSX from "xlsx";
import { classSort } from "./classes";

export const STUDENT_COLUMNS = [
  "Full Name",
  "Class",
  "Section",
  "Roll No.",
  "Father Name",
  "Parents Phone",
];

export const TEACHER_COLUMNS = [
  "Full Name",
  "Subject",
  "Class Assigned",
  "Phone No.",
];

// "June 2026" → "June2026" for use in filenames.
function monthTag() {
  return new Date()
    .toLocaleString("default", { month: "long", year: "numeric" })
    .replace(/\s+/g, "");
}

// Write `rows` under a fixed header order, so the sheet always has every
// column even when the data is empty.
function sheetWithColumns(rows, columns) {
  return rows.length
    ? XLSX.utils.json_to_sheet(rows, { header: columns })
    : XLSX.utils.aoa_to_sheet([columns]);
}

function studentRow(s) {
  return {
    "Full Name": s.name || s.fullName || "",
    Class: s.grade || s.class || "",
    Section: s.section || "",
    "Roll No.": s.rollNo || "",
    "Father Name": s.fatherName || "",
    "Parents Phone": s.parentPhone || "",
  };
}

function teacherRow(t) {
  return {
    "Full Name": t.name || t.fullName || "",
    Subject: t.subject || "",
    "Class Assigned": Array.isArray(t.classesAssigned)
      ? t.classesAssigned.join(", ")
      : t.classesAssigned || "",
    "Phone No.": t.phone || "",
  };
}

// ---- Students: single "Students" sheet ----
export function exportStudents(students, schoolCode) {
  const ws = sheetWithColumns(students.map(studentRow), STUDENT_COLUMNS);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Students");

  XLSX.writeFile(wb, `Students_${schoolCode}_${monthTag()}.xlsx`);
}

// ---- Teachers: single "Teachers" sheet ----
export function exportTeachers(teachers, schoolCode) {
  const ws = sheetWithColumns(teachers.map(teacherRow), TEACHER_COLUMNS);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Teachers");

  XLSX.writeFile(wb, `Teachers_${schoolCode}_${monthTag()}.xlsx`);
}

// ---- Student import template (one example row) ----
export function downloadStudentTemplate() {
  const ws = sheetWithColumns(
    [
      {
        "Full Name": "Ahmed Ali",
        Class: "Grade 10",
        Section: "A",
        "Roll No.": "001",
        "Father Name": "Muhammad Ali",
        "Parents Phone": "0300-1234567",
      },
    ],
    STUDENT_COLUMNS
  );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Students");

  XLSX.writeFile(wb, "Student_Import_Template.xlsx");
}

// ---- Teacher import template (one example row) ----
export function downloadTeacherTemplate() {
  const ws = sheetWithColumns(
    [
      {
        "Full Name": "Ms. Ayesha",
        Subject: "Physics",
        "Class Assigned": "Grade 10, Grade 11",
        "Phone No.": "0300-1111111",
      },
    ],
    TEACHER_COLUMNS
  );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Teachers");

  XLSX.writeFile(wb, "Teacher_Import_Template.xlsx");
}

// ---- Bulk student update ----
// A full editable snapshot of the roster: every column pre-filled with what is
// currently in Firestore, so the admin changes only the cells that are wrong
// and re-uploads. Student ID is the match key and must not be edited.
export const BULK_UPDATE_COLUMNS = [
  "Student ID",
  "Roll No",
  "Class",
  "Full Name",
  "Father Name",
  "Parent Phone",
  "Status",
];

export const BULK_UPDATE_SHEET = "Bulk Update";

export function downloadBulkUpdateTemplate(students, schoolCode) {
  const rows = students
    .slice()
    .sort(
      (a, b) =>
        classSort(a.cls || "", b.cls || "") ||
        String(a.rollNo).localeCompare(String(b.rollNo), undefined, {
          numeric: true,
        })
    )
    .map((s) => ({
      "Student ID": s.id,
      "Roll No": s.rollNo || "",
      Class: s.cls || "",
      "Full Name": s.fullName || "",
      "Father Name": s.fatherName || "",
      "Parent Phone": s.parentPhone || "",
      Status: s.status || "active",
    }));

  const ws = sheetWithColumns(rows, BULK_UPDATE_COLUMNS);
  ws["!cols"] = [
    { wch: 18 },
    { wch: 10 },
    { wch: 14 },
    { wch: 22 },
    { wch: 22 },
    { wch: 16 },
    { wch: 10 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, BULK_UPDATE_SHEET);

  XLSX.writeFile(wb, `Student_Bulk_Update_${schoolCode}_${monthTag()}.xlsx`);
}
