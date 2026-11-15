import { useEffect, useMemo, useRef, useState } from "react";
import {
  NativeDraftStore,
  nativeDraftsAvailable,
  PLAN_RECOVERY_LIMIT,
  PLAN_SOURCE_LIMIT,
  previewPlan,
  type DraftRecord,
  type DraftStore,
  type PlanPreview,
  type SavedDraft,
} from "../data/plan-draft-store";

export function PlanDraftPanel({
  store: supplied,
  onPresence,
}: {
  store?: DraftStore | null;
  onPresence?: (present: boolean | null) => void;
}) {
  const store = useMemo(
    () =>
      supplied === undefined
        ? nativeDraftsAvailable()
          ? new NativeDraftStore()
          : null
        : supplied,
    [supplied],
  );
  const [preview, setPreview] = useState<PlanPreview | null>(null);
  const [record, setRecord] = useState<DraftRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [exportMessage, setExportMessage] = useState("");
  const [exportFailed, setExportFailed] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const selectButton = useRef<HTMLButtonElement>(null);
  const recoveryFile = useRef<HTMLInputElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let active = true;
    if (!store) {
      onPresence?.(false);
      return;
    }
    setBusy(true);
    setStatus("Checking saved draft…");
    onPresence?.(null);
    store
      .inspect()
      .then((result) => {
        if (!active) return;
        setRecord(result.draft);
        onPresence?.(result.draft !== null);
        setStatus(
          result.draft
            ? "A saved draft is available to reopen."
            : "No draft saved.",
        );
      })
      .catch((value) => {
        if (active) {
          setError(
            value instanceof Error
              ? value.message
              : "Saved draft could not be checked.",
          );
          onPresence?.(null);
        }
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [store, onPresence]);

  async function run(
    message: string,
    operation: () => Promise<void>,
    returnFocus?: HTMLButtonElement | null,
  ) {
    if (busy) return;
    const focused =
      returnFocus ??
      (document.activeElement instanceof HTMLButtonElement
        ? document.activeElement
        : null);
    setBusy(true);
    setError("");
    setStatus(message);
    try {
      await operation();
    } catch (value) {
      setStatus("");
      setError(
        value instanceof Error
          ? value.message
          : "Draft operation failed. Retry is safe.",
      );
    } finally {
      setBusy(false);
      requestAnimationFrame(() => {
        if (focused?.isConnected && !focused.disabled) focused.focus();
      });
    }
  }
  function showSaved(saved: SavedDraft) {
    setPreview(saved.preview);
    setRecord(saved.record);
    onPresence?.(true);
    setStatus(
      "Draft saved and verified. The active training plan is unchanged.",
    );
  }
  async function selectPlan(selected: File) {
    setPreview(null);
    await run(
      "Validating plan…",
      async () => {
        if (selected.size > PLAN_SOURCE_LIMIT)
          throw new Error("Plan JSON exceeds the 8 MiB limit.");
        const next = await previewPlan(
          new Uint8Array(await selected.arrayBuffer()),
          selected.name,
        );
        setPreview(next);
        setStatus(
          next.validation.ok
            ? "Plan validated. Review the preview before saving."
            : "Plan has validation errors. No draft was saved.",
        );
      },
      selectButton.current,
    );
  }
  async function exportRecovery() {
    if (!store || busy) return;
    setExportFailed(false);
    setExportMessage("Choose where to save the recovery file…");
    await run("Opening Save As…", async () => {
      try {
        const result = await store.saveRecovery();
        setExportMessage(
          result.status === "saved"
            ? `Recovery saved to ${result.path}`
            : "Export cancelled. No recovery file was saved.",
        );
      } catch (value) {
        setExportFailed(true);
        setExportMessage(
          value instanceof Error
            ? value.message
            : "Recovery could not be saved and verified. Please try again.",
        );
      } finally {
        setStatus("");
      }
    });
  }
  const valid = preview?.validation.ok ? preview.validation.plan : null;
  return (
    <section
      className="panel import-preview"
      aria-labelledby="plan-draft-title"
    >
      <h2 id="plan-draft-title">JSON training-plan draft</h2>
      <p>
        Preview a training-plan JSON 1.1 file and save one read-only draft.
        Saving does not activate the plan or change scheduled workouts.
      </p>
      {!store && (
        <p>
          Browser preview only. Durable draft saving and recovery require the
          Windows app.
        </p>
      )}
      <div className="button-row">
        <button
          ref={selectButton}
          className="button secondary"
          disabled={busy}
          onClick={() => file.current?.click()}
        >
          Select JSON plan file
        </button>
        <input
          ref={file}
          hidden
          type="file"
          accept=".json,application/json"
          aria-label="JSON training-plan file"
          onChange={(event) => {
            const selected = event.target.files?.[0];
            event.target.value = "";
            if (selected) void selectPlan(selected);
          }}
        />
        <button
          ref={saveButton}
          className="button primary"
          disabled={busy || !store || !valid}
          onClick={() =>
            void run("Saving and verifying draft…", async () => {
              if (store && preview)
                showSaved(await store.save(preview, record));
            })
          }
        >
          Save as draft
        </button>
        <button
          className="button secondary"
          disabled={busy || !store || !record}
          onClick={() =>
            void run("Reopening and verifying saved draft…", async () => {
              const saved = await store!.read();
              if (!saved) throw new Error("No saved draft was found.");
              showSaved(saved);
              setStatus("Saved draft reopened and verified.");
            })
          }
        >
          Reopen saved draft
        </button>
      </div>
      <p role="status" aria-live="polite">
        {status}
      </p>
      {error && <p role="alert">{error}</p>}
      {record && (
        <p className="plan-draft-identity">
          Saved draft: {record.originalFileName} · revision {record.revision} ·{" "}
          {record.draftId}
        </p>
      )}
      {preview && (
        <div>
          <h3>Validation preview</h3>
          <p>
            {preview.fileName} · {preview.bytes.length.toLocaleString()} bytes
          </p>
          {valid && (
            <>
              <p>
                {valid.manifest.title} · {valid.manifest.planId} ·{" "}
                {valid.manifest.versionId}
              </p>
              <p>
                {valid.calendar.startDate} through {valid.calendar.endDate}
              </p>
              <details>
                <summary>Sessions and original coach instructions</summary>
                {valid.weeks.flatMap((week) =>
                  week.days.map((day) => (
                    <div key={day.id}>
                      <h4>
                        {day.date} · {day.kind}
                      </h4>
                      {day.coachText.map((text, index) => (
                        <pre className="plan-draft-source" key={index}>
                          {text}
                        </pre>
                      ))}
                      {day.sessions.map((session) => (
                        <div key={session.id}>
                          <p>
                            {session.title} · {session.completionClass} ·{" "}
                            {session.participation}
                          </p>
                          {session.coachText.map((text, index) => (
                            <pre className="plan-draft-source" key={index}>
                              {text}
                            </pre>
                          ))}
                        </div>
                      ))}
                    </div>
                  )),
                )}
              </details>
            </>
          )}
          {preview.validation.diagnostics.length > 0 ? (
            <ul className="validation-list">
              {preview.validation.diagnostics.map((item, index) => (
                <li key={index}>
                  {item.severity === "error" ? "Error" : "Warning"} ·{" "}
                  {item.path || "/"}: {item.message}
                </li>
              ))}
            </ul>
          ) : (
            <p>No validation warnings.</p>
          )}
          <details>
            <summary>Original JSON and raw instructions</summary>
            <pre className="plan-draft-source">
              {new TextDecoder("utf-8").decode(preview.bytes)}
            </pre>
          </details>
        </div>
      )}
      <div className="button-row plan-draft-recovery-actions">
        <div className="plan-draft-export">
          <button
            className="button secondary"
            disabled={busy || !store || !record}
            aria-describedby={
              exportMessage ? "plan-draft-export-result" : undefined
            }
            onClick={() => void exportRecovery()}
          >
            Export draft recovery
          </button>
          {exportMessage && (
            <p
              id="plan-draft-export-result"
              className="plan-draft-export-result"
              role={exportFailed ? "alert" : "status"}
            >
              {exportMessage}
            </p>
          )}
        </div>
        <button
          className="button secondary"
          disabled={busy || !store}
          onClick={() => recoveryFile.current?.click()}
        >
          Import draft recovery
        </button>
        <input
          ref={recoveryFile}
          hidden
          type="file"
          accept=".json,application/json"
          aria-label="Draft recovery file"
          onChange={(event) => {
            const selected = event.target.files?.[0];
            event.target.value = "";
            if (selected)
              void run("Validating and recovering draft…", async () => {
                if (selected.size > PLAN_RECOVERY_LIMIT)
                  throw new Error("Draft recovery exceeds the 16 MiB limit.");
                showSaved(await store!.recover(await selected.text()));
              });
          }}
        />
      </div>
      <p>
        Draft recovery includes this draft and its exact original JSON bytes
        only. Legacy JSON backups exclude native drafts and original plan/FIT
        files.
      </p>
    </section>
  );
}
