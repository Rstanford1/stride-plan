import { ChevronDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAppData } from "../data/app-context";
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
import { FitImportPanel } from "./FitImportPanel";

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
  onFitImported,
  initialMethod = "fit",
}: {
  session: PlannedSession;
  onSaved: () => void;
  onCancel?: () => void;
  onFitImported?: (batchId: string) => void;
  initialMethod?: "fit" | "manual";
}) {
  const { data, saveRunEntry } = useAppData();
  const existing = data.journals.find(
    (entry) => entry.sessionId === session.id,
  );
  const [method, setMethod] = useState<"fit" | "manual">(initialMethod);
  const [step, setStep] = useState<"entry" | "review">("entry");
  const [status, setStatus] = useState<"completed" | "modified" | "skipped">(
    session.status === "modified" || session.status === "skipped"
      ? session.status
      : "completed",
  );
  const [modification, setModification] = useState(
    session.replacementDescription ?? "",
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
    if (Object.keys(nextErrors).length === 0) setStep("review");
  }

  function confirm() {
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
    saveRunEntry(
      session.id,
      {
        status: draft.status,
        outcomeNote: draft.note.trim() || undefined,
        replacementDescription:
          draft.status === "modified" ? draft.modification.trim() : undefined,
      },
      entry,
    );
    onSaved();
  }

  const methodTabs = (
    <div className="entry-method-tabs" role="tablist" aria-label="Entry method">
      <button
        type="button"
        role="tab"
        aria-selected={method === "fit"}
        aria-controls="fit-entry-panel"
        className={method === "fit" ? "active" : ""}
        onClick={() => setMethod("fit")}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
            event.preventDefault();
            setMethod("manual");
          }
        }}
      >
        Import FIT files
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={method === "manual"}
        aria-controls="manual-entry-panel"
        className={method === "manual" ? "active" : ""}
        onClick={() => setMethod("manual")}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
            event.preventDefault();
            setMethod("fit");
          }
        }}
      >
        Enter manually
      </button>
    </div>
  );

  if (method === "fit") {
    return (
      <div className="run-entry-shell fit-run-entry-shell">
        {methodTabs}
        <FitImportPanel
          onCancel={onCancel}
          onContinue={(batchId) => onFitImported?.(batchId)}
        />
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
        </section>
        <div className="run-entry-footer">
          <span>Actual values will be stored separately from the plan</span>
          <div>
            <button
              type="button"
              className="button secondary"
              onClick={() => setStep("entry")}
            >
              Edit entry
            </button>
            <button type="button" className="button primary" onClick={confirm}>
              Confirm and save
            </button>
          </div>
        </div>
      </div>
    );
  }

  const skipped = status === "skipped";
  return (
    <form
      id="manual-entry-panel"
      role="tabpanel"
      className="run-entry-shell"
      onSubmit={review}
      noValidate
    >
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
            {session.plannedDistanceMiles.toFixed(1)} mi · {session.guidance}
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
            hint={`Planned: ${session.plannedDistanceMiles.toFixed(1)} mi`}
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
