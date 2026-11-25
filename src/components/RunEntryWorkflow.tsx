import { ChevronDown, FileUp } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAppData } from "../data/app-context";
import { fitEvidence, manualEvidence } from "../data/logical-activity-evidence";
import {
  legacyCandidates,
  reviewLegacyCandidates,
} from "../data/legacy-activity-review";
import { journalForSession } from "../domain/logical-activity-accounting";
import type {
  ConfirmationCommand,
  CorrectionCommand,
  RecordedValues,
} from "../domain/logical-activity";
import { formatPrescription } from "../utils/format";
import {
  durationFromPace,
  formatDuration,
  parseDurationInput,
  parsePaceInput,
  proposeDurationInterpretation,
  validateRunEntry,
  type RunEntryDraft,
} from "../domain/run-entry";
import type {
  JournalEntry,
  PaceUnit,
  PlannedSession,
  SleepChoice,
  SleepEntryMode,
  SorenessChoice,
  TimeEntryMode,
} from "../domain/types";
import { AutoGrowTextarea, FormField, SegmentedControl } from "./FormControls";

const rpeChoices = [
  [2, "Very easy"],
  [4, "Easy"],
  [6, "Moderate"],
  [8, "Hard"],
  [10, "Maximal"],
] as const;

function numberValue(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function paceText(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;
}

function sleepMinutes(value: string): number | undefined {
  const parts = value.trim().split(":").map(Number);
  if (parts.length === 1 && Number.isFinite(parts[0])) return parts[0] * 60;
  if (parts.length === 2 && parts.every(Number.isFinite) && parts[1] < 60)
    return parts[0] * 60 + parts[1];
  return undefined;
}

export function RunEntryWorkflow({
  session,
  onSaved,
  onCancel,
  initialMethod = "fit",
}: {
  session: PlannedSession;
  onSaved: () => void;
  onCancel?: () => void;
  initialMethod?: "fit" | "manual";
}) {
  const { data, saveRunEntry, confirmLogicalActivity, correctLogicalActivity } =
    useAppData();
  const deferred = data.logicalActivities?.pending?.find(
    (item) =>
      item.command.plannedSessionId === session.id &&
      item.command.sources.some((source) => source.kind === "manual"),
  );
  const existing =
    deferred?.command.recorded.manualEntry ??
    journalForSession(data, session.id);
  const existingLogical = data.logicalActivities?.activities.find(
    (activity) => {
      const version = activity.versions.at(-1);
      return (
        version?.plannedSessionId === session.id &&
        version.sources.some(
          (source) =>
            source.kind === "manual" && source.sourceId === existing?.id,
        )
      );
    },
  );
  const [method, setMethod] = useState<"fit" | "manual">(initialMethod);
  const [files, setFiles] = useState<string[]>([]);
  const [step, setStep] = useState<"entry" | "review">("entry");
  const [status, setStatus] = useState<"completed" | "modified" | "skipped">(
    session.status === "modified" || session.status === "skipped"
      ? session.status
      : "completed",
  );
  const [modification, setModification] = useState(
    existingLogical?.versions.at(-1)?.recorded.replacementDescription ??
      session.replacementDescription ??
      "",
  );
  const [distance, setDistance] = useState(
    existing?.actualDistanceMiles?.toString() ?? "",
  );
  const [hr, setHr] = useState(existing?.averageHr?.toString() ?? "");
  const [timeMode, setTimeMode] = useState<TimeEntryMode>(
    existing?.timeEntryMode ?? "duration",
  );
  const [durationInput, setDurationInput] = useState(
    existing?.durationSeconds !== undefined
      ? formatDuration(existing.durationSeconds)
      : "",
  );
  const [paceInput, setPaceInput] = useState(
    existing?.paceSecondsPerUnit !== undefined
      ? paceText(existing.paceSecondsPerUnit)
      : "",
  );
  const [paceUnit, setPaceUnit] = useState<PaceUnit>(
    existing?.paceUnit ?? "min-mi",
  );
  const [interpretationId, setInterpretationId] = useState("");
  const [rpe, setRpe] = useState(existing?.rpe?.toString() ?? "");
  const [soreness, setSoreness] = useState<SorenessChoice>(
    existing?.soreness ?? "none",
  );
  const [location, setLocation] = useState(existing?.sorenessLocation ?? "");
  const [sleepMode, setSleepMode] = useState<SleepEntryMode>(
    existing?.sleepEntryMode ?? "subjective",
  );
  const [sleep, setSleep] = useState<SleepChoice>(
    existing?.sleep ?? "adequate",
  );
  const [sleepScore, setSleepScore] = useState(
    existing?.sleepScore?.toString() ?? "",
  );
  const [sleepDuration, setSleepDuration] = useState(
    existing?.sleepDurationMinutes !== undefined
      ? `${Math.floor(existing.sleepDurationMinutes / 60)}:${String(existing.sleepDurationMinutes % 60).padStart(2, "0")}`
      : "",
  );
  const defaultShoe =
    data.shoes.find((shoe) => shoe.isDefault && !shoe.retired) ??
    data.shoes.find((shoe) => !shoe.retired);
  const [shoeId, setShoeId] = useState(
    existing?.shoeId ?? defaultShoe?.id ?? "",
  );
  const [note, setNote] = useState(existing?.note ?? session.outcomeNote ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [retryOnly, setRetryOnly] = useState(false);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [decisions, setDecisions] = useState<
    Record<string, "merge" | "keep-both" | "review-later" | "">
  >({});
  const [shoeAttribution, setShoeAttribution] = useState<
    Record<string, "included" | "not-included" | "">
  >({});
  const [mergeRecordedChoice, setMergeRecordedChoice] = useState<
    "" | "keep-existing" | "use-incoming"
  >("");
  const pending = useRef<ConfirmationCommand | CorrectionCommand | null>(null);

  const parsedDistance = numberValue(distance);
  const interpretations = useMemo(
    () => parseDurationInput(durationInput),
    [durationInput],
  );
  useEffect(() => {
    if (interpretations.some((item) => item.id === interpretationId)) return;
    setInterpretationId(
      proposeDurationInterpretation(interpretations, parsedDistance)?.id ?? "",
    );
  }, [interpretations, interpretationId, parsedDistance]);

  const selectedInterpretation =
    interpretations.find((item) => item.id === interpretationId) ??
    interpretations[0];
  const paceSeconds = parsePaceInput(paceInput);
  const durationSeconds =
    timeMode === "duration"
      ? selectedInterpretation?.seconds
      : parsedDistance !== undefined && paceSeconds !== undefined
        ? durationFromPace(parsedDistance, paceSeconds, paceUnit)
        : undefined;
  const draft: RunEntryDraft = {
    status,
    modification,
    distanceMiles: status === "skipped" ? undefined : parsedDistance,
    averageHr: numberValue(hr),
    timeEntryMode: timeMode,
    durationSeconds: status === "skipped" ? undefined : durationSeconds,
    paceSecondsPerUnit: timeMode === "pace" ? paceSeconds : undefined,
    paceUnit,
    rpe: numberValue(rpe),
    soreness,
    sorenessLocation: location,
    sleepEntryMode: sleepMode,
    sleep: sleepMode === "subjective" ? sleep : undefined,
    sleepScore: sleepMode === "garmin" ? numberValue(sleepScore) : undefined,
    sleepDurationMinutes:
      sleepMode === "garmin" ? sleepMinutes(sleepDuration) : undefined,
    shoeId: status === "skipped" ? undefined : shoeId || undefined,
    note,
  };

  function review(event: React.FormEvent) {
    event.preventDefault();
    const nextErrors = validateRunEntry(session, draft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length === 0) {
      pending.current = null;
      setCandidates([]);
      setDecisions({});
      setShoeAttribution({});
      setMergeRecordedChoice("");
      setSaveError("");
      setRetryOnly(false);
      setStep("review");
    }
  }

  async function confirm() {
    if (saving) return;
    const now = new Date().toISOString();
    const entry: JournalEntry = {
      id: existing?.id ?? `journal-${session.id}`,
      sessionId: session.id,
      date: session.scheduledDate,
      actualDistanceMiles: draft.distanceMiles,
      durationSeconds: draft.durationSeconds,
      timeEntryMode: draft.timeEntryMode,
      paceSecondsPerUnit: draft.paceSecondsPerUnit,
      paceUnit: draft.timeEntryMode === "pace" ? draft.paceUnit : undefined,
      averageHr: draft.averageHr,
      rpe: draft.rpe,
      sleep: draft.sleep,
      sleepEntryMode: draft.sleepEntryMode,
      sleepScore: draft.sleepScore,
      sleepDurationMinutes: draft.sleepDurationMinutes,
      soreness: draft.soreness,
      sorenessLocation:
        draft.soreness === "none"
          ? undefined
          : draft.sorenessLocation.trim() || undefined,
      shoeId: draft.shoeId,
      note: draft.note.trim() || undefined,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    if (draft.status === "skipped") {
      if (existingLogical) {
        setSaveError(
          "A confirmed activity cannot be replaced with a skip. Review the existing activity first.",
        );
        return;
      }
      saveRunEntry(
        session.id,
        { status: draft.status, outcomeNote: draft.note.trim() || undefined },
        entry,
      );
      onSaved();
      return;
    }
    const recorded: RecordedValues = {
      distanceMiles: draft.distanceMiles ?? null,
      durationSeconds: draft.durationSeconds ?? null,
      averageHr: draft.averageHr ?? null,
      outcome: draft.status,
      note: draft.note.trim() || null,
      ...(draft.status === "modified"
        ? { replacementDescription: draft.modification.trim() }
        : {}),
      shoeAllocations:
        draft.shoeId && draft.distanceMiles !== undefined
          ? [{ shoeId: draft.shoeId, distanceMiles: draft.distanceMiles }]
          : [],
      manualEntry: entry,
    };
    if (!pending.current) {
      pending.current = existingLogical
        ? {
            commandId: crypto.randomUUID(),
            activityId: existingLogical.id,
            expectedRevision: existingLogical.versions.at(-1)!.revision,
            assignedDate: entry.date,
            plannedSessionId: session.id,
            recorded,
            reason: "Manual run correction",
          }
        : deferred
          ? {
              ...structuredClone(deferred.command),
              recorded,
              assignedDate: entry.date,
              plannedSessionId: session.id,
              duplicateDecisions: [],
              legacyDuplicateDecisions: [],
            }
          : {
              commandId: crypto.randomUUID(),
              activityId: crypto.randomUUID(),
              eventId: crypto.randomUUID(),
              expectedRevision: null,
              assignedDate: entry.date,
              plannedSessionId: session.id,
              sources: [
                manualEvidence(
                  data.journals.find((item) => item.id === entry.id) ?? entry,
                ),
              ],
              recorded,
              duplicateDecisions: [],
            };
    }
    let request = pending.current;
    if ("eventId" in request && candidates.length && !retryOnly) {
      if (candidates.some((id) => !decisions[id])) {
        setSaveError("Choose a decision for each possible duplicate.");
        return;
      }
      const legacyIds = candidates.filter((id) => id.startsWith("legacy:"));
      const logicalIds = candidates.filter((id) => !id.startsWith("legacy:"));
      const merges = logicalIds.filter((id) => decisions[id] === "merge");
      if (merges.length > 1) {
        setSaveError("Review one merge at a time.");
        return;
      }
      if (merges.length) {
        const target = data.logicalActivities?.activities.find(
          (activity) => activity.id === merges[0],
        );
        const version = target?.versions.at(-1);
        if (
          !version ||
          version.assignedDate !== request.assignedDate ||
          version.plannedSessionId !== request.plannedSessionId
        ) {
          setSaveError(
            "The selected activity has a different date or session. Review it before merging.",
          );
          return;
        }
        if (!mergeRecordedChoice) {
          setSaveError(
            "Choose which recorded values the combined activity should use.",
          );
          return;
        }
        request = {
          ...request,
          expectedRevision: version.revision,
          mergeRecordedChoice,
        };
      }
      if (legacyIds.length) {
        const sources = [...request.sources];
        for (const candidate of legacyIds) {
          if (decisions[candidate] !== "merge") continue;
          const key = candidate.slice("legacy:".length);
          if (key.startsWith("journal:")) {
            const id = key.slice("journal:".length);
            const journal = data.journals.find((item) => item.id === id);
            if (!journal) {
              setSaveError("The original journal is unavailable.");
              return;
            }
            let attribution:
              { shoeId: string; distanceMiles: number } | null | undefined;
            if (journal.shoeId) {
              const choice = shoeAttribution[candidate];
              if (!choice) {
                setSaveError(
                  "Choose whether the older run is already included in its shoe total.",
                );
                return;
              }
              if (choice === "included") {
                if (journal.actualDistanceMiles === undefined) {
                  setSaveError(
                    "The older run has no recorded distance. Its shoe attribution needs review before merging.",
                  );
                  return;
                }
                attribution = {
                  shoeId: journal.shoeId,
                  distanceMiles: journal.actualDistanceMiles,
                };
              } else attribution = null;
            }
            const source = manualEvidence(journal, attribution);
            const index = sources.findIndex(
              (item) => item.kind === "manual" && item.sourceId === id,
            );
            if (index < 0) sources.push(source);
            else sources[index] = source;
          } else if (key.startsWith("activity:")) {
            const id = key.slice("activity:".length);
            try {
              if (
                !sources.some(
                  (source) => source.kind === "fit" && source.activityId === id,
                )
              )
                sources.push(fitEvidence(data, id));
            } catch {
              setSaveError(
                "The original FIT source must be preserved and verified before these records can be merged.",
              );
              return;
            }
          }
        }
        request = {
          ...request,
          sources,
          legacyDuplicateDecisions: legacyIds.map((id) => ({
            candidateId: id.slice("legacy:".length),
            decision: decisions[id] as "merge" | "keep-both" | "review-later",
          })),
        };
      }
      if (logicalIds.length)
        request = {
          ...request,
          duplicateDecisions: logicalIds.map((activityId) => ({
            activityId,
            decision: decisions[activityId] as
              "merge" | "keep-both" | "review-later",
          })),
        };
      pending.current = request;
    }
    if ("eventId" in request && candidates.length && !retryOnly) {
      try {
        reviewLegacyCandidates(data, request);
      } catch (error) {
        setSaveError(
          error instanceof Error
            ? error.message
            : "The duplicate decisions are invalid.",
        );
        return;
      }
    }
    setSaving(true);
    setSaveError("");
    try {
      const result =
        "eventId" in request
          ? await confirmLogicalActivity(request)
          : await correctLogicalActivity(request);
      if (result.status === "review-required") {
        if (
          result.candidates.some((candidate) =>
            candidate.startsWith("pending:"),
          )
        ) {
          setSaveError(
            "An earlier unconfirmed review may describe the same run. Resolve that review before confirming this entry.",
          );
          return;
        }
        setCandidates(result.candidates);
        return;
      }
      if (result.status === "review-later") {
        setSaveError(
          "Saved for review later. No activity was confirmed or credited.",
        );
        return;
      }
      if (result.status === "exact-duplicate") {
        setSaveError("This source is already part of a confirmed activity.");
        return;
      }
      onSaved();
    } catch (error) {
      setRetryOnly(true);
      setSaveError(
        error instanceof Error
          ? error.message
          : "The run could not be saved. Retry the same confirmation.",
      );
    } finally {
      setSaving(false);
    }
  }

  const methodTabs = (
    <div className="entry-method-tabs" role="tablist" aria-label="Entry method">
      <button
        type="button"
        role="tab"
        aria-selected={method === "fit"}
        className={method === "fit" ? "active" : ""}
        onClick={() => setMethod("fit")}
      >
        Import FIT files
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={method === "manual"}
        className={method === "manual" ? "active" : ""}
        onClick={() => setMethod("manual")}
      >
        Enter manually
      </button>
    </div>
  );

  if (method === "fit") {
    return (
      <div className="run-entry-shell">
        {methodTabs}
        <div className="fit-entry-placeholder">
          <FileUp size={25} aria-hidden="true" />
          <label className="button secondary file-choice">
            Choose FIT files
            <input
              type="file"
              accept=".fit"
              multiple
              onChange={(event) =>
                setFiles(
                  Array.from(event.target.files ?? []).map((file) => file.name),
                )
              }
            />
          </label>
          <p>
            {files.length
              ? `${files.length} file${files.length === 1 ? "" : "s"} selected. Decoding and source-preserving review are completed in the next slice.`
              : "Warm-up, workout, cooldown, strides, and doubles can be selected together."}
          </p>
          {files.length > 0 && (
            <ul>
              {files.map((file) => (
                <li key={file}>{file}</li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className="text-button"
            onClick={() => setMethod("manual")}
          >
            Enter this run manually instead
          </button>
        </div>
        <div className="run-entry-footer">
          <span>FIT import is the default entry method</span>
          <button type="button" className="button secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (step === "review") {
    const selectedShoe = data.shoes.find((shoe) => shoe.id === draft.shoeId);
    return (
      <div className="run-entry-shell">
        {methodTabs}
        <section className="entry-review" aria-labelledby="entry-review-title">
          <div>
            <p className="eyebrow">Review before saving</p>
            <h3 id="entry-review-title">Confirm the run result</h3>
            <p>The original prescription remains unchanged.</p>
          </div>
          <dl>
            <div>
              <dt>Outcome</dt>
              <dd>{draft.status}</dd>
            </div>
            <div>
              <dt>Distance</dt>
              <dd>
                {draft.distanceMiles === undefined
                  ? "Not recorded"
                  : `${draft.distanceMiles.toFixed(2)} mi`}
              </dd>
            </div>
            <div>
              <dt>Duration</dt>
              <dd>
                {draft.durationSeconds === undefined
                  ? "Not recorded"
                  : formatDuration(draft.durationSeconds)}
              </dd>
            </div>
            <div>
              <dt>Average HR</dt>
              <dd>
                {draft.averageHr === undefined
                  ? "Not recorded"
                  : `${draft.averageHr} bpm`}
              </dd>
            </div>
            <div>
              <dt>RPE</dt>
              <dd>
                {draft.rpe === undefined ? "Not recorded" : `${draft.rpe}/10`}
              </dd>
            </div>
            <div>
              <dt>Shoes</dt>
              <dd>{selectedShoe?.name ?? "Not recorded"}</dd>
            </div>
            <div>
              <dt>Soreness</dt>
              <dd>
                {draft.soreness === "none"
                  ? "None"
                  : `${draft.soreness}${draft.sorenessLocation ? ` · ${draft.sorenessLocation}` : ""}`}
              </dd>
            </div>
            <div>
              <dt>Sleep</dt>
              <dd>
                {draft.sleepEntryMode === "subjective"
                  ? draft.sleep
                  : `Score ${draft.sleepScore ?? "—"} · ${draft.sleepDurationMinutes ?? "—"} min`}
              </dd>
            </div>
          </dl>
          {candidates.length > 0 && (
            <fieldset disabled={saving || retryOnly}>
              <legend>Review possible duplicate activities</legend>
              {candidates.map((id) => {
                const legacy =
                  "eventId" in (pending.current ?? {})
                    ? legacyCandidates(
                        data,
                        pending.current as ConfirmationCommand,
                      ).find((item) => `legacy:${item.id}` === id)
                    : undefined;
                const candidate = data.logicalActivities?.activities.find(
                  (item) => item.id === id,
                );
                const version = candidate?.versions.at(-1);
                const legacyJournal = legacy?.id.startsWith("journal:")
                  ? data.journals.find(
                      (entry) =>
                        entry.id === legacy.id.slice("journal:".length),
                    )
                  : undefined;
                return (
                  <div key={id}>
                    <label>
                      {legacy?.label ?? "Activity"} on{" "}
                      {legacy?.date ?? version?.assignedDate ?? "unknown date"}
                      {!legacy && (
                        <>
                          {" "}
                          · {version?.recorded.distanceMiles ?? "unknown"} mi
                        </>
                      )}
                      <select
                        value={decisions[id] ?? ""}
                        onChange={(event) =>
                          setDecisions((current) => ({
                            ...current,
                            [id]: event.target.value as
                              "merge" | "keep-both" | "review-later" | "",
                          }))
                        }
                      >
                        <option value="">Choose a decision</option>
                        <option value="merge">Merge</option>
                        <option value="keep-both">Keep both</option>
                        <option value="review-later">Review later</option>
                      </select>
                    </label>
                    {!legacy && decisions[id] === "merge" && (
                      <label>
                        Which recorded values should the combined activity use?
                        <select
                          value={mergeRecordedChoice}
                          onChange={(event) =>
                            setMergeRecordedChoice(
                              event.target.value as
                                "" | "keep-existing" | "use-incoming",
                            )
                          }
                        >
                          <option value="">Choose which values to keep</option>
                          <option value="keep-existing">
                            Keep the existing activity values
                          </option>
                          <option value="use-incoming">
                            Use the values entered here
                          </option>
                        </select>
                        <small>
                          The other source and the earlier values remain in the
                          history.
                        </small>
                      </label>
                    )}
                    {legacyJournal?.shoeId && decisions[id] === "merge" && (
                      <label>
                        Was this older run already included in its shoe mileage?
                        <select
                          value={shoeAttribution[id] ?? ""}
                          onChange={(event) =>
                            setShoeAttribution((current) => ({
                              ...current,
                              [id]: event.target.value as
                                "included" | "not-included" | "",
                            }))
                          }
                        >
                          <option value="">Choose an answer</option>
                          <option value="included">Already included</option>
                          <option value="not-included">Not included</option>
                        </select>
                      </label>
                    )}
                  </div>
                );
              })}
            </fieldset>
          )}
          {saveError && <p role="alert">{saveError}</p>}
        </section>
        <div className="run-entry-footer">
          <span>Actual values will be stored separately from the plan</span>
          <div>
            <button
              type="button"
              className="button secondary"
              disabled={saving || retryOnly}
              onClick={() => setStep("entry")}
            >
              Edit entry
            </button>
            <button
              type="button"
              className="button primary"
              disabled={saving}
              onClick={() => void confirm()}
            >
              {saving
                ? "Saving…"
                : retryOnly
                  ? "Retry confirmation"
                  : "Confirm and save"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const skipped = status === "skipped";
  return (
    <form className="run-entry-shell" onSubmit={review} noValidate>
      {methodTabs}
      <div className="run-entry-body">
        <section className="outcome-row" aria-labelledby="outcome-title">
          <h3 id="outcome-title">What happened?</h3>
          <SegmentedControl
            label="Run outcome"
            value={status}
            onChange={setStatus}
            options={[
              { value: "completed", label: "Completed" },
              { value: "modified", label: "Modified" },
              { value: "skipped", label: "Skipped" },
            ]}
          />
        </section>
        {errors.status && (
          <p className="field-error standalone" role="alert">
            {errors.status}
          </p>
        )}
        <div className="original-prescription">
          <span>Original prescription remains unchanged</span>
          <strong>
            {formatPrescription(
              session.plannedDistanceMiles,
              session.plannedDistance,
            )}{" "}
            · {session.guidance}
          </strong>
        </div>
        {status === "modified" && (
          <FormField
            label="What changed?"
            error={errors.modification}
            className="full-width"
          >
            <input
              value={modification}
              onChange={(event) => setModification(event.target.value)}
              placeholder="Shortened, substituted, or reduced intensity"
            />
          </FormField>
        )}
        <div
          className={`objective-fields ${skipped ? "fields-disabled" : ""}`}
          aria-disabled={skipped}
        >
          <FormField
            label="Actual distance"
            hint={`Planned: ${formatPrescription(session.plannedDistanceMiles, session.plannedDistance)}`}
            error={errors.distanceMiles}
          >
            <div className="unit-input">
              <input
                type="number"
                inputMode="decimal"
                min="0"
                max="100"
                step="0.01"
                value={distance}
                onChange={(event) => setDistance(event.target.value)}
                disabled={skipped}
              />
              <span>mi</span>
            </div>
          </FormField>
          <FormField
            label="Average heart rate"
            optional
            hint={`Target: ${session.guidance}`}
            error={errors.averageHr}
          >
            <div className="unit-input">
              <input
                type="number"
                inputMode="numeric"
                min="30"
                max="240"
                value={hr}
                onChange={(event) => setHr(event.target.value)}
                disabled={skipped}
              />
              <span>bpm</span>
            </div>
          </FormField>
          <FormField label="Shoes" hint="Mileage updates after confirmation">
            <select
              value={shoeId}
              onChange={(event) => setShoeId(event.target.value)}
              disabled={skipped}
            >
              <option value="">Not recorded</option>
              {data.shoes
                .filter((shoe) => !shoe.retired)
                .map((shoe) => (
                  <option key={shoe.id} value={shoe.id}>
                    {shoe.name} — {shoe.mileageMiles.toFixed(1)} mi
                  </option>
                ))}
            </select>
          </FormField>
        </div>
        <section
          className={`fixed-entry-module time-module ${skipped ? "fields-disabled" : ""}`}
          aria-labelledby="time-mode-title"
        >
          <div className="module-control">
            <h3 id="time-mode-title">Record time as</h3>
            <SegmentedControl
              label="Time entry mode"
              value={timeMode}
              onChange={setTimeMode}
              options={[
                { value: "duration", label: "Duration" },
                { value: "pace", label: "Average pace" },
              ]}
            />
          </div>
          <div className="module-fields">
            {timeMode === "duration" ? (
              <>
                <FormField label="Duration" error={errors.time}>
                  <div className="unit-input">
                    <input
                      value={durationInput}
                      onChange={(event) => setDurationInput(event.target.value)}
                      placeholder="1:31:42"
                      disabled={skipped}
                    />
                    <span>time</span>
                  </div>
                </FormField>
                <FormField label="Interpreted as">
                  <div
                    className={`interpretation-select ${interpretations.length <= 1 ? "locked" : ""}`}
                  >
                    <select
                      value={selectedInterpretation?.id ?? ""}
                      onChange={(event) =>
                        setInterpretationId(event.target.value)
                      }
                      disabled={skipped || interpretations.length <= 1}
                      aria-label="Duration interpretation"
                    >
                      {interpretations.length ? (
                        interpretations.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.label}
                          </option>
                        ))
                      ) : (
                        <option value="">Enter a valid duration</option>
                      )}
                    </select>
                    {interpretations.length > 1 && (
                      <ChevronDown size={15} aria-hidden="true" />
                    )}
                  </div>
                </FormField>
              </>
            ) : (
              <>
                <FormField label="Average pace" error={errors.time}>
                  <input
                    value={paceInput}
                    onChange={(event) => setPaceInput(event.target.value)}
                    placeholder="9:21"
                    disabled={skipped}
                  />
                </FormField>
                <FormField label="Pace unit">
                  <select
                    value={paceUnit}
                    onChange={(event) =>
                      setPaceUnit(event.target.value as PaceUnit)
                    }
                    disabled={skipped}
                  >
                    <option value="min-mi">min/mi</option>
                    <option value="min-km">min/km</option>
                  </select>
                </FormField>
              </>
            )}
          </div>
        </section>
        <section className="rpe-section" aria-labelledby="rpe-title">
          <div>
            <h3 id="rpe-title">Perceived effort</h3>
            <span>Applied to the main session</span>
          </div>
          <div className="rpe-options">
            {rpeChoices.map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={rpe === String(value) ? "active" : ""}
                aria-pressed={rpe === String(value)}
                onClick={() => setRpe(String(value))}
              >
                <span>{label}</span>
                <small>{value}</small>
              </button>
            ))}
          </div>
          {errors.rpe && <span className="field-error">{errors.rpe}</span>}
        </section>
        <section
          className="fixed-entry-module soreness-module"
          aria-labelledby="soreness-title"
        >
          <div className="module-copy">
            <h3 id="soreness-title">Soreness or pain</h3>
            <span>Optional review prompt</span>
          </div>
          <FormField label="Severity">
            <select
              value={soreness}
              onChange={(event) =>
                setSoreness(event.target.value as SorenessChoice)
              }
            >
              <option value="none">None</option>
              <option value="mild">Mild</option>
              <option value="moderate">Moderate</option>
              <option value="severe">Severe</option>
            </select>
          </FormField>
          <FormField
            label="Location"
            error={errors.sorenessLocation}
            className={soreness === "none" ? "concealed-field" : ""}
          >
            <input
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              placeholder="Right hamstring"
              disabled={soreness === "none"}
            />
          </FormField>
        </section>
        <section
          className="fixed-entry-module sleep-module"
          aria-labelledby="sleep-title"
        >
          <div className="module-control">
            <h3 id="sleep-title">Record sleep as</h3>
            <SegmentedControl
              label="Sleep entry mode"
              value={sleepMode}
              onChange={setSleepMode}
              options={[
                { value: "subjective", label: "Subjective" },
                { value: "garmin", label: "Garmin data" },
              ]}
            />
          </div>
          <div className="module-fields">
            {sleepMode === "subjective" ? (
              <FormField label="Sleep quality" error={errors.sleep}>
                <select
                  value={sleep}
                  onChange={(event) =>
                    setSleep(event.target.value as SleepChoice)
                  }
                >
                  <option value="restorative">Restorative</option>
                  <option value="adequate">Adequate</option>
                  <option value="limited">Limited</option>
                  <option value="severely-limited">Severely limited</option>
                </select>
              </FormField>
            ) : (
              <>
                <FormField label="Sleep score" error={errors.sleepScore}>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={sleepScore}
                    onChange={(event) => setSleepScore(event.target.value)}
                    placeholder="0–100"
                  />
                </FormField>
                <FormField label="Sleep duration" error={errors.sleepDuration}>
                  <input
                    value={sleepDuration}
                    onChange={(event) => setSleepDuration(event.target.value)}
                    placeholder="7:24"
                  />
                </FormField>
              </>
            )}
          </div>
        </section>
        <FormField label="Note" optional className="note-field">
          <AutoGrowTextarea
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Anything useful to remember about the run"
          />
        </FormField>
      </div>
      <div className="run-entry-footer">
        <span>Actual values are stored separately from the plan</span>
        <div>
          <button type="button" className="button secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="button primary">
            Review entry
          </button>
        </div>
      </div>
    </form>
  );
}
