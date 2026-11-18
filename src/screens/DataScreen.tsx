import {
  ArchiveRestore,
  Database,
  Download,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { useRef, useState } from "react";
import { useAppData } from "../data/app-context";
import type { AppData } from "../domain/types";
import { serializeBackup } from "../domain/backup";
import { FitFileParserDecoder } from "../domain/fit-decoder";
import { runFitImportBatch } from "../data/fit-import-controller";
import { createFitSourceStore } from "../data/fit-source-store";
import { inspectLegacyRestore, type RestorePreview } from "../data/restore";
import { GarminIntegration } from "../components/GarminIntegration";
import { PlanDraftPanel } from "../components/PlanDraftPanel";
import { nativeDraftsAvailable } from "../data/plan-draft-store";

export function DataScreen() {
  const {
    data,
    beginFitImportBatch,
    resetDemo,
    updateSettings,
    restoreBackup,
  } = useAppData();
  const [message, setMessage] = useState("");
  const [nativeDraftPresent, setNativeDraftPresent] = useState<boolean | null>(
    nativeDraftsAvailable() ? null : false,
  );
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
      restoreDialog.current?.close();
      setRestorePreview(null);
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
    const pendingBatch = beginFitImportBatch();
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
      existingSources: pendingBatch.existingSources,
      decoder: new FitFileParserDecoder(),
      sourceStore: createFitSourceStore(),
      createdAt: new Date().toISOString(),
      signal: controller.signal,
      onProgress: (completed, total) =>
        setFitImportProgress({ completed, total }),
    });
    const committed = pendingBatch.commitFitImportBatch(result);
    if (!committed) {
      setMessage(
        "FIT import was not added because local data was replaced or is unavailable. Choose the files again to import into the current data.",
      );
      fitImportController.current = null;
      setFitImportProgress(null);
      return;
    }
    const counts = committed.sourceResults.reduce<Record<string, number>>(
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
          <p>
            Local imports, backups, preferences, and optional Garmin access.
          </p>
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
      <PlanDraftPanel onPresence={setNativeDraftPresent} />
      <div className="settings-grid">
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
              This is an incomplete backup: it does not contain native plan
              drafts, original plan JSON, or original FIT bytes.
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
              disabled={
                restoring ||
                fitImportProgress !== null ||
                nativeDraftPresent !== false
              }
              onClick={() => restoreInput.current?.click()}
            >
              <ArchiveRestore size={17} /> Restore backup
            </button>
            {nativeDraftPresent !== false && (
              <p>
                Legacy restore is unavailable while a native draft exists or
                draft storage cannot be verified. Export draft recovery
                separately.
              </p>
            )}
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
      <GarminIntegration />
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
        disabled={nativeDraftPresent !== false}
        onClick={() => {
          if (window.confirm("Reset local demo data?")) {
            void resetDemo()
              .then(() => setMessage("Local demo data reset and saved."))
              .catch((error: unknown) =>
                setMessage(
                  error instanceof Error
                    ? error.message
                    : "Reset failed. Current data was retained.",
                ),
              );
          }
        }}
      >
        Reset local demo data
      </button>
    </div>
  );
}
