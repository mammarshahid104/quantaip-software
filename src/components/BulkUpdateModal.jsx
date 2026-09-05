// Bulk update — an editable snapshot of the roster, round-tripped through
// Excel. The template comes pre-filled with current Firestore values; the
// admin edits only the cells that are wrong and uploads the same file.
//
// Rows are matched on the doc ID rather than on any editable column, because
// every other field is fair game for editing here. Each column is then
// compared field by field against Firestore and only the fields that actually
// differ are written, so an unchanged row costs no write at all.
//
// A blank cell means "leave this alone", never "clear this field" — the sheet
// is a full snapshot, so a blank is far more likely to be an accident than an
// intentional erase.
//
// Props: type ("students" | "teachers"), schoolCode, rows, onClose, onSuccess
import { useMemo, useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import * as XLSX from "xlsx";
import { db } from "../firebase/config";
import {
  downloadBulkUpdateTemplate,
  downloadTeacherBulkUpdateTemplate,
  BULK_UPDATE_SHEET,
  TEACHER_BULK_UPDATE_SHEET,
} from "../services/excelExport";
import { useClasses, matchClass } from "../services/classes";
import { restoreLeadingZero, normalizePhone } from "../services/phone";

const STATUSES = ["active", "inactive"];

const splitList = (value) =>
  String(value ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

// ---------------------------------------------------------------------------
// Per-type configuration. The diff engine below is entirely generic; every
// difference between students and teachers lives in one of these two blocks.
//
// A field's `kind` drives how its cell is read and compared:
//   text   — trimmed string, compared exactly
//   phone  — normalized through `normalize` on BOTH sides, so an untouched
//            number never reads as a change just because it has dashes
//   list   — comma-separated, compared on the joined value
//   status — active / inactive, anything else is rejected with a warning
// ---------------------------------------------------------------------------
const TYPES = {
  students: {
    title: "Bulk Update Students",
    singular: "student",
    collection: "students",
    idLabel: "Student ID",
    idCols: ["Student ID", "StudentID", "ID", "id"],
    sheet: BULK_UPDATE_SHEET,
    downloadTemplate: downloadBulkUpdateTemplate,
    columnsHint:
      "Student ID · Roll No · Class · Full Name · Father Name · Parent Phone · Status",
    withdrawnWord: "withdrawn",
    syncsParentPhone: true,
    nameOf: (e) => e.fullName || e.id,
    fields: [
      { key: "rollNo", docKey: "rollNo", label: "Roll No", cols: ["Roll No", "Roll No.", "Roll Number"], kind: "text", bucket: "other field update" },
      { key: "cls", docKey: "class", label: "Class", cols: ["Class", "class", "Grade"], kind: "text", bucket: "other field update" },
      { key: "fullName", docKey: "fullName", label: "Full Name", cols: ["Full Name", "Name"], kind: "text", bucket: "other field update" },
      { key: "fatherName", docKey: "fatherName", label: "Father Name", cols: ["Father Name", "Fathers Name"], kind: "text", bucket: "father name correction" },
      { key: "parentPhone", docKey: "parentPhone", label: "Parent Phone", cols: ["Parent Phone", "Parents Phone", "Phone"], kind: "phone", normalize: restoreLeadingZero, bucket: "phone number change" },
      { key: "status", docKey: "status", label: "Status", cols: ["Status", "status"], kind: "status" },
    ],
  },
  teachers: {
    title: "Bulk Update Teachers",
    singular: "teacher",
    collection: "teachers",
    idLabel: "Teacher ID",
    idCols: ["Teacher ID", "TeacherID", "ID", "id"],
    sheet: TEACHER_BULK_UPDATE_SHEET,
    downloadTemplate: downloadTeacherBulkUpdateTemplate,
    columnsHint:
      "Teacher ID · Full Name · Subject · Classes Assigned · Phone · Status",
    withdrawnWord: "no longer teaching",
    syncsParentPhone: false,
    nameOf: (e) => e.name || e.id,
    fields: [
      {
        key: "name",
        docKey: "name",
        label: "Full Name",
        cols: ["Full Name", "Name", "name"],
        kind: "text",
        bucket: "name correction",
        // Readers prefer `fullName` when a doc carries it, so a doc that
        // already has one gets both written — otherwise the edit would save
        // but never show.
        toPayload: (value, entity) =>
          entity.nameKey === "fullName"
            ? { name: value, fullName: value }
            : { name: value },
      },
      { key: "subject", docKey: "subject", label: "Subject", cols: ["Subject", "subject"], kind: "text", bucket: "subject change" },
      { key: "classesAssigned", docKey: "classesAssigned", label: "Classes Assigned", cols: ["Classes Assigned", "Class Assigned", "Classes"], kind: "list", bucket: "class assignment change" },
      { key: "phone", docKey: "phone", label: "Phone", cols: ["Phone", "Phone No.", "Phone No", "phone"], kind: "phone", normalize: normalizePhone, bucket: "phone change" },
      { key: "status", docKey: "status", label: "Status", cols: ["Status", "status"], kind: "status" },
    ],
  },
};

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
  type = "students",
  schoolCode,
  rows: entities,
  onClose,
  onSuccess,
}) {
  const config = TYPES[type] || TYPES.students;
  const { fields } = config;

  // Only the teachers sheet validates class names, but hooks can't be
  // conditional — the students flow simply never reads this.
  const { classes } = useClasses(schoolCode);

  const [fileName, setFileName] = useState("");
  const [sheetRows, setSheetRows] = useState(null);
  const [error, setError] = useState("");
  const [updating, setUpdating] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  // Doc ID → entity. Matched case-insensitively so a re-typed ID still lands,
  // but the roster's own ID is what gets written to.
  const byId = useMemo(() => {
    const map = new Map();
    entities.forEach((e) => map.set(idKey(e.id), e));
    return map;
  }, [entities]);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    setSheetRows(null);
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheetName =
        wb.SheetNames.find(
          (n) => n.toLowerCase() === config.sheet.toLowerCase()
        ) || wb.SheetNames[0];
      if (!sheetName) {
        setError("This file has no sheets to read.");
        return;
      }
      // raw:false gives the cell's displayed text, so a phone Excel decided
      // was a number still arrives as digits rather than 3.001234567e9.
      const parsed = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
        raw: false,
      });
      setSheetRows(
        parsed.map((r, i) => {
          const row = {
            rowNo: i + 2, // +1 for the header row, +1 for 1-based numbering
            entityId: pick(r, config.idCols),
          };
          fields.forEach((f) => {
            row[f.key] = pick(r, f.cols);
          });
          return row;
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
    if (!sheetRows)
      return { updates: [], warnings: [], unchanged: 0, counts: {}, changeCount: 0 };

    const updates = [];
    const warnings = [];
    const seen = new Set();
    let unchanged = 0;

    sheetRows.forEach((r) => {
      const anyValue = fields.some((f) => r[f.key]);
      if (!r.entityId && !anyValue) return; // empty spreadsheet row
      if (!r.entityId) {
        warnings.push(`Row ${r.rowNo}: no ${config.idLabel} — skipped`);
        return;
      }
      const entity = byId.get(idKey(r.entityId));
      if (!entity) {
        warnings.push(
          `Row ${r.rowNo}: No ${config.singular} found with ${config.idLabel} ${r.entityId}`
        );
        return;
      }
      if (seen.has(idKey(r.entityId))) {
        warnings.push(
          `Row ${r.rowNo}: ${config.idLabel} ${r.entityId} appears more than once in this file — skipped`
        );
        return;
      }
      seen.add(idKey(r.entityId));

      const changes = [];
      for (const f of fields) {
        const incoming = r[f.key];
        if (!incoming) continue; // blank cell → leave the field as it is

        let next;
        let current;
        let write;

        if (f.kind === "status") {
          next = incoming.toLowerCase();
          if (!STATUSES.includes(next)) {
            warnings.push(
              `Row ${r.rowNo}: Status "${incoming}" is not active or inactive — that cell was ignored`
            );
            continue;
          }
          current = String(entity.status || "active").toLowerCase();
          write = next;
        } else if (f.kind === "phone") {
          // Both sides go through the same normalizer, so a number the admin
          // never touched can't read as a change just because of its dashes.
          next = f.normalize(incoming);
          current = f.normalize(entity[f.key] ?? "");
          write = next;
        } else if (f.kind === "list") {
          const list = splitList(incoming).map((c) => {
            const known = matchClass(classes, c);
            if (!known && classes.length) {
              warnings.push(
                `Row ${r.rowNo}: Class "${c}" isn't one of this school's classes — saved as typed`
              );
            }
            // Reuse the school's own spelling when it matches.
            return known || c;
          });
          const currentList = Array.isArray(entity[f.key])
            ? entity[f.key]
            : splitList(entity[f.key]);
          next = list.join(", ");
          current = currentList.join(", ");
          write = list;
        } else {
          next = incoming;
          current = String(entity[f.key] ?? "");
          write = next;
        }

        if (next === current) continue;
        changes.push({ field: f, from: current, to: next, write });
      }

      if (!changes.length) {
        unchanged += 1;
        return;
      }
      updates.push({ rowNo: r.rowNo, entity, changes });
    });

    // Summary buckets, counted per change rather than per row.
    const counts = {};
    let changeCount = 0;
    updates.forEach((u) =>
      u.changes.forEach((c) => {
        changeCount += 1;
        const bucket =
          c.field.kind === "status"
            ? c.to === "inactive"
              ? "marked as inactive"
              : "reactivated"
            : c.field.bucket;
        counts[bucket] = (counts[bucket] || 0) + 1;
      })
    );

    return { updates, warnings, unchanged, counts, changeCount };
  }, [sheetRows, byId, fields, config, classes]);

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
        Object.assign(
          payload,
          c.field.toPayload
            ? c.field.toPayload(c.write, u.entity)
            : { [c.field.docKey]: c.write }
        );
      });

      try {
        await updateDoc(
          doc(db, `schools/${schoolCode}/${config.collection}/${u.entity.id}`),
          payload
        );
        done += 1;
      } catch (err) {
        console.error(`Bulk update failed for ${u.entity.id}:`, err);
        if (err.code === "permission-denied") {
          setError(
            `You don't have permission to update ${config.collection}.`
          );
          setUpdating(false);
          return;
        }
        failed += 1;
        setProgress({ done: done + failed, total: updates.length });
        continue; // the write failed — don't sync a number that wasn't saved
      }

      // Students only: keep the linked parent record's phone in step. The
      // student doc is already saved, so a failure here is counted and
      // reported rather than failing the row. Students predating the paired
      // parent accounts have no parentId and simply have nothing to sync.
      const phoneChange = config.syncsParentPhone
        ? u.changes.find((c) => c.field.key === "parentPhone")
        : null;
      if (phoneChange && u.entity.parentId) {
        if (parentDenied) {
          // Still unsynced, so it stays in the count — just don't re-ask.
          parentFailed += 1;
        } else {
          try {
            await updateDoc(
              doc(db, `schools/${schoolCode}/parents/${u.entity.parentId}`),
              { phone: phoneChange.write }
            );
          } catch (parentErr) {
            console.error(
              `Parent phone sync failed for ${u.entity.parentId}:`,
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

    const noun = `${config.singular}${done === 1 ? "" : "s"}`;
    onSuccess?.(
      issues.length
        ? `${done} ${noun} updated — ${issues.join(", ")}. Please retry those.`
        : `${done} ${noun} updated successfully!`
    );
  };

  const pct = progress.total
    ? Math.round((progress.done / progress.total) * 100)
    : 0;
  const noEntities = entities.length === 0;

  // Flatten the diff for display: one line per changed field.
  const diffLines = useMemo(() => {
    const out = [];
    checked.updates.forEach((u) =>
      u.changes.forEach((c) =>
        out.push({
          rowNo: u.rowNo,
          id: u.entity.id,
          name: config.nameOf(u.entity),
          label: c.field.label,
          from: c.from,
          to: c.to,
        })
      )
    );
    return out;
  }, [checked.updates, config]);

  const shownDiffs = diffLines.slice(0, 20);

  // Fixed order so the summary reads the same way every time.
  const summaryLines = useMemo(() => {
    const order = [];
    fields.forEach((f) => {
      if (f.kind !== "status" && !order.includes(f.bucket)) order.push(f.bucket);
    });
    const lines = order
      .filter((b) => checked.counts[b])
      .map((b) => `${checked.counts[b]} ${b}${checked.counts[b] === 1 ? "" : "s"}`);
    if (checked.counts["marked as inactive"])
      lines.push(`${checked.counts["marked as inactive"]} marked as inactive`);
    if (checked.counts["reactivated"])
      lines.push(`${checked.counts["reactivated"]} reactivated`);
    return lines;
  }, [checked.counts, fields]);

  return (
    <div className="modal-overlay" onClick={updating ? undefined : onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">{config.title}</span>
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
                onClick={() => config.downloadTemplate(entities, schoolCode)}
                disabled={noEntities}
              >
                📥 Download Current {config.singular === "student" ? "Roster" : "List"}
              </button>
              <p className="page-subtitle" style={{ marginTop: 10 }}>
                All {entities.length} {config.singular}
                {entities.length === 1 ? "" : "s"}, pre-filled with their
                current values: {config.columnsHint}. Edit only the cells that
                need changing and upload the same file back.
              </p>
              <p className="field-hint">
                Don&apos;t edit the {config.idLabel} column — it&apos;s how each
                row is matched. Set Status to <strong>inactive</strong> to mark
                a {config.singular} as {config.withdrawnWord}; their record and
                history are kept, never deleted. A cell left blank means
                &quot;leave as-is&quot;.
              </p>
              {noEntities && (
                <div
                  className="warn-banner"
                  style={{ margin: "10px 0 0", fontSize: 13 }}
                >
                  ⚠️ No {config.singular}s on record yet — nothing to update.
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
            {sheetRows && (
              <div className="import-step">
                <div className="import-step-title">3 · Preview</div>
                <p className="page-subtitle">
                  <strong>
                    {checked.updates.length} {config.singular}
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
                        <th>{config.idLabel === "Student ID" ? "Student" : "Teacher"}</th>
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
                  Updating {config.singular}s… {progress.done}/{progress.total}
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
              : `Update ${checked.updates.length} ${
                  config.singular.charAt(0).toUpperCase() +
                  config.singular.slice(1)
                }${checked.updates.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
