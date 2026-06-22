// Excel import modal — parses the mobile app's format and writes to Firestore.
//   Students: one sheet per class (sheet name = class), "Teachers" sheet skipped.
//   Teachers: the "Teachers" sheet only.
// Props: type ("students" | "teachers"), schoolCode, onClose, onSuccess
import { useState } from "react";
import {
  collection,
  doc,
  setDoc,
  getDocs,
  serverTimestamp,
} from "firebase/firestore";
import * as XLSX from "xlsx";
import { db } from "../firebase/config";
import {
  downloadStudentTemplate,
  downloadTeacherTemplate,
} from "../services/excelExport";

// Next sequential number from the max existing doc ID (delete-safe).
function nextNumberFrom(docs) {
  let max = 0;
  for (const d of docs) {
    const m = String(d.id).match(/(\d+)\s*$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max + 1;
}

const firstNameOf = (name) => String(name).trim().split(/\s+/)[0] || "";
const rand4 = () => Math.floor(1000 + Math.random() * 9000);

export default function ImportExcelModal({
  type,
  schoolCode,
  onClose,
  onSuccess,
}) {
  const isStudents = type === "students";

  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState(null); // { rows, classes? }
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const parseStudents = (wb) => {
    const sheets = wb.SheetNames.filter((n) => n.toLowerCase() !== "teachers");
    const rows = [];
    sheets.forEach((sheetName) => {
      const sheetRows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
      sheetRows.forEach((r) => {
        rows.push({
          sheet: sheetName,
          name: String(r["Name"] || r["name"] || "").trim(),
          cls: sheetName,
          fatherName: r["Father Name"] || "",
          section: r["Section"] || "A",
          rollNo: String(r["Roll No"] || ""),
          parentPhone: r["Parent Phone"] || "",
        });
      });
    });
    const classCount = new Set(rows.map((r) => r.sheet)).size;
    setParsed({ rows, classes: classCount });
  };

  const parseTeachers = (wb) => {
    const name = wb.SheetNames.find((n) => n.toLowerCase() === "teachers");
    if (!name) {
      setError('No "Teachers" sheet found in this file.');
      setParsed(null);
      return;
    }
    const sheetRows = XLSX.utils.sheet_to_json(wb.Sheets[name]);
    const rows = sheetRows.map((r) => ({
      name: String(r["Name"] || r["name"] || "").trim(),
      subject: r["Subject"] || "",
      phone: String(r["Phone"] || ""),
      classesAssigned: String(r["Classes Assigned"] || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    }));
    setParsed({ rows });
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    setParsed(null);
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      if (isStudents) parseStudents(wb);
      else parseTeachers(wb);
    } catch (err) {
      console.error("Excel parse failed:", err);
      setError("Couldn't read this file. Please upload a valid .xlsx file.");
    }
  };

  const missingNames = parsed
    ? parsed.rows.filter((r) => !r.name).length
    : 0;
  const validRows = parsed ? parsed.rows.filter((r) => r.name) : [];

  const doImport = async () => {
    if (!validRows.length) return;
    setImporting(true);
    setError("");
    setProgress({ done: 0, total: validRows.length });
    try {
      const colRef = collection(
        db,
        `schools/${schoolCode}/${isStudents ? "students" : "teachers"}`
      );
      const snap = await getDocs(colRef);
      let next = nextNumberFrom(snap.docs);
      let done = 0;

      for (const r of validRows) {
        const padded = String(next).padStart(4, "0");
        if (isStudents) {
          const id = `${schoolCode}-STU-${padded}`;
          await setDoc(doc(colRef, id), {
            id,
            fullName: r.name,
            fatherName: r.fatherName,
            class: r.cls,
            section: r.section || "A",
            rollNo: r.rollNo,
            parentPhone: r.parentPhone,
            parentId: `${schoolCode}-PAR-${padded}`,
            password: `${firstNameOf(r.name)}${rand4()}`,
            role: "student",
            school: schoolCode,
            status: "active",
            createdAt: serverTimestamp(),
          });
        } else {
          const id = `${schoolCode}-TCH-${padded}`;
          await setDoc(doc(colRef, id), {
            id,
            name: r.name,
            subject: r.subject,
            phone: r.phone,
            classesAssigned: r.classesAssigned,
            password: `${firstNameOf(r.name)}${rand4()}`,
            role: "teacher",
            school: schoolCode,
            status: "active",
            createdAt: serverTimestamp(),
          });
        }
        next += 1;
        done += 1;
        setProgress({ done, total: validRows.length });
      }

      onSuccess?.(
        `Imported ${done} ${isStudents ? "students" : "teachers"} successfully!`
      );
    } catch (err) {
      console.error("Import failed:", err);
      setError(
        err.code === "permission-denied"
          ? "You don't have permission to import data."
          : "Import failed partway through. Please try again."
      );
      setImporting(false);
    }
  };

  const pct = progress.total
    ? Math.round((progress.done / progress.total) * 100)
    : 0;

  const previewRows = validRows.slice(0, 5);

  return (
    <div className="modal-overlay" onClick={importing ? undefined : onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">
            Import {isStudents ? "Students" : "Teachers"}
          </span>
          <button
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
            disabled={importing}
          >
            ✕
          </button>
        </div>

        <div className="modal-body">
          {error && <div className="login-error">{error}</div>}

          <div className="import-steps">
            {/* Step 1 — Template */}
            <div className="import-step">
              <div className="import-step-title">1 · Download Template</div>
              <button
                type="button"
                className="btn-excel-import"
                onClick={
                  isStudents ? downloadStudentTemplate : downloadTeacherTemplate
                }
              >
                📥 Download {isStudents ? "Student" : "Teacher"} Template
              </button>
              <p className="page-subtitle" style={{ marginTop: 10 }}>
                {isStudents ? (
                  <>
                    Each sheet = one class (e.g. &quot;Grade 10&quot;). A
                    &quot;Teachers&quot; sheet is ignored here. Fill the data and
                    upload below.
                  </>
                ) : (
                  <>
                    Put all teachers on a single &quot;Teachers&quot; sheet.
                    Classes Assigned is comma-separated. Fill and upload below.
                  </>
                )}
              </p>
            </div>

            {/* Step 2 — Upload */}
            <div className="import-step">
              <div className="import-step-title">2 · Upload File</div>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFile}
                disabled={importing}
              />
              {fileName && (
                <p className="page-subtitle" style={{ marginTop: 8 }}>
                  Selected: <strong>{fileName}</strong>
                </p>
              )}
            </div>

            {/* Step 3 — Preview */}
            {parsed && (
              <div className="import-step">
                <div className="import-step-title">3 · Preview</div>
                <p className="page-subtitle">
                  {isStudents
                    ? `Found ${parsed.classes} class${
                        parsed.classes === 1 ? "" : "es"
                      }, ${validRows.length} students total.`
                    : `Found ${validRows.length} teachers.`}
                </p>
                {missingNames > 0 && (
                  <div
                    className="login-error"
                    style={{ margin: "8px 0", padding: "8px 10px" }}
                  >
                    ⚠️ {missingNames} row(s) have no name and will be skipped.
                  </div>
                )}

                {previewRows.length > 0 && (
                  <table className="import-preview-table">
                    <thead>
                      {isStudents ? (
                        <tr>
                          <th>Sheet</th>
                          <th>Name</th>
                          <th>Class</th>
                          <th>Section</th>
                        </tr>
                      ) : (
                        <tr>
                          <th>Name</th>
                          <th>Subject</th>
                          <th>Phone</th>
                          <th>Classes</th>
                        </tr>
                      )}
                    </thead>
                    <tbody>
                      {previewRows.map((r, i) =>
                        isStudents ? (
                          <tr key={i}>
                            <td>{r.sheet}</td>
                            <td>{r.name}</td>
                            <td>{r.cls}</td>
                            <td>{r.section}</td>
                          </tr>
                        ) : (
                          <tr key={i}>
                            <td>{r.name}</td>
                            <td>{r.subject}</td>
                            <td>{r.phone}</td>
                            <td>{r.classesAssigned.join(", ")}</td>
                          </tr>
                        )
                      )}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* Step 4 — Import / progress */}
            {importing && (
              <div className="import-step">
                <div className="import-step-title">
                  Importing… {progress.done}/{progress.total}
                </div>
                <div className="progress-wrap">
                  <div className="progress-fill" style={{ width: `${pct}%` }} />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn-cancel"
            onClick={onClose}
            disabled={importing}
          >
            {importing ? "Please wait…" : "Cancel"}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={doImport}
            disabled={importing || validRows.length === 0}
          >
            {importing
              ? `Importing… ${progress.done}/${progress.total}`
              : `Import ${validRows.length} ${
                  isStudents ? "Students" : "Teachers"
                }`}
          </button>
        </div>
      </div>
    </div>
  );
}
