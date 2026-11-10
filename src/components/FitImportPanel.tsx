import { AlertTriangle, Check, FileUp, LoaderCircle, X } from "lucide-react";
import { useRef, useState } from "react";
import { useAppData, type FitImportFileSummary } from "../data/app-context";
import type { ActivityRole } from "../domain/types";
import { formatDuration, formatMiles } from "../utils/format";

const METERS_PER_MILE = 1609.344;

const roleOptions: Array<{ value: ActivityRole; label: string }> = [
  { value: "primary-easy", label: "Primary easy / recovery" },
  { value: "primary-long", label: "Primary long run" },
  { value: "primary-workout", label: "Primary workout" },
  { value: "warm-up", label: "Warm-up" },
  { value: "cooldown", label: "Cooldown" },
  { value: "strides", label: "Strides" },
  { value: "supporting-recovery", label: "Supporting recovery" },
  { value: "unrelated", label: "Unrelated" },
];

interface DisplayRow extends FitImportFileSummary {
  included: boolean;
  role?: ActivityRole;
}

function statusLabel(status: DisplayRow["status"]): string {
  if (status === "ready") return "Ready";
  if (status === "possible-duplicate") return "Possible duplicate";
  if (status === "exact-duplicate") return "Exact duplicate";
  if (status === "canceled") return "Canceled";
  return "Failed";
}

function startTime(value?: string): string {
  if (!value) return "Time unavailable";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function FitImportPanel({
  onContinue,
  onCancel,
}: {
  onContinue: (batchId: string) => void;
  onCancel?: () => void;
}) {
  const {
    importFitFiles,
    prepareActivityReview,
    fitImportProgress,
    cancelFitImport,
  } = useAppData();
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<DisplayRow[]>([]);
  const [queuedNames, setQueuedNames] = useState<string[]>([]);
  const [batchId, setBatchId] = useState("");
  const [message, setMessage] = useState("");
  const [dragging, setDragging] = useState(false);

  async function decode(files: File[]) {
    if (!files.length) return;
    setQueuedNames(files.map((file) => file.name));
    setMessage(`Reading ${files.length} FIT file(s)…`);
    try {
      const result = await importFitFiles(files, batchId || undefined);
      setBatchId(result.batchId);
      setRows((current) => [
        ...current,
        ...result.files.map((file) => ({
          ...file,
          included:
            file.status === "ready" || file.status === "possible-duplicate",
          role: file.proposedRole,
        })),
      ]);
      setMessage(result.summary);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "The FIT import failed.",
      );
    } finally {
      setQueuedNames([]);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function continueToReview() {
    if (!batchId) return;
    const includedRows = rows.filter(
      (row) =>
        row.included &&
        (row.status === "ready" || row.status === "possible-duplicate"),
    );
    const activityIds = includedRows.flatMap((row) => row.activityIds);
    const roles = Object.fromEntries(
      includedRows.flatMap((row) =>
        row.role
          ? row.activityIds.map((activityId) => [activityId, row.role!])
          : [],
      ),
    );
    prepareActivityReview(batchId, activityIds, roles);
    onContinue(batchId);
  }

  const readyCount = rows.filter(
    (row) =>
      row.included &&
      (row.status === "ready" || row.status === "possible-duplicate"),
  ).length;
  const exactDuplicates = rows.filter(
    (row) => row.status === "exact-duplicate",
  ).length;
  const possibleDuplicates = rows.filter(
    (row) => row.status === "possible-duplicate",
  ).length;

  return (
    <section id="fit-entry-panel" className="fit-import-panel" role="tabpanel">
      <input
        ref={inputRef}
        className="sr-only"
        aria-label="FIT files"
        type="file"
        accept=".fit"
        multiple
        disabled={Boolean(fitImportProgress)}
        onChange={(event) =>
          event.target.files && void decode(Array.from(event.target.files))
        }
      />
      <div
        className={`fit-drop-target${dragging ? " dragging" : ""}`}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void decode(
            Array.from(event.dataTransfer.files).filter((file) =>
              file.name.toLowerCase().endsWith(".fit"),
            ),
          );
        }}
      >
        <FileUp size={24} aria-hidden="true" />
        <button
          type="button"
          className="text-button"
          autoFocus
          onClick={() => inputRef.current?.click()}
        >
          Choose FIT files
        </button>
        <span>or drop several files here</span>
        <small>
          Warm-up, workout, cooldown, strides, and doubles can be reviewed
          together.
        </small>
      </div>

      {(rows.length > 0 || queuedNames.length > 0) && (
        <section
          className="selected-fit-files"
          aria-labelledby="fit-files-title"
        >
          <div className="selected-fit-files-heading">
            <div>
              <h3 id="fit-files-title">
                {rows.length + queuedNames.length} files selected
              </h3>
              <p>Source files and source laps remain read-only.</p>
            </div>
            <button
              type="button"
              className="text-button"
              disabled={Boolean(fitImportProgress)}
              onClick={() => inputRef.current?.click()}
            >
              + Add files
            </button>
          </div>

          <div className="fit-file-list" aria-live="polite">
            {rows.map((row, index) => (
              <article
                className={`fit-file-row status-${row.status}`}
                key={`${row.sourceId}:${index}`}
              >
                <span
                  className="fit-file-status"
                  aria-label={statusLabel(row.status)}
                >
                  {row.status === "ready" ? (
                    <Check size={15} />
                  ) : row.status === "possible-duplicate" ||
                    row.status === "failed" ? (
                    <AlertTriangle size={15} />
                  ) : (
                    <span aria-hidden="true">×</span>
                  )}
                </span>
                <div className="fit-file-facts">
                  <strong>{row.fileName}</strong>
                  <span>
                    {statusLabel(row.status)}
                    {row.startTime &&
                      ` · ${startTime(row.startTime)} · ${formatMiles(
                        (row.distanceMeters ?? 0) / METERS_PER_MILE,
                      )} · ${formatDuration(row.durationSeconds)}`}
                    {row.lapCount ? ` · ${row.lapCount} laps` : ""}
                  </span>
                  {row.errorMessage && <small>{row.errorMessage}</small>}
                </div>
                {row.activityIds.length > 0 && row.included ? (
                  <label>
                    Proposed role
                    <select
                      value={row.role ?? ""}
                      onChange={(event) =>
                        setRows((current) =>
                          current.map((item, rowIndex) =>
                            rowIndex === index
                              ? {
                                  ...item,
                                  role: event.target.value as ActivityRole,
                                }
                              : item,
                          ),
                        )
                      }
                    >
                      <option value="">Choose role</option>
                      {roleOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <span className="fit-file-excluded">
                    {row.status === "exact-duplicate"
                      ? "Already imported · excluded"
                      : "Not included"}
                  </span>
                )}
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove ${row.fileName}`}
                  onClick={() =>
                    setRows((current) =>
                      current.filter((_, rowIndex) => rowIndex !== index),
                    )
                  }
                >
                  <X size={15} />
                </button>
              </article>
            ))}
            {queuedNames.map((name, index) => (
              <article
                className="fit-file-row decoding"
                key={`${name}:${index}`}
              >
                <span className="fit-file-status" aria-label="Decoding">
                  <LoaderCircle size={15} className="spin" />
                </span>
                <div className="fit-file-facts">
                  <strong>{name}</strong>
                  <span>
                    {fitImportProgress && index === fitImportProgress.completed
                      ? "Decoding"
                      : "Queued"}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {rows.length > 0 && (
        <>
          <div
            className={`duplicate-summary${exactDuplicates || possibleDuplicates ? " warning" : ""}`}
          >
            <span>Duplicate check complete</span>
            <strong>
              {exactDuplicates || possibleDuplicates
                ? `${exactDuplicates} exact · ${possibleDuplicates} possible`
                : "No previously imported activities found"}
            </strong>
          </div>
          <div className="review-handoff-preview">
            <strong>Next: Activity Review</strong>
            <span>
              Confirm matching, primary activity, roles, laps, logical segments,
              overlays, and shoes before weekly totals change.
            </span>
          </div>
        </>
      )}

      <footer className="run-entry-footer fit-import-footer">
        <span>
          {fitImportProgress
            ? message
            : message || "FIT import is the default entry method"}
        </span>
        <div className="button-row">
          {fitImportProgress && (
            <button
              type="button"
              className="text-button"
              onClick={cancelFitImport}
            >
              Stop after current file
            </button>
          )}
          <button type="button" className="button secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="button primary"
            disabled={Boolean(fitImportProgress) || readyCount === 0}
            onClick={continueToReview}
          >
            Continue to Activity Review
          </button>
        </div>
      </footer>
    </section>
  );
}
