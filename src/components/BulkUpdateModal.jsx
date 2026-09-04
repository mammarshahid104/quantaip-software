// Bulk student update — an editable snapshot of the roster, round-tripped
// through Excel. The template comes pre-filled with current Firestore values;
// the admin edits only the cells that are wrong and uploads the same file.
//
// Rows are matched on Student ID (the doc ID) rather than Roll No + Class,
// because those two can themselves be edited here. Every column is then
// compared field by field against Firestore and only the fields that actually
// differ are written, so an unchanged row costs no write at all.
//
// A blank cell means "leave this alone", never "clear this field" — the sheet
// is a full snapshot, so a blank is far more likely to be an accident than an
// intentional erase.
//
// Props: schoolCode,
//        students [{ id, rollNo, cls, fullName, fatherName, parentPhone,
//                    status, parentId }],
//        onClose, onSuccess
import { useMemo, useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import * as XLSX from "xlsx";
import { db } from "../firebase/config";
import {
  downloadBulkUpdateTemplate,
  BULK_UPDATE_SHEET,
} from "../services/excelExport";

// Editable columns. `key` is the field on the roster object, `docKey` the
// Firestore field, `col` the sheet header (with the spellings we also accept).
const FIELDS = [
  { key: "rollNo", docKey: "rollNo", label: "Roll No", cols: ["Roll No", "Roll No.", "Roll Number"] },
  { key: "cls", docKey: "class", label: "Class", cols: ["Class", "class", "Grade"] },
  { key: "fullName", docKey: "fullName", label: "Full Name", cols: ["Full Name", "Name"] },
  { key: "fatherName", docKey: "fatherName", label: "Father Name", cols: ["Father Name", "Fathers Name"] },
  { key: "parentPhone", docKey: "parentPhone", label: "Parent Phone", cols: ["Parent Phone", "Parents Phone", "Phone"] },
  { key: "status", docKey: "status", label: "Status", cols: ["Status", "status"] },
];

const STATUSES = ["active", "inactive"];

// Excel stores a phone typed as bare digits as a number, which drops the
// leading zero: 03009999999 comes back as 3009999999. Ten digits with no
// leading 0 is exactly that case — put it back (Pakistani mobile format).
// Anything else (dashes, +92, a 0 already there) is left untouched.
function normalizePhone(value) {
  const v = String(value ?? "").trim();
  return /^\d{10}$/.test(v) && !v.startsWith("0") ? `0${v}` : v;
}

// First non-empty value among the accepted header spellings.
function pick(row, headers) {
  for (const h of headers) {
    const v = row[h];
    if (v !== undefined && v !== null && String(v).trim() !== "")
      return String(v).trim();
  }
  return "";
}

const idKey = (v) => String(v ?? "").trim().toLowerCase();

export default function BulkUpdateModal({
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

  // Student ID → student. Matched case-insensitively so a re-typed ID still
  // lands, but the roster's own ID is what gets written to.
  const byId = useMemo(() => {
    const map = new Map();
    students.forEach((s) => map.set(idKey(s.id), s));
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
          (n) => n.toLowerCase() === BULK_UPDATE_SHEET.toLowerCase()
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
        sheetRows.map((r, i) => {
          const parsed = {
            rowNo: i + 2, // +1 for the header row, +1 for 1-based numbering
            studentId: pick(r, ["Student ID", "StudentID", "ID", "id"]),
          };
          FIELDS.forEach((f) => {
            parsed[f.key] = pick(r, f.cols);
          });
          return parsed;
        })
      );
    } catch (err) {
      console.error("Bulk update sheet parse failed:", err);
      setError("Couldn't read this file. Please upload a valid .xlsx file.");
    }
  };

  // Diff every row against Firestore. Only fields that actually differ become
  // changes; rows whose cells all match are counted as untouched.
  const checked = useMemo(() => {
    if (!rows)
      return { updates: [], warnings: [], unchanged: 0, tally: null, changeCount: 0 };

    const updates = [];
    const warnings = [];
    const seen = new Set();
    let unchanged = 0;

    rows.forEach((r) => {
      const anyValue = FIELDS.some((f) => r[f.key]);
      if (!r.studentId && !anyValue) return; // empty spreadsheet row
      if (!r.studentId) {
        warnings.push(`Row ${r.rowNo}: no Student ID — skipped`);
        return;
      }
      const student = byId.get(idKey(r.studentId));
      if (!student) {
        warnings.push(
          `Row ${r.rowNo}: No student found with Student ID ${r.studentId}`
        );
        return;
      }
      if (seen.has(idKey(r.studentId))) {
        warnings.push(
          `Row ${r.rowNo}: Student ID ${r.studentId} appears more than once in this file — skipped`
        );
        return;
      }
      seen.add(idKey(r.studentId));

      const changes = [];
      for (const f of FIELDS) {
        const incoming = r[f.key];
        if (!incoming) continue; // blank cell → leave the field as it is

        let next = incoming;
        if (f.key === "parentPhone") next = normalizePhone(incoming);
        if (f.key === "status") {
          next = incoming.toLowerCase();
          if (!STATUSES.includes(next)) {
            warnings.push(
              `Row ${r.rowNo}: Status "${incoming}" is not active or inactive — that cell was ignored`
            );
            continue;
          }
        }

        const current =
          f.key === "status"
            ? String(student.status || "active").toLowerCase()
            : String(student[f.key] ?? "");
        if (next === current) continue;

        changes.push({ ...f, from: current, to: next });
      }

      if (!changes.length) {
        unchanged += 1;
        return;
      }
      updates.push({ rowNo: r.rowNo, student, changes });
    });

    // Summary buckets, counted per change rather than per student.
    const tally = { phone: 0, father: 0, inactive: 0, reactivated: 0, other: 0 };
    let changeCount = 0;
    updates.forEach((u) =>
      u.changes.forEach((c) => {
        changeCount += 1;
        if (c.key === "parentPhone") tally.phone += 1;
        else if (c.key === "fatherName") tally.father += 1;
        else if (c.key === "status")
          c.to === "inactive" ? (tally.inactive += 1) : (tally.reactivated += 1);
        else tally.other += 1;
      })
    );

    return { updates, warnings, unchanged, tally, changeCount };
  }, [rows, byId]);

  const doUpdate = async () => {
    const { updates } = checked;
    if (!updates.length) return;
    setUpdating(true);
    setError("");
    setProgress({ done: 0, total: updates.length });

    let done = 0;
    let failed = 0;
    let parentFailed = 0;
    // Once the parents collection refuses one write it will refuse them all,
    // so stop trying after the first denial instead of hammering it per row.
    let parentDenied = false;

    for (const u of updates) {
      // Only the fields that differ — untouched columns are never written.
      const payload = {};
      u.changes.forEach((c) => {
        payload[c.docKey] = c.to;
      });

      try {
        await updateDoc(
          doc(db, `schools/${schoolCode}/students/${u.student.id}`),
          payload
        );
        done += 1;
      } catch (err) {
        console.error(`Bulk update failed for ${u.student.id}:`, err);
        if (err.code === "permission-denied") {
          setError("You don't have permission to update students.");
          setUpdating(false);
          return;
        }
        failed += 1;
        setProgress({ done: done + failed, total: updates.length });
        continue; // student write failed — don't sync a number that wasn't saved
      }

      // Keep the linked parent record's phone in step when the phone changed.
      // The student doc is already saved, so a failure here is counted and
      // reported rather than failing the row. Students predating the paired
      // parent accounts have no parentId and simply have nothing to sync.
      const phoneChange = u.changes.find((c) => c.key === "parentPhone");
      if (phoneChange && u.student.parentId) {
        if (parentDenied) {
          // Still unsynced, so it stays in the count — just don't re-ask.
          parentFailed += 1;
        } else {
          try {
            await updateDoc(
              doc(db, `schools/${schoolCode}/parents/${u.student.parentId}`),
              { phone: phoneChange.to }
            );
          } catch (parentErr) {
            console.error(
              `Parent phone sync failed for ${u.student.parentId}:`,
              parentErr
            );
            parentFailed += 1;
            if (parentErr.code === "permission-denied") parentDenied = true;
          }
        }
      }

      setProgress({ done: done + failed, total: updates.length });
    }

    const issues = [];
    if (failed) issues.push(`${failed} failed`);
    if (parentFailed)
      issues.push(
        `${parentFailed} linked parent record${
          parentFailed === 1 ? "" : "s"
        } couldn't be synced`
      );

    onSuccess?.(
      issues.length
        ? `${done} student${done === 1 ? "" : "s"} updated — ${issues.join(
            ", "
          )}. Please retry those.`
        : `${done} student${done === 1 ? "" : "s"} updated successfully!`
    );
  };

  const pct = progress.total
    ? Math.round((progress.done / progress.total) * 100)
    : 0;
  const noStudents = students.length === 0;
  const { tally } = checked;

  // Flatten the diff for display: one line per changed field.
  const diffLines = useMemo(() => {
    const out = [];
    checked.updates.forEach((u) =>
      u.changes.forEach((c) =>
        out.push({
          rowNo: u.rowNo,
          id: u.student.id,
          name: u.student.fullName || u.student.id,
          label: c.label,
          from: c.from,
          to: c.to,
        })
      )
    );
    return out;
  }, [checked.updates]);

  const shownDiffs = diffLines.slice(0, 20);

  const summaryLines = tally
    ? [
        tally.phone && `${tally.phone} phone number change${tally.phone === 1 ? "" : "s"}`,
        tally.father && `${tally.father} father name correction${tally.father === 1 ? "" : "s"}`,
        tally.inactive && `${tally.inactive} marked as inactive`,
        tally.reactivated && `${tally.reactivated} reactivated`,
        tally.other && `${tally.other} other field update${tally.other === 1 ? "" : "s"}`,
      ].filter(Boolean)
    : [];

  return (
    <div className="modal-overlay" onClick={updating ? undefined : onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Bulk Update Students</span>
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
                onClick={() => downloadBulkUpdateTemplate(students, schoolCode)}
                disabled={noStudents}
              >
                📥 Download Current Roster
              </button>
              <p className="page-subtitle" style={{ marginTop: 10 }}>
                All {students.length} student{students.length === 1 ? "" : "s"},
                pre-filled with their current values: Student ID · Roll No ·
                Class · Full Name · Father Name · Parent Phone · Status. Edit
                only the cells that need changing and upload the same file back.
              </p>
              <p className="field-hint">
                Don&apos;t edit the Student ID column — it&apos;s how each row
                is matched. Set Status to <strong>inactive</strong> to mark a
                student as withdrawn; their record and history are kept, never
                deleted. A cell left blank means &quot;leave as-is&quot;.
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
                  <strong>
                    {checked.updates.length} student
                    {checked.updates.length === 1 ? "" : "s"} will be updated
                  </strong>
                  {checked.changeCount
                    ? ` (${checked.changeCount} field change${
                        checked.changeCount === 1 ? "" : "s"
                      })`
                    : ""}
                  {checked.updates.length ? ":" : "."}
                </p>
                {summaryLines.length > 0 && (
                  <ul style={{ margin: "6px 0 8px 18px", fontSize: 13 }}>
                    {summaryLines.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                )}
                <p className="page-subtitle">
                  {`${checked.warnings.length} row${
                    checked.warnings.length === 1 ? "" : "s"
                  } skipped${
                    checked.unchanged
                      ? ` · ${checked.unchanged} row${
                          checked.unchanged === 1 ? "" : "s"
                        } unchanged`
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

                {shownDiffs.length > 0 && (
                  <table className="import-preview-table">
                    <thead>
                      <tr>
                        <th>Row</th>
                        <th>Student</th>
                        <th>Field</th>
                        <th>Current</th>
                        <th>New</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shownDiffs.map((d, i) => (
                        <tr key={`${d.id}-${d.label}-${i}`}>
                          <td>{d.rowNo}</td>
                          <td>{d.name}</td>
                          <td>{d.label}</td>
                          <td className="cell-muted">{d.from || "—"}</td>
                          <td className="cell-strong">{d.to}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {diffLines.length > shownDiffs.length && (
                  <p className="field-hint">
                    Showing the first {shownDiffs.length} of {diffLines.length}{" "}
                    changes.
                  </p>
                )}
              </div>
            )}

            {/* Step 4 — Progress */}
            {updating && (
              <div className="import-step">
                <div className="import-step-title">
                  Updating students… {progress.done}/{progress.total}
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
              : `Update ${checked.updates.length} Student${
                  checked.updates.length === 1 ? "" : "s"
                }`}
          </button>
        </div>
      </div>
    </div>
  );
}
