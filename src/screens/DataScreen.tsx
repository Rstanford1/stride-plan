import {
  ArchiveRestore,
  Database,
  Download,
  FileSpreadsheet,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { useAppData } from "../data/app-context";
import { validatePlanRows, type ImportValidation } from "../domain/imports";
import { reviseSession } from "../domain/rules";
import type { AppData } from "../domain/types";
import { serializeBackup } from "../domain/backup";
import { FitFileParserDecoder } from "../domain/fit-decoder";
import { runFitImportBatch } from "../data/fit-import-controller";
import { createFitSourceStore } from "../data/fit-source-store";
import { inspectLegacyRestore, type RestorePreview } from "../data/restore";

export function DataScreen() {
  const { data, replaceData, resetDemo, updateSettings, restoreBackup } =
    useAppData();
  const [preview, setPreview] = useState<ImportValidation | null>(null);
  const [importSource, setImportSource] = useState<{
    name: string;
    fingerprint: string;
  } | null>(null);
  const [message, setMessage] = useState("");
  const [restorePreview, setRestorePreview] = useState<RestorePreview | null>(
    null,
  );
  const [restoring, setRestoring] = useState(false);
  const restoreDialog = useRef<HTMLDialogElement>(null);
  const restoreInput = useRef<HTMLInputElement>(null);
  const fitImportController = useRef<AbortController | null>(null);
  const [fitImportProgress, setFitImportProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);

  function downloadJson(contents: unknown, name: string) {
    const serialized =
      typeof contents === "object" &&
      contents !== null &&
      "schemaVersion" in contents
        ? serializeBackup(contents as AppData)
        : JSON.stringify(contents, null, 2);
    const blob = new Blob([serialized], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  async function inspectPlan(file: File) {
    const buffer = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    const fingerprint = Array.from(new Uint8Array(digest))
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
    const sheetName = workbook.SheetNames.includes("Plan")
      ? "Plan"
      : workbook.SheetNames.includes("Daily Plan")
        ? "Daily Plan"
        : workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: "",
      range: sheetName === "Plan" || sheetName === "Daily Plan" ? 3 : 0,
    });
    const rows = rawRows.map((row) => {
      if ("Planned mi" in row) {
        const rawDate = row.Date;
        let date = "";
        if (rawDate instanceof Date) {
          date = rawDate.toISOString().slice(0, 10);
        } else if (typeof rawDate === "number") {
          const parsed = XLSX.SSF.parse_date_code(rawDate);
          date = `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
        } else {
          date = String(rawDate).slice(0, 10);
        }
        const title = String(row.Session ?? "");
        const normalized = title.toLowerCase();
        const sessionType = normalized.includes("long")
          ? "long"
          : normalized.includes("recovery")
            ? "recovery"
            : normalized.includes("rest")
              ? "rest"
              : normalized.includes("quality") ||
                  normalized.includes("threshold")
                ? "workout"
                : "easy";
        const pace = String(row["Pace (min/mi)"] ?? "").trim();
        const hr = String(row["HR guide (bpm)"] ?? "").trim();
        return {
          date,
          title,
          planned_miles: row["Planned mi"],
          session_type: sessionType,
          guidance: [pace && `${pace}/mi`, hr && `HR ${hr} bpm`]
            .filter(Boolean)
            .join(" · "),
          instructions: row.Details,
          flexible: String(row["Flex run? (Mon)"]).toLowerCase() === "yes",
          phase: String(row.Phase ?? "Imported"),
        };
      }
      if (!("Planned miles" in row)) return row;
      const rawDate = row.Date;
      const date =
        rawDate instanceof Date
          ? rawDate.toISOString().slice(0, 10)
          : String(rawDate).slice(0, 10);
      const sourceType = String(row["Session type"] ?? "easy").toLowerCase();
      const sessionType = sourceType.includes("long")
        ? "long"
        : sourceType.includes("recovery")
          ? "recovery"
          : sourceType.includes("rest")
            ? "rest"
            : sourceType.includes("workout")
              ? "workout"
              : "easy";
      const week = Number(row.Week ?? 1);
      return {
        date,
        title: row.Session,
        planned_miles: row["Planned miles"],
        session_type: sessionType,
        guidance: row["Pace / HR guide"],
        instructions: row.Notes,
        flexible: false,
        phase: week <= 4 ? "Foundation" : week <= 8 ? "Build" : "Steady volume",
      };
    });
    setPreview(validatePlanRows(rows));
    setImportSource({ name: file.name, fingerprint });
    setMessage("");
  }

  function confirmPlanImport() {
    if (!preview || !importSource) return;
    if (data.importFingerprints.includes(importSource.fingerprint)) {
      setMessage(
        "This exact plan file was already imported. No sessions were duplicated.",
      );
      return;
    }
    const ordered = [...preview.validRows].sort((a, b) =>
      a.date.localeCompare(b.date),
    );
    const first = new Date(`${ordered[0]?.date ?? "1970-01-01"}T12:00:00`);
    const imported = ordered.map((row, index) => {
      const sourceKey = `plan:${row.date}:${row.title.trim().toLowerCase()}`;
      const existing = data.sessions.find(
        (session) => session.sourceKey === sourceKey,
      );
      if (existing) {
        return reviseSession(
          existing,
          {
            scheduledDate: row.date,
            plannedDistanceMiles: row.planned_miles,
          },
          `Plan re-import: ${importSource.name}`,
        );
      }
      const date = new Date(`${row.date}T12:00:00`);
      const week =
        Math.floor((date.getTime() - first.getTime()) / (7 * 86400000)) + 1;
      return {
        id: `import-${importSource.fingerprint.slice(0, 10)}-${index + 1}`,
        sourceKey,
        week,
        originalDate: row.date,
        scheduledDate: row.date,
        originalDistanceMiles: row.planned_miles,
        plannedDistanceMiles: row.planned_miles,
        title: row.title,
        kind: row.session_type,
        instructions: row.instructions,
        guidance: row.guidance,
        flexible: row.flexible,
        phase: row.phase,
        status: "planned" as const,
        revisions: [],
      };
    });
    const keys = new Set(imported.map((session) => session.sourceKey));
    replaceData({
      ...data,
      sessions: [
        ...data.sessions.filter((session) => !keys.has(session.sourceKey)),
        ...imported,
      ],
      importFingerprints: [
        ...data.importFingerprints,
        importSource.fingerprint,
      ],
    });
    setMessage(
      `${imported.length} sessions imported from ${importSource.name}. Re-imports use stable row identities.`,
    );
    setPreview(null);
  }
  async function restore(file: File) {
    setMessage("");
    setRestoring(true);
    try {
      const inspected = await inspectLegacyRestore(
        await file.text(),
        createFitSourceStore(),
      );
      setRestorePreview(inspected);
      restoreDialog.current?.showModal();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The backup could not be read. Current data is unchanged.",
      );
    } finally {
      setRestoring(false);
      if (restoreInput.current) restoreInput.current.value = "";
    }
  }
  function cancelRestore() {
    if (restoring) return;
    restoreDialog.current?.close();
    setRestorePreview(null);
  }
  async function confirmRestore() {
    if (!restorePreview || restoring) return;
    setRestoring(true);
    try {
      await restoreBackup(restorePreview.raw);
      restoreDialog.current?.close();
      setRestorePreview(null);
      setMessage(
        "Legacy snapshot restored and saved. The previous snapshot is retained in a verified local safety copy. Original FIT bytes were not included in the JSON backup.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Restore failed. The previous snapshot is retained.",
      );
    } finally {
      setRestoring(false);
    }
  }

  async function importFitFiles(files: FileList) {
    if (files.length === 0) return;
    const controller = new AbortController();
    fitImportController.current = controller;
    setFitImportProgress({ completed: 0, total: files.length });
    setMessage(`Reading ${files.length} FIT file(s)…`);
    const result = await runFitImportBatch({
      files: Array.from(files, (file) => ({
        name: file.name,
        loadBytes: async () => new Uint8Array(await file.arrayBuffer()),
      })),
      existingSources: data.fitSources,
      decoder: new FitFileParserDecoder(),
      sourceStore: createFitSourceStore(),
      createdAt: new Date().toISOString(),
      signal: controller.signal,
      onProgress: (completed, total) =>
        setFitImportProgress({ completed, total }),
    });
    replaceData({
      ...data,
      fitSources: [...data.fitSources, ...result.sources],
      fitSourceActivities: [...data.fitSourceActivities, ...result.activities],
      fitImportBatches: [...data.fitImportBatches, result.batch],
    });
    const counts = result.batch.sourceResults.reduce<Record<string, number>>(
      (current, item) => ({
        ...current,
        [item.status]: (current[item.status] ?? 0) + 1,
      }),
      {},
    );
    setMessage(
      [
        counts.decoded && `${counts.decoded} ready to review`,
        counts["exact-duplicate"] &&
          `${counts["exact-duplicate"]} exact duplicate(s) skipped`,
        counts.failed && `${counts.failed} failed`,
        counts.cancelled && `${counts.cancelled} cancelled`,
      ]
        .filter(Boolean)
        .join(" · "),
    );
    fitImportController.current = null;
    setFitImportProgress(null);
  }
  return (
    <div className="screen">
      <header className="page-header">
        <div>
          <p className="eyebrow">Local data</p>
          <h1>Data & settings</h1>
          <p>Imports, backups, and preferences stay on this device.</p>
        </div>
        <span className="privacy-badge">
          <ShieldCheck size={17} /> No account · no telemetry
        </span>
      </header>
      {message && (
        <div className="inline-message" role="status">
          {message}
        </div>
      )}
      <div className="settings-grid">
        <section className="panel settings-panel">
          <div className="settings-icon">
            <FileSpreadsheet />
          </div>
          <div>
            <h2>Import a plan</h2>
            <p>
              CSV or Excel. One session per row with a validation preview before
              any changes.
            </p>
            <label className="button secondary file-button">
              <Upload size={17} /> Choose file
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={(event) =>
                  event.target.files?.[0] &&
                  void inspectPlan(event.target.files[0])
                }
              />
            </label>
          </div>
        </section>
        <section className="panel settings-panel">
          <div className="settings-icon">
            <Database />
          </div>
          <div>
            <h2>Import FIT activities</h2>
            <p>
              Decode one or more activities, check exact duplicates, and send
              successful files to Activity Review. The packaged app preserves a
              verified untouched copy; browser development cannot provide
              durable source-file preservation.
            </p>
            <label className="button secondary file-button">
              <Upload size={17} /> Choose FIT files
              <input
                type="file"
                accept=".fit"
                multiple
                disabled={fitImportProgress !== null}
                onChange={(event) =>
                  event.target.files && void importFitFiles(event.target.files)
                }
              />
            </label>
            {fitImportProgress && (
              <div className="fit-import-progress" role="status">
                <p>
                  Processed {fitImportProgress.completed} of{" "}
                  {fitImportProgress.total} files.
                </p>
                <button
                  className="text-button"
                  onClick={() => fitImportController.current?.abort()}
                >
                  Stop after current file
                </button>
              </div>
            )}
          </div>
        </section>
        <section className="panel settings-panel">
          <div className="settings-icon">
            <Download />
          </div>
          <div>
            <h2>Legacy JSON backup</h2>
            <p>
              Export plan, activity, journal, revision and settings records.
              This is an incomplete backup: it does not contain original FIT
              bytes or newer native records.
            </p>
            <button
              className="button secondary"
              onClick={() =>
                downloadJson(
                  data,
                  `stride-plan-backup-${new Date().toISOString().slice(0, 10)}.json`,
                )
              }
            >
              <Download size={17} /> Export backup
            </button>
          </div>
        </section>
        <section className="panel settings-panel">
          <div className="settings-icon">
            <ArchiveRestore />
          </div>
          <div>
            <h2>Restore</h2>
            <p>
              Validate and preview a legacy JSON snapshot before confirming
              replacement. Original FIT files must already be preserved locally.
            </p>
            <button
              className="button secondary"
              disabled={restoring || fitImportProgress !== null}
              onClick={() => restoreInput.current?.click()}
            >
              <ArchiveRestore size={17} /> Restore backup
            </button>
            <input
              ref={restoreInput}
              hidden
              aria-label="Legacy JSON backup file"
              type="file"
              accept=".json"
              onChange={(event) =>
                event.target.files?.[0] && void restore(event.target.files[0])
              }
            />
          </div>
        </section>
      </div>
      <dialog
        ref={restoreDialog}
        className="modal"
        aria-labelledby="restore-title"
        onCancel={(event) => {
          event.preventDefault();
          cancelRestore();
        }}
      >
        <div className="modal-header">
          <h2 id="restore-title">Replace local data?</h2>
        </div>
        {restorePreview && (
          <div className="form-grid">
            <div className="full">
              <p>
                Legacy snapshot version {restorePreview.version}:{" "}
                {restorePreview.data.sessions.length} sessions,{" "}
                {restorePreview.data.activities.length} activities,{" "}
                {restorePreview.data.journals.length} journals,{" "}
                {restorePreview.data.shoes.length} shoes,{" "}
                {restorePreview.data.fitSources.length} FIT sources.
              </p>
              <p>
                Original prescriptions and revisions are included. This
                incomplete JSON backup cannot restore original FIT bytes or
                newer native records.
              </p>
              <p>
                Replacement removes the current records from the active plan. A
                verified local safety copy of the current snapshot will be
                retained before replacement.
              </p>
              {restorePreview.missingSources.length > 0 && (
                <div role="alert">
                  <p>
                    Restore blocked. These original FIT files are missing or
                    cannot be verified. Recover the preserved files using a
                    compatible application, then choose this backup again.
                  </p>
                  <ul>
                    {restorePreview.missingSources.map((name, index) => (
                      <li key={index}>{name}</li>
                    ))}
                  </ul>
                </div>
              )}
              <p role="status">
                {restoring
                  ? "Verifying the safety copy and saving…"
                  : "Current data has not been replaced."}
              </p>
              <div className="button-row">
                <button
                  className="button secondary"
                  autoFocus
                  disabled={restoring}
                  onClick={cancelRestore}
                >
                  Cancel
                </button>
                <button
                  className="button primary"
                  disabled={
                    restoring || restorePreview.missingSources.length > 0
                  }
                  onClick={() => void confirmRestore()}
                >
                  Replace local data
                </button>
              </div>
            </div>
          </div>
        )}
      </dialog>
      {preview && (
        <section className="panel import-preview">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Validation preview</p>
              <h2>
                {preview.validRows.length} valid rows · {preview.errors.length}{" "}
                issues
              </h2>
            </div>
          </div>
          {preview.errors.length > 0 && (
            <ul className="validation-list">
              {preview.errors.slice(0, 6).map((error) => (
                <li key={error.row}>
                  Row {error.row}: {error.messages.join(" ")}
                </li>
              ))}
            </ul>
          )}
          <p>
            {preview.duplicateDates.length
              ? `Multiple sessions share dates: ${preview.duplicateDates.join(", ")}. Review before importing.`
              : "No duplicate dates detected."}
          </p>
          <div className="button-row">
            <button
              className="button primary"
              disabled={preview.errors.length > 0}
              onClick={confirmPlanImport}
            >
              Confirm import
            </button>
            <button
              className="button secondary"
              onClick={() => setPreview(null)}
            >
              Cancel
            </button>
          </div>
        </section>
      )}
      <section className="panel preferences">
        <h2>Personal reference values</h2>
        <div className="preference-grid">
          <label>
            Distance unit
            <select
              value={data.settings.distanceUnit}
              onChange={(event) =>
                updateSettings({
                  distanceUnit: event.target.value as "mi" | "km",
                })
              }
            >
              <option value="mi">Miles</option>
              <option value="km">Kilometers</option>
            </select>
          </label>
          <label>
            Easy HR low
            <input
              type="number"
              value={data.settings.easyHrLow ?? ""}
              onChange={(event) =>
                updateSettings({
                  easyHrLow:
                    event.target.value === ""
                      ? undefined
                      : Number(event.target.value),
                })
              }
            />
          </label>
          <label>
            Easy HR high
            <input
              type="number"
              value={data.settings.easyHrHigh ?? ""}
              onChange={(event) =>
                updateSettings({
                  easyHrHigh:
                    event.target.value === ""
                      ? undefined
                      : Number(event.target.value),
                })
              }
            />
          </label>
          <label>
            Recovery HR high
            <input
              type="number"
              value={data.settings.recoveryHrHigh ?? ""}
              onChange={(event) =>
                updateSettings({
                  recoveryHrHigh:
                    event.target.value === ""
                      ? undefined
                      : Number(event.target.value),
                })
              }
            />
          </label>
        </div>
        <p>
          Reference values support display and deterministic review only. They
          do not create prescriptions.
        </p>
      </section>
      <button
        className="text-button danger-link"
        onClick={() => {
          if (window.confirm("Reset local demo data?")) {
            resetDemo();
            setMessage("Local demo data reset.");
          }
        }}
      >
        Reset local demo data
      </button>
    </div>
  );
}
