// Excel export + template generation.
// Format matches the mobile app exactly:
//   Students → one sheet per class, columns:
//     Name | Father Name | Section | Roll No | Parent Phone
//   Teachers → single "Teachers" sheet, columns:
//     Name | Subject | Phone | Classes Assigned (comma-separated)
import * as XLSX from "xlsx";

// "June 2026" → "June2026" for use in filenames.
function monthTag() {
  return new Date()
    .toLocaleString("default", { month: "long", year: "numeric" })
    .replace(/\s+/g, "");
}

// ---- Students: multi-sheet, one sheet per class ----
export function exportStudents(students, schoolCode) {
  const wb = XLSX.utils.book_new();

  const byClass = {};
  students.forEach((s) => {
    const cls = s.grade || s.class || "Unknown";
    if (!byClass[cls]) byClass[cls] = [];
    byClass[cls].push({
      Name: s.name || s.fullName || "",
      "Father Name": s.fatherName || "",
      Section: s.section || "",
      "Roll No": s.rollNo || "",
      "Parent Phone": s.parentPhone || "",
    });
  });

  const classes = Object.keys(byClass);
  if (classes.length === 0) {
    // Nothing to export — still produce a valid file with headers.
    const ws = XLSX.utils.aoa_to_sheet([
      ["Name", "Father Name", "Section", "Roll No", "Parent Phone"],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "Students");
  } else {
    classes.forEach((cls) => {
      const ws = XLSX.utils.json_to_sheet(byClass[cls]);
      // Sheet names are capped at 31 chars by Excel.
      XLSX.utils.book_append_sheet(wb, ws, String(cls).slice(0, 31));
    });
  }

  XLSX.writeFile(wb, `Students_${schoolCode}_${monthTag()}.xlsx`);
}

// ---- Teachers: single sheet ----
export function exportTeachers(teachers, schoolCode) {
  const data = teachers.map((t) => ({
    Name: t.name || "",
    Subject: t.subject || "",
    Phone: t.phone || "",
    "Classes Assigned": Array.isArray(t.classesAssigned)
      ? t.classesAssigned.join(", ")
      : t.classesAssigned || "",
  }));

  const ws = XLSX.utils.json_to_sheet(
    data.length
      ? data
      : [{ Name: "", Subject: "", Phone: "", "Classes Assigned": "" }]
  );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Teachers");

  XLSX.writeFile(wb, `Teachers_${schoolCode}_${monthTag()}.xlsx`);
}

// ---- Student import template (multi-sheet, with example data) ----
export function downloadStudentTemplate() {
  const wb = XLSX.utils.book_new();

  const grade10 = XLSX.utils.json_to_sheet([
    {
      Name: "Ahmed Ali",
      "Father Name": "Muhammad Ali",
      Section: "A",
      "Roll No": "001",
      "Parent Phone": "0300-1234567",
    },
    {
      Name: "Sara Khan",
      "Father Name": "Khan Muhammad",
      Section: "A",
      "Roll No": "002",
      "Parent Phone": "0301-1234567",
    },
  ]);
  XLSX.utils.book_append_sheet(wb, grade10, "Grade 10");

  // Empty class sheet — headers only.
  const grade11 = XLSX.utils.aoa_to_sheet([
    ["Name", "Father Name", "Section", "Roll No", "Parent Phone"],
  ]);
  XLSX.utils.book_append_sheet(wb, grade11, "Grade 11");

  const teachers = XLSX.utils.json_to_sheet([
    {
      Name: "Ms. Ayesha",
      Subject: "Physics",
      Phone: "0300-1111111",
      "Classes Assigned": "Grade 10, Grade 11",
    },
  ]);
  XLSX.utils.book_append_sheet(wb, teachers, "Teachers");

  XLSX.writeFile(wb, "Student_Import_Template.xlsx");
}

// ---- Teacher import template (single sheet) ----
export function downloadTeacherTemplate() {
  const ws = XLSX.utils.json_to_sheet([
    {
      Name: "Ms. Ayesha",
      Subject: "Physics",
      Phone: "0300-1111111",
      "Classes Assigned": "Grade 10, Grade 11, Grade 12",
    },
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Teachers");

  XLSX.writeFile(wb, "Teacher_Import_Template.xlsx");
}
