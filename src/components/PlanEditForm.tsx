import { useState } from "react";
import { useAppData } from "../data/app-context";
import type { PlannedSession, SessionKind } from "../domain/types";

export function PlanEditForm({
  week,
  session,
  onSaved,
}: {
  week: number;
  session?: PlannedSession;
  onSaved: () => void;
}) {
  const { addSession, saveSession } = useAppData();
  const [date, setDate] = useState(session?.scheduledDate ?? "2026-11-02");
  const [title, setTitle] = useState(session?.title ?? "Easy");
  const [kind, setKind] = useState<SessionKind>(session?.kind ?? "easy");
  const [distance, setDistance] = useState(
    session?.plannedDistanceMiles.toString() ?? "0",
  );
  const [guidance, setGuidance] = useState(session?.guidance ?? "");
  const [instructions, setInstructions] = useState(session?.instructions ?? "");
  const [phase, setPhase] = useState(session?.phase ?? "Foundation");
  const [flexible, setFlexible] = useState(session?.flexible ?? false);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const miles = Number(distance);
    if (session) {
      saveSession(
        session.id,
        {
          scheduledDate: date,
          title,
          kind,
          plannedDistanceMiles: miles,
          guidance,
          instructions,
          phase,
          flexible,
        },
        "Plan edit",
      );
    } else {
      const id = `manual-${crypto.randomUUID()}`;
      addSession({
        id,
        sourceKey: id,
        week,
        originalDate: date,
        scheduledDate: date,
        originalDistanceMiles: miles,
        plannedDistanceMiles: miles,
        title,
        kind,
        guidance,
        instructions,
        flexible,
        phase,
        status: "planned",
        revisions: [],
      });
    }
    onSaved();
  }

  return (
    <form className="form-grid" onSubmit={submit}>
      <label>
        Date
        <input
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          required
        />
      </label>
      <label>
        Session type
        <select
          value={kind}
          onChange={(event) => setKind(event.target.value as SessionKind)}
        >
          <option value="rest">Rest</option>
          <option value="easy">Easy</option>
          <option value="recovery">Recovery</option>
          <option value="workout">Workout</option>
          <option value="long">Long run</option>
        </select>
      </label>
      <label className="full">
        Title
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
        />
      </label>
      <label>
        Planned distance (mi)
        <input
          type="number"
          min="0"
          max="100"
          step="0.1"
          value={distance}
          onChange={(event) => setDistance(event.target.value)}
          required
        />
      </label>
      <label>
        Phase
        <input
          value={phase}
          onChange={(event) => setPhase(event.target.value)}
        />
      </label>
      <label className="full">
        Pace / HR guidance
        <input
          value={guidance}
          onChange={(event) => setGuidance(event.target.value)}
        />
      </label>
      <label className="full">
        Instructions
        <textarea
          rows={3}
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
        />
      </label>
      <label className="checkbox-label full">
        <input
          type="checkbox"
          checked={flexible}
          onChange={(event) => setFlexible(event.target.checked)}
        />
        Flexible session (excluded from core completion)
      </label>
      <div className="form-actions full">
        <button className="button primary" type="submit">
          {session ? "Save plan changes" : "Add session"}
        </button>
      </div>
    </form>
  );
}
