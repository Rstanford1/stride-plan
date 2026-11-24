import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useAppData } from "../data/app-context";
import type { PlannedSession, JournalEntry } from "../domain/types";
import { formatDate, formatMiles, formatPrescription } from "../utils/format";
import { formatDuration } from "../domain/run-entry";
import { Modal } from "../components/Modal";
import { RunEntryWorkflow } from "../components/RunEntryWorkflow";
import { StatusBadge } from "../components/StatusBadge";
import type { ProjectedSession } from "../domain/active-plan-projection";

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
}: {
  session: PlannedSession;
  journal?: JournalEntry;
  past: boolean;
  onLog: () => void;
  projected?: ProjectedSession;
}) {
  const [expanded, setExpanded] = useState(false);
  const instructionRevision = session.revisions.find(
    (revision) => revision.field === "instructions",
  );
  const originalInstructions = instructionRevision
    ? typeof instructionRevision.from === "string"
      ? instructionRevision.from
      : undefined
    : session.instructions;
  if (session.kind === "rest")
    return (
      <section className="primary-panel f2-card">
        <h2>Rest day</h2>
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
          </span>
          <h2>{session.title}</h2>
        </div>
        <StatusBadge status={session.status} />
      </div>
      <p>
        <strong>
          {formatPrescription(
            session.plannedDistanceMiles,
            session.plannedDistance,
          )}{" "}
          planned
        </strong>
        {session.guidance && <> · {session.guidance}</>}
      </p>
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
        <button type="button" className="button secondary" onClick={onLog}>
          {journal ? "Update entry" : "Log this run"}
        </button>
      </div>
      {expanded && (
        <div className="instruction">
          {projected?.source?.coachText.map((line, index) => (
            <p key={index}>{line}</p>
          ))}
          {projected?.source?.workout && (
            <p>
              Workout structure: {projected.source.workout.structureStatus} ·{" "}
              {projected.source.workout.blocks.length} blocks
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
  const { data, activeProjection } = useAppData();
  const sourceDays = activeProjection?.days ?? [];
  const today = isoDate(new Date());
  const [selectedDate, setSelectedDate] = useState(today);
  const [displayedWeek, setDisplayedWeek] = useState(today);
  const [editing, setEditing] = useState<PlannedSession | null>(null);
  const dates = weekDates(displayedWeek);
  const sessions = data.sessions.filter(
    (item) => !item.retiredAt && item.scheduledDate === selectedDate,
  );
  const sourceDay = sourceDays.find((day) => day.originalDate === selectedDate);
  const next = data.sessions
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
          const daySessions = data.sessions.filter(
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
                  ? data.days?.find(
                      (day) => !day.retiredAt && day.originalDate === date,
                    )?.kind === "rest"
                    ? "Rest"
                    : data.days?.find(
                          (day) => !day.retiredAt && day.originalDate === date,
                        )?.kind === "unspecified"
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
              projected={sourceDays
                .flatMap((day) => day.sessions)
                .find((item) => item.id === session.id)}
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
