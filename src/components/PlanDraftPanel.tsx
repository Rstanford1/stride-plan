import { useEffect, useMemo, useRef, useState } from "react";
import {
  PlanConversionGuide,
  planImportTabs,
  type PlanImportTab,
} from "./PlanConversionGuide";
import { PlanValidationIssues } from "./PlanValidationIssues";
import { validationFeedback } from "../domain/plan-conversion";
import type { PlanDiagnostic } from "../domain/training-plan-contract";
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
  const [tab, setTab] = useState<PlanImportTab>("Start");
  const [failed, setFailed] = useState<{
    fileName: string;
    diagnostics: PlanDiagnostic[];
    message?: string;
  } | null>(null);
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
  const pendingFocus = useRef<HTMLElement | null>(null);
  const tabButtons = useRef<Array<HTMLButtonElement | null>>([]);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  function navigate(next: PlanImportTab) {
    setTab(next);
    pendingFocus.current = tabButtons.current[planImportTabs.indexOf(next)];
  }
  useEffect(() => {
    if (busy && pendingFocus.current?.getAttribute("role") !== "tab") return;
    const target = pendingFocus.current;
    pendingFocus.current = null;
    if (
      target?.isConnected &&
      !target.closest("[hidden]") &&
      !(target instanceof HTMLButtonElement && target.disabled)
    )
      target.focus();
  });
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
    returnFocus?: () => HTMLElement | null,
  ) {
    if (busy) return;
    const focused =
      document.activeElement instanceof HTMLButtonElement
        ? document.activeElement
        : null;
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
      pendingFocus.current = returnFocus ? returnFocus() : focused;
      setBusy(false);
    }
  }
  function showSaved(saved: SavedDraft) {
    setPreview(saved.preview);
    setTab("Review");
    setRecord(saved.record);
    onPresence?.(true);
    setStatus(
      "Draft saved and verified. The active training plan is unchanged.",
    );
  }
  async function selectPlan(selected: File) {
    if (busy) return;
    let openedReview = false;
    await run(
      "Validating plan…",
      async () => {
        try {
          if (!/\.json$/i.test(selected.name))
            throw new Error(
              "Unsupported plan format. Stride Plan accepts Training Plan JSON 1.1 files (.json). Use an external AI agent to convert supported coach documents before importing. PDF conversion guidance remains pending provenance review; JSON 1.1 does not directly support PDF source records. Do not mislabel a PDF or invent provenance.",
            );
          if (selected.size > PLAN_SOURCE_LIMIT)
            throw new Error("Plan JSON exceeds the 8 MiB limit.");
          const next = await previewPlan(
            new Uint8Array(await selected.arrayBuffer()),
            selected.name,
          );
          if (next.validation.ok) {
            setPreview(next);
            setFailed(null);
            setTab("Review");
            openedReview = true;
          } else {
            setFailed({
              fileName: selected.name,
              diagnostics: next.validation.diagnostics,
            });
            setTab("Import");
          }
          setStatus(
            next.validation.ok
              ? "Plan validated. Review the preview before saving."
              : "Plan has validation errors. No draft was saved.",
          );
        } catch (value) {
          setFailed({
            fileName: selected.name,
            diagnostics: [],
            message:
              value instanceof Error
                ? value.message
                : "The file could not be read. Please select it again.",
          });
          setTab("Import");
          setStatus("");
        }
      },
      () => (openedReview ? reviewHeading.current : selectButton.current),
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
      <h2 id="plan-draft-title">Import Training Plan</h2>
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
      <div
        role="tablist"
        aria-label="Import training plan"
        className="plan-import-tabs"
      >
        {planImportTabs.map((name, index) => (
          <button
            key={name}
            ref={(element) => {
              tabButtons.current[index] = element;
            }}
            type="button"
            role="tab"
            id={`plan-tab-${index}`}
            aria-selected={tab === name}
            aria-controls={`plan-panel-${index}`}
            tabIndex={tab === name ? 0 : -1}
            onClick={() => navigate(name)}
            onKeyDown={(event) => {
              const keys = ["ArrowRight", "ArrowLeft", "Home", "End"];
              if (!keys.includes(event.key)) return;
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? 4
                    : (index + (event.key === "ArrowRight" ? 1 : -1) + 5) % 5;
              navigate(planImportTabs[next]);
            }}
          >
            {name}
          </button>
        ))}
      </div>
      {planImportTabs.slice(0, 3).map((name, index) => (
        <div
          key={name}
          role="tabpanel"
          id={`plan-panel-${index}`}
          aria-labelledby={`plan-tab-${index}`}
          hidden={tab !== name}
        >
          <PlanConversionGuide
            tab={name}
            navigate={navigate}
            busy={busy}
            perform={(message, operation) => {
              void run(message, async () => {
                setStatus(await operation());
              });
            }}
          />
        </div>
      ))}
      <div
        role="tabpanel"
        id="plan-panel-3"
        aria-labelledby="plan-tab-3"
        hidden={tab !== "Import"}
      >
        <h3>Import Converted Plan</h3>
        <p>
          Select the JSON file your AI assistant produced. Stride Plan checks
          structure, dates, units and supported relationships without changing
          your active schedule.
        </p>
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
        </div>
        {failed && (
          <div role="alert" className="plan-import-failure">
            <h4>Could not import: {failed.fileName}</h4>
            <p>
              No draft was saved.{" "}
              {preview
                ? `Your valid preview of ${preview.fileName} is still available on Review.`
                : "Correct the file and try again."}
            </p>
            {failed.message && <p>{failed.message}</p>}
            {failed.diagnostics.length > 0 && (
              <>
                <PlanValidationIssues diagnostics={failed.diagnostics} />
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => {
                    void run("Copying validation feedback…", async () => {
                      await navigator.clipboard.writeText(
                        validationFeedback(failed.diagnostics),
                      );
                      setStatus(
                        "Validation feedback copied. Review it before sharing with your AI assistant.",
                      );
                    });
                  }}
                >
                  Copy Validation Feedback for AI
                </button>
              </>
            )}
          </div>
        )}
      </div>
      <div
        role="tabpanel"
        id="plan-panel-4"
        aria-labelledby="plan-tab-4"
        hidden={tab !== "Review"}
      >
        <h3 ref={reviewHeading} tabIndex={-1}>
          Review &amp; Save Draft
        </h3>
        <p>
          Compare the imported instructions against your coach’s original
          document. Validation cannot prove the conversion copied the source
          accurately.
        </p>
        {!preview && (
          <p>
            No validated file to review. Import a JSON file or reopen your saved
            draft.
          </p>
        )}
        {preview && (
          <p className="plan-draft-identity">
            <strong>Reviewing: {preview.fileName}</strong>
          </p>
        )}
        <div className="button-row">
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
        </div>
        <p>
          Saving a draft does not activate the plan or change your active
          schedule.
        </p>
        {preview && (
          <div>
            <h4>Validation preview</h4>
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
                <div className="plan-import-summary">
                  <div>
                    <strong>{valid.weeks.length}</strong>
                    <span>Weeks</span>
                  </div>
                  <div>
                    <strong>
                      {valid.weeks.reduce(
                        (total, week) => total + week.days.length,
                        0,
                      )}
                    </strong>
                    <span>Days</span>
                  </div>
                  <div>
                    <strong>
                      {
                        preview.validation.diagnostics.filter(
                          (issue) => issue.severity === "warning",
                        ).length
                      }
                    </strong>
                    <span>Warnings</span>
                  </div>
                </div>
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
              <>
                <p>
                  Warnings are nonblocking. Review them against the coach’s
                  original; this plan can be saved as a draft.
                </p>
                <PlanValidationIssues
                  diagnostics={preview.validation.diagnostics}
                />
              </>
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
      </div>
      <div className="button-row plan-draft-recovery-actions">
        <button
          className="button secondary"
          disabled={busy || !store || !record}
          onClick={() =>
            void run(
              "Reopening and verifying saved draft…",
              async () => {
                const saved = await store!.read();
                if (!saved) throw new Error("No saved draft was found.");
                showSaved(saved);
                setStatus("Saved draft reopened and verified.");
              },
              () => reviewHeading.current,
            )
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
              void run(
                "Validating and recovering draft…",
                async () => {
                  if (selected.size > PLAN_RECOVERY_LIMIT)
                    throw new Error("Draft recovery exceeds the 16 MiB limit.");
                  showSaved(await store!.recover(await selected.text()));
                },
                () => reviewHeading.current,
              );
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
