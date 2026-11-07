import { useState } from "react";
import { validateSessionUpdate } from "../domain/rules";
import type {
  JournalEntry,
  PlannedSession,
  SessionStatus,
  SleepChoice,
  SorenessChoice,
} from "../domain/types";
import { useAppData } from "../data/app-context";

const rpeChoices = [
  [1, "Very light"],
  [2, "Light"],
  [3, "Comfortable"],
  [4, "Steady"],
  [5, "Moderate"],
  [6, "Challenging"],
  [7, "Hard"],
  [8, "Very hard"],
  [9, "Near-max"],
  [10, "Maximal"],
] as const;

export function RunEntryForm({
  session,
  onSaved,
}: {
  session: PlannedSession;
  onSaved: () => void;
}) {
  const { data, saveSession, saveJournal } = useAppData();
  const existing = data.journals.find(
    (entry) => entry.sessionId === session.id,
  );
  const [status, setStatus] = useState<SessionStatus>(
    session.status === "planned" || session.status === "moved"
      ? "completed"
      : session.status,
  );
  const [distance, setDistance] = useState(
    existing?.actualDistanceMiles?.toString() ?? "",
  );
  const [duration, setDuration] = useState(
    existing?.durationSeconds
      ? Math.round(existing.durationSeconds / 60).toString()
      : "",
  );
  const [hr, setHr] = useState(existing?.averageHr?.toString() ?? "");
  const [rpe, setRpe] = useState(existing?.rpe?.toString() ?? "");
  const [sleep, setSleep] = useState<SleepChoice | "">(existing?.sleep ?? "");
  const [soreness, setSoreness] = useState<SorenessChoice | "">(
    existing?.soreness ?? "",
  );
  const [location, setLocation] = useState(existing?.sorenessLocation ?? "");
  const [note, setNote] = useState(existing?.note ?? session.outcomeNote ?? "");
  const [replacement, setReplacement] = useState(
    session.replacementDescription ?? "",
  );
  const [errors, setErrors] = useState<string[]>([]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsedDistance = distance === "" ? undefined : Number(distance);
    const parsedDuration = duration === "" ? undefined : Number(duration) * 60;
    const parsedHr = hr === "" ? undefined : Number(hr);
    const parsedRpe = rpe === "" ? undefined : Number(rpe);
    const validation = validateSessionUpdate(session, {
      status,
      outcomeNote: note,
      replacementDescription: replacement || undefined,
    });
    if (
      parsedDistance !== undefined &&
      (parsedDistance < 0 || parsedDistance > 100)
    )
      validation.push("Actual distance must be between 0 and 100 miles.");
    if (parsedHr !== undefined && (parsedHr < 30 || parsedHr > 240))
      validation.push("Average HR must be between 30 and 240 bpm.");
    if (parsedRpe !== undefined && (parsedRpe < 1 || parsedRpe > 10))
      validation.push("RPE must be between 1 and 10.");
    if (validation.length) {
      setErrors(validation);
      return;
    }
    saveSession(
      session.id,
      {
        status,
        outcomeNote: note || undefined,
        replacementDescription: replacement || undefined,
      },
      "Daily review",
    );
    const entry: JournalEntry = {
      id: existing?.id ?? `journal-${session.id}`,
      sessionId: session.id,
      date: session.scheduledDate,
      actualDistanceMiles: parsedDistance,
      durationSeconds: parsedDuration,
      averageHr: parsedHr,
      rpe: parsedRpe,
      sleep: sleep || undefined,
      soreness: soreness || undefined,
      sorenessLocation:
        soreness && soreness !== "none" ? location || undefined : undefined,
      note: note || undefined,
      updatedAt: new Date().toISOString(),
    };
    saveJournal(entry);
    onSaved();
  }

  return (
    <form className="form-grid" onSubmit={submit}>
      {errors.length > 0 && (
        <div className="form-error" role="alert">
          <strong>Please fix:</strong>
          <ul>
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      )}
      <label className="full">
        Outcome
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value as SessionStatus)}
        >
          <option value="completed">Completed as planned</option>
          <option value="modified">Modified / partial / substituted</option>
          <option value="skipped">Skipped</option>
          <option value="moved">Moved</option>
        </select>
      </label>
      {status === "modified" && (
        <label className="full">
          What changed?
          <input
            value={replacement}
            onChange={(event) => setReplacement(event.target.value)}
            placeholder="Shortened to 3 mi, easy instead of workout…"
          />
        </label>
      )}
      <label>
        Actual distance (mi)
        <input
          inputMode="decimal"
          type="number"
          min="0"
          max="100"
          step="0.01"
          value={distance}
          onChange={(event) => setDistance(event.target.value)}
        />
      </label>
      <label>
        Duration (minutes)
        <input
          inputMode="numeric"
          type="number"
          min="0"
          max="1440"
          value={duration}
          onChange={(event) => setDuration(event.target.value)}
        />
      </label>
      <label>
        Average HR
        <input
          inputMode="numeric"
          type="number"
          min="30"
          max="240"
          value={hr}
          onChange={(event) => setHr(event.target.value)}
        />
      </label>
      <label>
        RPE
        <select value={rpe} onChange={(event) => setRpe(event.target.value)}>
          <option value="">Not recorded</option>
          {rpeChoices.map(([value, label]) => (
            <option key={value} value={value}>
              {value} · {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Sleep
        <select
          value={sleep}
          onChange={(event) => setSleep(event.target.value as SleepChoice | "")}
        >
          <option value="">Not recorded</option>
          <option value="a-lot">A lot</option>
          <option value="normal">Normal</option>
          <option value="a-little">A little</option>
          <option value="barely">Barely</option>
        </select>
      </label>
      <label>
        Soreness / pain
        <select
          value={soreness}
          onChange={(event) =>
            setSoreness(event.target.value as SorenessChoice | "")
          }
        >
          <option value="">Not recorded</option>
          <option value="none">None</option>
          <option value="mild">Mild</option>
          <option value="moderate">Moderate</option>
          <option value="severe">Severe</option>
        </select>
      </label>
      {soreness && soreness !== "none" && (
        <label className="full">
          Location (optional)
          <input
            value={location}
            onChange={(event) => setLocation(event.target.value)}
          />
        </label>
      )}
      <label className="full">
        Note
        <textarea
          rows={3}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Anything worth remembering"
        />
      </label>
      <div className="form-actions full">
        <button className="button primary" type="submit">
          Save review
        </button>
      </div>
    </form>
  );
}
