// Excel import modal — parses the simplified templates and writes to Firestore.
//   Students: Full Name | Class | Section | Roll No. | Father Name | Parents Phone
//   Teachers: Full Name | Subject | Class Assigned | Phone No.
// Every "Class" value is validated against schools/{schoolCode}/classes; rows
// naming an unknown class are flagged and skipped, but never block the import.
// Imports run in two phases: Firestore docs first, then a Firebase Auth login
// account for every imported teacher / student / parent.
// Props: type ("students" | "teachers"), schoolCode, onClose, onSuccess
import { useMemo, useState } from "react";
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
import { useClasses, matchClass, NO_CLASSES_MESSAGE } from "../services/classes";
import {
  createAuthAccount,
  AUTH_CREATE_DELAY_MS,
  sleep,
} from "../services/authAccounts";

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

// First non-empty value among the accepted header spellings.
function pick(row, ...headers) {
  for (const h of headers) {
    const v = row[h];
    if (v !== undefined && v !== null && String(v).trim() !== "")
      return String(v).trim();
  }
  return "";
}

export default function ImportExcelModal({
  type,
  schoolCode,
  onClose,
  onSuccess,
}) {
  const isStudents = type === "students";

  // Valid class names for this school — the import is checked against these.
  const {
    classes,
    loading: classesLoading,
    empty: noClasses,
  } = useClasses(schoolCode);

  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState(null); // { rows }
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  // phase: "docs" while writing Firestore, "accounts" while creating logins.
  const [progress, setProgress] = useState({ phase: "docs", done: 0, total: 0 });

  // Sheets carry the class name too (older exports had one sheet per class),
  // so a missing "Class" column still resolves.
  const parseStudents = (wb) => {
    const sheets = wb.SheetNames.filter((n) => n.toLowerCase() !== "teachers");
    const rows = [];
    sheets.forEach((sheetName) => {
      const sheetRows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
      sheetRows.forEach((r, i) => {
        rows.push({
          rowNo: i + 2, // +1 for the header row, +1 for 1-based numbering
          sheet: sheetName,
          name: pick(r, "Full Name", "Name", "name"),
          cls:
            pick(r, "Class", "class") ||
            (sheetName.toLowerCase() === "students" ? "" : sheetName),
          section: pick(r, "Section", "section") || "A",
          rollNo: pick(r, "Roll No.", "Roll No", "Roll Number"),
          fatherName: pick(r, "Father Name", "Fathers Name"),
          parentPhone: pick(r, "Parents Phone", "Parent Phone", "Phone"),
        });
      });
    });
    setParsed({ rows });
  };

  const parseTeachers = (wb) => {
    // Prefer a "Teachers" sheet; otherwise take the first one.
    const name =
      wb.SheetNames.find((n) => n.toLowerCase() === "teachers") ||
      wb.SheetNames[0];
    if (!name) {
      setError("This file has no sheets to import.");
      setParsed(null);
      return;
    }
    const sheetRows = XLSX.utils.sheet_to_json(wb.Sheets[name]);
    const rows = sheetRows.map((r, i) => ({
      rowNo: i + 2,
      name: pick(r, "Full Name", "Name", "name"),
      subject: pick(r, "Subject", "subject"),
      phone: pick(r, "Phone No.", "Phone No", "Phone", "phone"),
      classesAssigned: pick(r, "Class Assigned", "Classes Assigned")
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

  // Resolve each row's class against the school's classes and collect warnings.
  // Students with an unknown class are skipped; teachers keep the classes that
  // do exist and are imported either way.
  const checked = useMemo(() => {
    if (!parsed) return { rows: [], warnings: [], skipped: 0 };
    const warnings = [];
    let skipped = 0;

    const rows = parsed.rows.map((r) => {
      if (!r.name) {
        skipped += 1;
        warnings.push(`⚠️ Row ${r.rowNo}: no name — skipped`);
        return { ...r, skip: true };
      }

      if (isStudents) {
        if (!r.cls) {
          skipped += 1;
          warnings.push(`⚠️ Row ${r.rowNo}: no class given — skipped`);
          return { ...r, skip: true };
        }
        const match = matchClass(classes, r.cls);
        if (!match) {
          skipped += 1;
          warnings.push(
            `⚠️ Row ${r.rowNo}: Class "${r.cls}" not found — add it first or fix the spreadsheet`
          );
          return { ...r, skip: true };
        }
        return { ...r, cls: match, skip: false };
      }

      const resolved = [];
      const unknown = [];
      r.classesAssigned.forEach((c) => {
        const match = matchClass(classes, c);
        if (match) resolved.push(match);
        else unknown.push(c);
      });
      if (unknown.length) {
        warnings.push(
          `⚠️ Row ${r.rowNo}: Class ${unknown
            .map((c) => `"${c}"`)
            .join(", ")} not found — add it first or fix the spreadsheet`
        );
      }
      return { ...r, classesAssigned: resolved, skip: false };
    });

    return { rows, warnings, skipped };
  }, [parsed, classes, isStudents]);

  const validRows = checked.rows.filter((r) => !r.skip);

  const doImport = async () => {
    if (!validRows.length) return;
    setImporting(true);
    setError("");
    setProgress({ phase: "docs", done: 0, total: validRows.length });

    // Every account to create once the docs are written: { id, password }.
    // For students this is two entries per row — the student and their parent.
    const accounts = [];
    let done = 0;

    try {
      const colRef = collection(
        db,
        `schools/${schoolCode}/${isStudents ? "students" : "teachers"}`
      );
      const snap = await getDocs(colRef);
      let next = nextNumberFrom(snap.docs);

      for (const r of validRows) {
        const padded = String(next).padStart(4, "0");
        const password = `${firstNameOf(r.name)}${rand4()}`;
        if (isStudents) {
          const id = `${schoolCode}-STU-${padded}`;
          const parentId = `${schoolCode}-PAR-${padded}`;
          await setDoc(doc(colRef, id), {
            id,
            fullName: r.name,
            fatherName: r.fatherName,
            class: r.cls,
            section: r.section || "A",
            rollNo: r.rollNo,
            parentPhone: r.parentPhone,
            parentId,
            password,
            role: "student",
            school: schoolCode,
            status: "active",
            createdAt: serverTimestamp(),
          });
          // Paired parent account — shares the student's password so the admin
          // has a single credential to hand to the family.
          await setDoc(doc(db, `schools/${schoolCode}/parents/${parentId}`), {
            id: parentId,
            name: r.fatherName,
            phone: r.parentPhone,
            password,
            role: "parent",
            school: schoolCode,
            status: "active",
            studentId: id,
            studentName: r.name,
            createdAt: serverTimestamp(),
          });
          accounts.push({ id, password }, { id: parentId, password });
        } else {
          const id = `${schoolCode}-TCH-${padded}`;
          await setDoc(doc(colRef, id), {
            id,
            name: r.name,
            subject: r.subject,
            phone: r.phone,
            classesAssigned: r.classesAssigned,
            password,
            role: "teacher",
            school: schoolCode,
            status: "active",
            createdAt: serverTimestamp(),
          });
          accounts.push({ id, password });
        }
        next += 1;
        done += 1;
        setProgress({ phase: "docs", done, total: validRows.length });
      }
    } catch (err) {
      console.error("Import failed:", err);
      setError(
        err.code === "permission-denied"
          ? "You don't have permission to import data."
          : "Import failed partway through. Please try again."
      );
      setImporting(false);
      return;
    }

    // Phase 2 — Auth logins. The docs are already saved, so a failure here is
    // reported as a warning rather than failing the import. Firebase throttles
    // signups per IP, hence the pause between calls.
    setProgress({ phase: "accounts", done: 0, total: accounts.length });
    let created = 0;
    let failed = 0;
    for (const acc of accounts) {
      try {
        await createAuthAccount(acc.id, acc.password);
        created += 1;
      } catch (authErr) {
        failed += 1;
        console.error(`Auth account creation failed for ${acc.id}:`, authErr);
      }
      setProgress({
        phase: "accounts",
        done: created + failed,
        total: accounts.length,
      });
      await sleep(AUTH_CREATE_DELAY_MS);
    }

    const label = isStudents ? "students" : "teachers";
    onSuccess?.(
      failed
        ? `Imported ${done} ${label}, but ${failed} login account(s) failed — ` +
            `run the account setup script for those users.`
        : `Imported ${done} ${label} successfully!`
    );
  };

  const pct = progress.total
    ? Math.round((progress.done / progress.total) * 100)
    : 0;
  const creatingAccounts = progress.phase === "accounts";

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
                    Columns: Full Name · Class · Section · Roll No. · Father
                    Name · Parents Phone. Fill the data and upload below.
                  </>
                ) : (
                  <>
                    Columns: Full Name · Subject · Class Assigned · Phone No.
                    Class Assigned is comma-separated. Fill and upload below.
                  </>
                )}
              </p>
              {!classesLoading &&
                (noClasses ? (
                  <div
                    className="warn-banner"
                    style={{ margin: "10px 0 0", fontSize: 13 }}
                  >
                    ⚠️ {NO_CLASSES_MESSAGE}
                  </div>
                ) : (
                  <p className="field-hint">
                    Valid classes: {classes.join(", ")}
                  </p>
                ))}
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
                  {`Ready to import ${validRows.length} ${
                    isStudents ? "students" : "teachers"
                  }${
                    checked.skipped
                      ? ` · ${checked.skipped} row(s) will be skipped`
                      : ""
                  }.`}
                </p>
                {checked.warnings.length > 0 && (
                  <div
                    className="warn-banner"
                    style={{ margin: "8px 0", fontSize: 13, fontWeight: 500 }}
                  >
                    {checked.warnings.slice(0, 10).map((w, i) => (
                      <div key={i}>{w}</div>
                    ))}
                    {checked.warnings.length > 10 && (
                      <div>…and {checked.warnings.length - 10} more.</div>
                    )}
                  </div>
                )}

                {previewRows.length > 0 && (
                  <table className="import-preview-table">
                    <thead>
                      {isStudents ? (
                        <tr>
                          <th>Full Name</th>
                          <th>Class</th>
                          <th>Section</th>
                          <th>Roll No.</th>
                        </tr>
                      ) : (
                        <tr>
                          <th>Full Name</th>
                          <th>Subject</th>
                          <th>Class Assigned</th>
                          <th>Phone No.</th>
                        </tr>
                      )}
                    </thead>
                    <tbody>
                      {previewRows.map((r, i) =>
                        isStudents ? (
                          <tr key={i}>
                            <td>{r.name}</td>
                            <td>{r.cls}</td>
                            <td>{r.section}</td>
                            <td>{r.rollNo}</td>
                          </tr>
                        ) : (
                          <tr key={i}>
                            <td>{r.name}</td>
                            <td>{r.subject}</td>
                            <td>{r.classesAssigned.join(", ")}</td>
                            <td>{r.phone}</td>
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
                  {creatingAccounts ? "Creating login accounts…" : "Importing…"}{" "}
                  {progress.done}/{progress.total}
                </div>
                <div className="progress-wrap">
                  <div className="progress-fill" style={{ width: `${pct}%` }} />
                </div>
                {creatingAccounts && (
                  <p className="page-subtitle" style={{ marginTop: 8 }}>
                    Data is saved. Setting up mobile app logins — this takes a
                    moment, please keep this window open.
                  </p>
                )}
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
            disabled={importing || classesLoading || validRows.length === 0}
          >
            {importing
              ? `${
                  creatingAccounts ? "Creating login accounts…" : "Importing…"
                } ${progress.done}/${progress.total}`
              : `Import ${validRows.length} ${
                  isStudents ? "Students" : "Teachers"
                }`}
          </button>
        </div>
      </div>
    </div>
  );
}
