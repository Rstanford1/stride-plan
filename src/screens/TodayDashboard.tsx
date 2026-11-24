import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useAppData } from "../data/app-context";
import type { PlannedSession, JournalEntry } from "../domain/types";
import { formatDate, formatMiles, formatPrescription } from "../utils/format";
import { formatDuration } from "../domain/run-entry";
import { Modal } from "../components/Modal";
import { RunEntryWorkflow } from "../components/RunEntryWorkflow";
import { StatusBadge } from "../components/StatusBadge";
import type { TrainingPlan } from "../domain/training-plan-contract";
import type { ProjectedSession } from "../domain/active-plan-projection";
import {
  StructuredWorkout,
  StructuredWorkoutSummary,
} from "../components/StructuredWorkout";

export function isoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function addDays(value: string, amount: number): string {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return isoDate(date);
}
export function weekDates(value: string): string[] {
  const date = new Date(`${value}T12:00:00`);
  const start = addDays(value, date.getDay() === 0 ? -6 : 1 - date.getDay());
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

function WorkoutCard({
  session,
  journal,
  past,
  onLog,
  projected,
  historical = false,
  moveSession,
  sourcePlan,
}: {
  session: PlannedSession;
  journal?: JournalEntry;
  past: boolean;
  onLog: () => void;
  projected?: ProjectedSession;
  historical?: boolean;
  sourcePlan?: TrainingPlan | null;
  moveSession?: (id: string, date: string) => string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [moveDate, setMoveDate] = useState(session.scheduledDate);
  const [moveMessage, setMoveMessage] = useState("");
  const instructionRevision = session.revisions.find(
    (revision) => revision.field === "instructions",
  );
  const originalInstructions = projected?.source
    ? projected.source.coachText.join("\n")
    : instructionRevision
      ? typeof instructionRevision.from === "string"
        ? instructionRevision.from
        : undefined
      : session.instructions;
  if (session.kind === "rest")
    return (
      <section className="primary-panel f2-card">
        <h2>{historical ? "Historical rest day" : "Rest day"}</h2>
        {historical && <p>Historical</p>}
        <p>{originalInstructions || "Rest is planned for this day."}</p>
        {instructionRevision && session.instructions && (
          <p>Revised instructions: {session.instructions}</p>
        )}
      </section>
    );
  return (
    <section className="primary-panel f2-card">
      <div className="session-heading">
        <div>
          <span className="session-kind">
            {session.kind} · {session.flexible ? "Flexible" : "Core"}
            {projected?.source?.priorityClass === "supporting"
              ? " · Supporting"
              : projected?.source?.priorityClass === "priority"
                ? " · Priority"
                : ""}
            {projected?.source?.participation === "optional"
              ? " · Optional"
              : ""}
            {projected?.role === "double"
              ? " · Linked double"
              : projected?.role === "independent"
                ? " · Independent"
                : ""}
            {historical
              ? " · Historical"
              : projected && !projected.source
                ? " · Legacy"
                : ""}
          </span>
          <h2>{session.title}</h2>
        </div>
        <StatusBadge status={session.status} />
      </div>
      <p>
        <strong>
          {session.plannedDistanceMiles === null && !session.plannedDistance
            ? "Distance not prescribed"
            : `${formatPrescription(session.plannedDistanceMiles, session.plannedDistance)} planned`}
          {session.plannedDuration && (
            <> · {formatPrescription(null, session.plannedDuration)} duration</>
          )}
        </strong>
        {session.guidance && <> · {session.guidance}</>}
      </p>
      {projected?.source?.workout && (
        <StructuredWorkoutSummary
          workout={projected.source.workout}
          references={sourcePlan?.paceReferences}
        />
      )}
      {session.revisions.length > 0 && <p>Plan or outcome revised</p>}
      {journal && (
        <p>
          Recorded:{" "}
          {journal.actualDistanceMiles === undefined
            ? "Distance unavailable"
            : formatMiles(journal.actualDistanceMiles)}{" "}
          ·{" "}
          {journal.durationSeconds === undefined
            ? "Duration unavailable"
            : formatDuration(journal.durationSeconds)}
        </p>
      )}
      {!journal &&
        !historical &&
        past &&
        session.status !== "completed" &&
        session.status !== "modified" && (
          <p>No result recorded for this day.</p>
        )}
      <div className="button-row">
        <button
          type="button"
          className="button secondary"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Collapse" : "Expand"} {session.title}
        </button>
        {!historical && (
          <button type="button" className="button secondary" onClick={onLog}>
            {journal ? "Update entry" : "Log this run"}
          </button>
        )}
      </div>
      {expanded && (
        <div className="instruction">
          {projected?.source?.workout && (
            <StructuredWorkout
              workout={projected.source.workout}
              references={sourcePlan?.paceReferences}
            />
          )}
          {projected?.sourcePlanId && (
            <p>
              Source plan: {projected.sourcePlanId} · version{" "}
              {projected.sourceVersionId}
            </p>
          )}
          {projected?.source &&
            sourcePlan?.progressions
              .filter(
                (item) => item.workoutSessionId === projected.sourceSessionId,
              )
              .map((item) => (
                <div key={item.id}>
                  <strong>Progression ({item.scope})</strong>
                  {item.coachText.map((text, i) => (
                    <p key={i}>{text}</p>
                  ))}
                  {item.parameters?.paceIncrement && (
                    <p>
                      Pace increment: {item.parameters.paceIncrement.value}{" "}
                      {item.parameters.paceIncrement.unit}
                    </p>
                  )}
                  {item.parameters?.quantityIncrement && (
                    <p>
                      Quantity increment:{" "}
                      {item.parameters.quantityIncrement.value}{" "}
                      {item.parameters.quantityIncrement.unit}
                    </p>
                  )}
                </div>
              ))}
          {projected?.source && sourcePlan && (
            <p>
              Plan sources:{" "}
              {sourcePlan.sources
                .map((source) =>
                  source.kind === "authored"
                    ? "Authored source"
                    : source.fileName,
                )
                .join(", ")}
            </p>
          )}
          {projected?.role === "double" && (
            <p>
              Linked to primary session:{" "}
              {sourcePlan?.weeks
                .flatMap((week) => week.days)
                .flatMap((day) => day.sessions)
                .find((item) => item.id === projected.primarySessionId)
                ?.title ?? "Unavailable"}
            </p>
          )}
          {session.originalDate !== session.scheduledDate && (
            <p>
              Scheduled: {formatDate(session.scheduledDate)} · Original date:{" "}
              {formatDate(session.originalDate)}
            </p>
          )}
          {projected?.originalDuration && (
            <p>
              Original duration:{" "}
              {formatPrescription(null, projected.originalDuration)}
            </p>
          )}
          <p>
            Original instructions: {originalInstructions || "Not available."}
          </p>
          {instructionRevision && (
            <p>
              Revised instructions: {session.instructions || "Not available."}
            </p>
          )}
          <p>
            Original prescription:{" "}
            {formatPrescription(
              session.originalDistanceMiles,
              session.originalDistance,
            )}{" "}
            on {formatDate(session.originalDate)}
          </p>
          {projected?.source && moveSession && !historical && (
            <div>
              <label>
                Move {session.title}{" "}
                <input
                  type="date"
                  value={moveDate}
                  onChange={(event) => setMoveDate(event.target.value)}
                />
              </label>{" "}
              <button
                type="button"
                className="button secondary"
                disabled={!moveDate || moveDate === session.scheduledDate}
                onClick={() => {
                  const error = moveSession(session.id, moveDate);
                  setMoveMessage(error ?? "Move requested.");
                }}
              >
                Move session
              </button>
              {moveMessage && <p role="status">{moveMessage}</p>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export function TodayDashboard({
  openPlan,
}: {
  openActivityReview: () => void;
  openPlan: () => void;
}) {
  const { data, activeProjection, moveSession } = useAppData();
  const sourceDays = activeProjection?.days ?? [];
  const today = isoDate(new Date());
  const [selectedDate, setSelectedDate] = useState(today);
  const [displayedWeek, setDisplayedWeek] = useState(today);
  const [editing, setEditing] = useState<PlannedSession | null>(null);
  const dates = weekDates(displayedWeek);
  const projectedSessions = activeProjection
    ? [
        ...sourceDays.flatMap((day) => day.sessions),
        ...activeProjection.legacySessions,
      ]
    : [];
  const projectedById = new Map(
    projectedSessions.map((item) => [item.id, item]),
  );
  const visibleSessions = activeProjection
    ? projectedSessions.flatMap((item) => {
        const session = data.sessions.find(
          (candidate) => candidate.id === item.id,
        );
        return session ? [session] : [];
      })
    : data.sessions.filter((item) => !item.retiredAt);
  const selectedSessions = visibleSessions.filter(
    (item) => item.scheduledDate === selectedDate,
  );
  const sessions: PlannedSession[] = [];
  const placed = new Set<string>();
  for (const item of selectedSessions) {
    const projected = projectedById.get(item.id);
    if (
      projected?.role === "double" &&
      selectedSessions.some((candidate) => {
        const parent = projectedById.get(candidate.id);
        return (
          parent?.sourceSessionId === projected.primarySessionId &&
          parent.sourceDayId === projected.sourceDayId &&
          parent.sourcePlanId === projected.sourcePlanId &&
          parent.sourceVersionId === projected.sourceVersionId
        );
      })
    )
      continue;
    if (!placed.has(item.id)) {
      sessions.push(item);
      placed.add(item.id);
    }
    if (projected?.role === "main")
      for (const candidate of selectedSessions) {
        const linked = projectedById.get(candidate.id);
        if (
          linked?.role === "double" &&
          linked.primarySessionId === projected.sourceSessionId &&
          linked.sourceDayId === projected.sourceDayId &&
          !placed.has(candidate.id)
        ) {
          sessions.push(candidate);
          placed.add(candidate.id);
        }
      }
  }
  const historical = (activeProjection?.historicalSessions ?? [])
    .filter((item) => item.scheduledDate === selectedDate)
    .flatMap((item) => {
      const session = data.sessions.find(
        (candidate) => candidate.id === item.id,
      );
      return session ? [{ session, projected: item }] : [];
    });
  const sourceDay = sourceDays.find((day) => day.originalDate === selectedDate);
  const next = visibleSessions
    .filter(
      (item) =>
        !item.retiredAt &&
        item.scheduledDate > selectedDate &&
        item.kind !== "rest",
    )
    .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate))[0];
  function selectDate(date: string) {
    setSelectedDate(date);
    setDisplayedWeek(date);
  }
  function resetToday() {
    const current = isoDate(new Date());
    selectDate(current);
  }
  return (
    <div className="screen today-screen">
      <header className="page-header">
        <div>
          <p className="eyebrow">
            {formatDate(selectedDate, {
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </p>
          <h1>
            {selectedDate === today
              ? "Today"
              : formatDate(selectedDate, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
          </h1>
        </div>
        <button type="button" className="button secondary" onClick={resetToday}>
          Today
        </button>
      </header>
      <div className="f2-week-controls">
        <button
          type="button"
          className="icon-button"
          aria-label="Previous week"
          onClick={() => setDisplayedWeek(addDays(displayedWeek, -7))}
        >
          <ChevronLeft size={19} />
        </button>
        <span>
          {formatDate(dates[0])} – {formatDate(dates[6], { year: "numeric" })}
        </span>
        <button
          type="button"
          className="icon-button"
          aria-label="Next week"
          onClick={() => setDisplayedWeek(addDays(displayedWeek, 7))}
        >
          <ChevronRight size={19} />
        </button>
      </div>
      <nav className="week-date-picker f2-date-picker" aria-label="Week dates">
        {dates.map((date) => {
          const daySessions = visibleSessions.filter(
            (item) => !item.retiredAt && item.scheduledDate === date,
          );
          const recorded = daySessions.some((session) =>
            data.journals.some((entry) => entry.sessionId === session.id),
          );
          return (
            <button
              key={date}
              type="button"
              aria-label={`${formatDate(date, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}${date === today ? ", today" : ""}`}
              aria-current={date === selectedDate ? "date" : undefined}
              className={`${date === selectedDate ? "selected" : ""} ${date === today ? "literal-today" : ""}`}
              onClick={() => selectDate(date)}
            >
              <span>
                {new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
                  weekday: "short",
                })}
              </span>
              <strong>{new Date(`${date}T12:00:00`).getDate()}</strong>
              <small>
                {daySessions.length === 0
                  ? sourceDays.find((day) => day.originalDate === date)
                      ?.kind === "rest"
                    ? "Rest"
                    : sourceDays.find((day) => day.originalDate === date)
                          ?.kind === "unspecified"
                      ? "Unspecified"
                      : "—"
                  : daySessions.every((s) => s.kind === "rest")
                    ? "Rest"
                    : recorded
                      ? "Recorded"
                      : daySessions.length > 1
                        ? `${daySessions.length} sessions`
                        : formatPrescription(
                            daySessions[0].plannedDistanceMiles,
                            daySessions[0].plannedDistance,
                          )}
              </small>
            </button>
          );
        })}
      </nav>
      <div className="f2-cards">
        {sessions.length > 0 && sourceDay && sourceDay.kind !== "training" && (
          <p className="f2-source-day-note">
            The source classifies this date as{" "}
            {sourceDay.kind === "rest" ? "Rest" : "unspecified"}; the session
            shown here was scheduled onto it.
          </p>
        )}
        {sessions.length ? (
          sessions.map((session) => (
            <WorkoutCard
              key={session.id}
              session={session}
              journal={data.journals.find(
                (entry) => entry.sessionId === session.id,
              )}
              past={selectedDate < today}
              onLog={() => setEditing(session)}
              projected={projectedById.get(session.id)}
              moveSession={moveSession}
              sourcePlan={activeProjection?.sourcePlan}
            />
          ))
        ) : sourceDay?.kind === "rest" ? (
          <section className="primary-panel f2-card">
            <h2>Rest day</h2>
            {sourceDay.coachText.length ? (
              sourceDay.coachText.map((line, index) => (
                <p key={index}>{line}</p>
              ))
            ) : (
              <p>The active plan prescribes Rest for this date.</p>
            )}
          </section>
        ) : sourceDay?.kind === "unspecified" ? (
          <section className="primary-panel f2-card">
            <h2>Unspecified day</h2>
            {sourceDay.coachText.length ? (
              sourceDay.coachText.map((line, index) => (
                <p key={index}>{line}</p>
              ))
            ) : (
              <p>The source does not classify this date as training or Rest.</p>
            )}
          </section>
        ) : (
          <section className="primary-panel f2-card">
            <h2>No planned session</h2>
            <p>No prescription is available for this date.</p>
            <button
              type="button"
              className="button secondary"
              onClick={openPlan}
            >
              View plan
            </button>
          </section>
        )}
      </div>
      {historical.length > 0 && (
        <section aria-label="Historical sessions">
          <h2>Historical sessions</h2>
          {historical.map(({ session, projected }) => (
            <WorkoutCard
              key={session.id}
              session={session}
              projected={projected}
              historical
              past={selectedDate < today}
              journal={data.journals.find(
                (entry) => entry.sessionId === session.id,
              )}
              onLog={() => {}}
            />
          ))}
        </section>
      )}
      {next && (
        <p className="f2-next">
          Next scheduled · {formatDate(next.scheduledDate)} · {next.title}{" "}
          <button
            type="button"
            className="text-button"
            onClick={() => selectDate(next.scheduledDate)}
          >
            View session
          </button>
        </p>
      )}
      {editing && (
        <Modal
          title={`${formatDate(editing.scheduledDate)} · ${editing.title}`}
          onClose={() => setEditing(null)}
        >
          <RunEntryWorkflow
            session={editing}
            initialMethod="manual"
            onSaved={() => setEditing(null)}
            onCancel={() => setEditing(null)}
          />
        </Modal>
      )}
    </div>
  );
}
