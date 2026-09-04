// Bulk parent-phone update — fills in parentPhone for students that already
// exist in Firestore, matched by Roll No + Class.
// Template columns: Roll No | Class | Parent Phone (the first two pre-filled
// from the roster, the third left blank for the admin).
// Nothing but `parentPhone` is written: rows that don't match an existing
// student are skipped and reported, never created.
// Props: schoolCode, students [{ id, name, rollNo, cls }], onClose, onSuccess
import { useMemo, useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import * as XLSX from "xlsx";
import { db } from "../firebase/config";
import {
  downloadPhoneUpdateTemplate,
  PHONE_UPDATE_SHEET,
} from "../services/excelExport";

// Roll numbers travel through Excel as "001", "1" or the number 1 — all the
// same student — so leading zeros and case are dropped before comparing.
const normRoll = (v) =>
  String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/^0+(?=.)/, "");

const normClass = (v) =>
  String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const keyOf = (cls, roll) => `${normClass(cls)}|${normRoll(roll)}`;

// First non-empty value among the accepted header spellings.
function pick(row, ...headers) {
  for (const h of headers) {
    const v = row[h];
    if (v !== undefined && v !== null && String(v).trim() !== "")
      return String(v).trim();
  }
  return "";
}

export default function BulkPhoneUpdateModal({
  schoolCode,
  students,
  onClose,
  onSuccess,
}) {
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [updating, setUpdating] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  // Roll No + Class → student. A duplicate pair is ambiguous, so both entries
  // are marked and any row hitting them is skipped rather than guessed at.
  const index = useMemo(() => {
    const map = new Map();
    students.forEach((s) => {
      if (!s.rollNo || !s.cls) return;
      const k = keyOf(s.cls, s.rollNo);
      const existing = map.get(k);
      if (existing) existing.duplicate = true;
      else map.set(k, { student: s, duplicate: false });
    });
    return map;
  }, [students]);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    setRows(null);
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheetName =
        wb.SheetNames.find(
          (n) => n.toLowerCase() === PHONE_UPDATE_SHEET.toLowerCase()
        ) || wb.SheetNames[0];
      if (!sheetName) {
        setError("This file has no sheets to read.");
        return;
      }
      // raw:false gives the cell's displayed text, so a phone Excel decided
      // was a number still arrives as digits rather than 3.001234567e9.
      const sheetRows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
        raw: false,
      });
      setRows(
        sheetRows.map((r, i) => ({
          rowNo: i + 2, // +1 for the header row, +1 for 1-based numbering
          rollNo: pick(r, "Roll No", "Roll No.", "Roll Number", "rollNo"),
          cls: pick(r, "Class", "class", "Grade"),
          phone: pick(
            r,
            "Parent Phone",
            "Parents Phone",
            "Parent Phone No.",
            "Phone"
          ),
        }))
      );
    } catch (err) {
      console.error("Phone sheet parse failed:", err);
      setError("Couldn't read this file. Please upload a valid .xlsx file.");
    }
  };

  // Resolve every row against the roster: matches to update, everything else
  // skipped with a reason. Rows left blank are neither — they're just untouched.
  const checked = useMemo(() => {
    if (!rows) return { updates: [], warnings: [], blank: 0, skipped: 0 };
    const updates = [];
    const warnings = [];
    let blank = 0;
    const seen = new Set();

    rows.forEach((r) => {
      if (!r.rollNo && !r.cls && !r.phone) return; // empty spreadsheet row
      if (!r.phone) {
        blank += 1;
        return;
      }
      if (!r.rollNo || !r.cls) {
        warnings.push(
          `Row ${r.rowNo}: Roll No and Class are both required — skipped`
        );
        return;
      }
      const k = keyOf(r.cls, r.rollNo);
      const hit = index.get(k);
      if (!hit) {
        warnings.push(
          `Row ${r.rowNo}: No student found with Roll No ${r.rollNo} in ${r.cls}`
        );
        return;
      }
      if (hit.duplicate) {
        warnings.push(
          `Row ${r.rowNo}: More than one student has Roll No ${r.rollNo} in ${r.cls} — skipped`
        );
        return;
      }
      if (seen.has(k)) {
        warnings.push(
          `Row ${r.rowNo}: Roll No ${r.rollNo} in ${r.cls} appears more than once in this file — skipped`
        );
        return;
      }
      seen.add(k);
      updates.push({ ...r, student: hit.student });
    });

    return { updates, warnings, blank, skipped: warnings.length };
  }, [rows, index]);

  const doUpdate = async () => {
    const { updates } = checked;
    if (!updates.length) return;
    setUpdating(true);
    setError("");
    setProgress({ done: 0, total: updates.length });

    let done = 0;
    let failed = 0;
    for (const u of updates) {
      try {
        // Only parentPhone — the rest of the student doc is left alone.
        await updateDoc(
          doc(db, `schools/${schoolCode}/students/${u.student.id}`),
          { parentPhone: u.phone }
        );
        done += 1;
      } catch (err) {
        console.error(`Phone update failed for ${u.student.id}:`, err);
        if (err.code === "permission-denied") {
          setError("You don't have permission to update students.");
          setUpdating(false);
          return;
        }
        failed += 1;
      }
      setProgress({ done: done + failed, total: updates.length });
    }

    onSuccess?.(
      failed
        ? `${done} parent phone numbers updated, ${failed} failed — please retry those.`
        : `${done} parent phone numbers updated successfully!`
    );
  };

  const pct = progress.total
    ? Math.round((progress.done / progress.total) * 100)
    : 0;
  const previewRows = checked.updates.slice(0, 5);
  const noStudents = students.length === 0;

  return (
    <div className="modal-overlay" onClick={updating ? undefined : onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Bulk Update Parent Phones</span>
          <button
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
            disabled={updating}
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
                onClick={() =>
                  downloadPhoneUpdateTemplate(students, schoolCode)
                }
                disabled={noStudents}
              >
                📥 Download Template
              </button>
              <p className="page-subtitle" style={{ marginTop: 10 }}>
                Columns: Roll No · Class · Parent Phone. The first two come
                pre-filled from your {students.length} existing student
                {students.length === 1 ? "" : "s"} — fill in the phone numbers
                and upload the file back. Rows you leave blank are ignored.
              </p>
              <p className="field-hint">
                Tip: format the Parent Phone column as Text in Excel so leading
                zeros are kept.
              </p>
              {noStudents && (
                <div
                  className="warn-banner"
                  style={{ margin: "10px 0 0", fontSize: 13 }}
                >
                  ⚠️ No students on the roster yet — nothing to update.
                </div>
              )}
            </div>

            {/* Step 2 — Upload */}
            <div className="import-step">
              <div className="import-step-title">
                2 · Upload Filled Template
              </div>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFile}
                disabled={updating}
              />
              {fileName && (
                <p className="page-subtitle" style={{ marginTop: 8 }}>
                  Selected: <strong>{fileName}</strong>
                </p>
              )}
            </div>

            {/* Step 3 — Preview */}
            {rows && (
              <div className="import-step">
                <div className="import-step-title">3 · Preview</div>
                <p className="page-subtitle">
                  {`${checked.updates.length} student${
                    checked.updates.length === 1 ? "" : "s"
                  } will be updated${
                    checked.skipped
                      ? `, ${checked.skipped} row${
                          checked.skipped === 1 ? "" : "s"
                        } skipped (no match found)`
                      : ""
                  }${
                    checked.blank
                      ? ` · ${checked.blank} row${
                          checked.blank === 1 ? "" : "s"
                        } left blank`
                      : ""
                  }.`}
                </p>
                {checked.warnings.length > 0 && (
                  <div
                    className="warn-banner"
                    style={{ margin: "8px 0", fontSize: 13, fontWeight: 500 }}
                  >
                    {checked.warnings.slice(0, 10).map((w, i) => (
                      <div key={i}>⚠️ {w}</div>
                    ))}
                    {checked.warnings.length > 10 && (
                      <div>…and {checked.warnings.length - 10} more.</div>
                    )}
                  </div>
                )}

                {previewRows.length > 0 && (
                  <table className="import-preview-table">
                    <thead>
                      <tr>
                        <th>Roll No</th>
                        <th>Class</th>
                        <th>Student</th>
                        <th>New Phone</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((r) => (
                        <tr key={r.rowNo}>
                          <td>{r.rollNo}</td>
                          <td>{r.student.cls}</td>
                          <td>{r.student.name}</td>
                          <td>{r.phone}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {checked.updates.length > previewRows.length && (
                  <p className="field-hint">
                    Showing the first {previewRows.length} of{" "}
                    {checked.updates.length}.
                  </p>
                )}
              </div>
            )}

            {/* Step 4 — Progress */}
            {updating && (
              <div className="import-step">
                <div className="import-step-title">
                  Updating phone numbers… {progress.done}/{progress.total}
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
            disabled={updating}
          >
            {updating ? "Please wait…" : "Cancel"}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={doUpdate}
            disabled={updating || checked.updates.length === 0}
          >
            {updating
              ? `Updating… ${progress.done}/${progress.total}`
              : `Update ${checked.updates.length} Phone Number${
                  checked.updates.length === 1 ? "" : "s"
                }`}
          </button>
        </div>
      </div>
    </div>
  );
}
