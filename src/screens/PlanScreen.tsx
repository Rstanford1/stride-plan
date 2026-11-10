import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  ClipboardCheck,
  GripVertical,
  Pencil,
  Plus,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Modal } from "../components/Modal";
import { PlanEditForm } from "../components/PlanEditForm";
import { RunEntryWorkflow } from "../components/RunEntryWorkflow";
import { StatusBadge } from "../components/StatusBadge";
import { useAppData } from "../data/app-context";
import {
  actualMilesForSession,
  calculateWeeklyMetrics,
} from "../domain/metrics";
import type { PlannedSession } from "../domain/types";
import { formatDate, formatMiles } from "../utils/format";

function dateLabel(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function currentPlanWeek(sessions: PlannedSession[]) {
  const today = new Date();
  const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const exact = sessions.find(
    (session) => session.scheduledDate === localToday,
  );
  if (exact) return exact.week;
  const upcoming = [...sessions]
    .sort((left, right) =>
      left.scheduledDate.localeCompare(right.scheduledDate),
    )
    .find((session) => session.scheduledDate > localToday);
  return upcoming?.week ?? Math.max(...sessions.map((session) => session.week));
}

export function PlanScreen({
  onFitImported,
}: {
  onFitImported?: (batchId: string) => void;
}) {
  const { data, saveSession } = useAppData();
  const maxWeek = Math.max(...data.sessions.map((session) => session.week));
  const actualCurrentWeek = currentPlanWeek(data.sessions);
  const [week, setWeek] = useState(actualCurrentWeek);
  const [rearranging, setRearranging] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string>();
  const [editing, setEditing] = useState<PlannedSession | null>(null);
  const [creating, setCreating] = useState(false);
  const [reviewing, setReviewing] = useState<PlannedSession | null>(null);
  const sessions = data.sessions
    .filter((session) => session.week === week)
    .sort((left, right) =>
      left.scheduledDate.localeCompare(right.scheduledDate),
    );
  const metrics = useMemo(
    () =>
      calculateWeeklyMetrics(
        week,
        data.sessions,
        data.activities,
        data.journals,
      ),
    [data, week],
  );
  const dateSlots = [
    ...new Set(
      data.sessions
        .filter((session) => session.week === week)
        .map((session) => session.originalDate),
    ),
  ].sort();
  const today = new Date();
  const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const state =
    week < actualCurrentWeek
      ? "Completed"
      : week > actualCurrentWeek
        ? "Upcoming"
        : "Current";

  function swapDayGroups(targetDate: string) {
    if (!selectedDay) {
      setSelectedDay(targetDate);
      return;
    }
    if (selectedDay === targetDate) {
      setSelectedDay(undefined);
      return;
    }
    const firstGroup = sessions.filter(
      (session) => session.scheduledDate === selectedDay,
    );
    const secondGroup = sessions.filter(
      (session) => session.scheduledDate === targetDate,
    );
    for (const session of firstGroup)
      saveSession(
        session.id,
        { scheduledDate: targetDate },
        `Rearranged ${dateLabel(selectedDay)} with ${dateLabel(targetDate)}`,
      );
    for (const session of secondGroup)
      saveSession(
        session.id,
        { scheduledDate: selectedDay },
        `Rearranged ${dateLabel(selectedDay)} with ${dateLabel(targetDate)}`,
      );
    setSelectedDay(undefined);
  }

  return (
    <div className="screen week-screen">
      <header className="page-header week-page-header">
        <div>
          <p className="eyebrow">
            {state} week · {sessions[0]?.phase}
          </p>
          <h1>Week {week}</h1>
          <p>Plan, outcomes, and weekly review in one place.</p>
        </div>
        <div className="week-header-actions">
          <button
            className="button secondary"
            disabled={week <= 1}
            aria-label="Previous week"
            onClick={() => setWeek((value) => Math.max(1, value - 1))}
          >
            <ArrowLeft size={17} />
          </button>
          <select
            aria-label="Plan week"
            value={week}
            onChange={(event) => setWeek(Number(event.target.value))}
          >
            {Array.from({ length: maxWeek }, (_, index) => (
              <option value={index + 1} key={index + 1}>
                Week {index + 1}
              </option>
            ))}
          </select>
          <button
            className="button secondary"
            disabled={week >= maxWeek}
            aria-label="Next week"
            onClick={() => setWeek((value) => Math.min(maxWeek, value + 1))}
          >
            <ArrowRight size={17} />
          </button>
          <button
            className={rearranging ? "button primary" : "button secondary"}
            onClick={() => {
              setRearranging((value) => !value);
              setSelectedDay(undefined);
            }}
          >
            <CalendarDays size={17} />{" "}
            {rearranging ? "Done rearranging" : "Rearrange week"}
          </button>
          <button
            className="button secondary"
            onClick={() => setCreating(true)}
          >
            <Plus size={17} /> Add session
          </button>
        </div>
      </header>

      <section className="week-summary-strip" aria-label="Weekly summary">
        <div>
          <span>Core planned</span>
          <strong>{formatMiles(metrics.corePlannedMiles)}</strong>
        </div>
        <div>
          <span>Actual</span>
          <strong>{formatMiles(metrics.actualMiles)}</strong>
        </div>
        <div>
          <span>Core complete</span>
          <strong>
            {metrics.coreCompleted} of {metrics.coreTotal}
          </strong>
        </div>
        <div>
          <span>Run days</span>
          <strong>{metrics.runDays}</strong>
        </div>
      </section>

      {rearranging ? (
        <section
          className="panel rearrange-panel"
          aria-labelledby="rearrange-title"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">Rearrange mode</p>
              <h2 id="rearrange-title">Swap whole days</h2>
              <p>
                Select one day, then another. Sessions on the same day stay
                linked.
              </p>
            </div>
          </div>
          <div className="rearrange-days">
            {dateSlots.map((date) => {
              const daySessions = sessions.filter(
                (session) => session.scheduledDate === date,
              );
              const isSelected = selectedDay === date;
              return (
                <button
                  type="button"
                  key={date}
                  className={`rearrange-day${isSelected ? " selected" : ""}`}
                  aria-pressed={isSelected}
                  onClick={() => swapDayGroups(date)}
                >
                  <GripVertical size={18} aria-hidden="true" />
                  <span>
                    <strong>{dateLabel(date)}</strong>
                    <small>{date === localToday ? "Today" : ""}</small>
                  </span>
                  <span className="rearrange-session-list">
                    {daySessions.length ? (
                      daySessions.map((session) => (
                        <i
                          className={`session-chip kind-${session.kind}`}
                          key={session.id}
                        >
                          {session.title}
                        </i>
                      ))
                    ) : (
                      <i className="session-chip rest-placeholder">
                        Rest / empty
                      </i>
                    )}
                  </span>
                  <span>
                    {isSelected ? "Choose destination" : "Select day"}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="rearrange-help" aria-live="polite">
            {selectedDay
              ? `${dateLabel(selectedDay)} selected. Choose another day to swap.`
              : "No day selected."}
          </p>
        </section>
      ) : (
        <div className="plan-table-wrap week-table-wrap">
          <table className="data-table plan-table week-table">
            <thead>
              <tr>
                <th>Day</th>
                <th>Session</th>
                <th>Guidance</th>
                <th>Planned</th>
                <th>Actual</th>
                <th>Status</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => {
                const actual = actualMilesForSession(
                  session.id,
                  data.activities,
                  data.journals,
                );
                return (
                  <tr
                    key={session.id}
                    className={`week-session-row kind-${session.kind}${session.scheduledDate === localToday ? " is-today" : ""}`}
                  >
                    <td>
                      <strong>{dateLabel(session.scheduledDate)}</strong>
                      {session.scheduledDate === localToday && (
                        <small>Today</small>
                      )}
                      {session.scheduledDate !== session.originalDate && (
                        <small>
                          Originally {formatDate(session.originalDate)}
                        </small>
                      )}
                    </td>
                    <td>
                      <strong>{session.title}</strong>
                      <span className="type-label">
                        {session.flexible ? "Flexible · " : ""}
                        {session.kind}
                      </span>
                    </td>
                    <td>{session.guidance}</td>
                    <td>
                      {session.kind === "rest"
                        ? "—"
                        : formatMiles(session.plannedDistanceMiles)}
                    </td>
                    <td>{actual > 0 ? formatMiles(actual) : "—"}</td>
                    <td>
                      <StatusBadge status={session.status} />
                    </td>
                    <td>
                      <div className="row-actions">
                        {session.kind !== "rest" && (
                          <button
                            className="icon-button"
                            aria-label={`Log ${session.title}`}
                            onClick={() => setReviewing(session)}
                          >
                            <ClipboardCheck size={17} />
                          </button>
                        )}
                        <button
                          className="icon-button"
                          aria-label={`Edit ${session.title}`}
                          onClick={() => setEditing(session)}
                        >
                          <Pencil size={17} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {state === "Completed" && (
        <p className="week-state-note">
          This week is complete. Planned and actual values remain separate, and
          flexible mileage does not complete missed core sessions.
        </p>
      )}
      {state === "Upcoming" && (
        <p className="week-state-note">
          This is an upcoming week. Rearranging preserves every session’s
          original date and prescription.
        </p>
      )}

      {editing && (
        <Modal
          title={`Edit plan · ${editing.title}`}
          onClose={() => setEditing(null)}
        >
          <PlanEditForm
            week={week}
            session={editing}
            onSaved={() => setEditing(null)}
          />
        </Modal>
      )}
      {creating && (
        <Modal title="Add planned session" onClose={() => setCreating(false)}>
          <PlanEditForm week={week} onSaved={() => setCreating(false)} />
        </Modal>
      )}
      {reviewing && (
        <Modal
          eyebrow={dateLabel(reviewing.scheduledDate)}
          title="Log workout"
          subtitle={`${reviewing.title} · ${formatMiles(reviewing.plannedDistanceMiles)}`}
          className="log-workout-modal"
          closeLabel="Close log workout"
          onClose={() => setReviewing(null)}
        >
          <RunEntryWorkflow
            session={reviewing}
            onSaved={() => setReviewing(null)}
            onCancel={() => setReviewing(null)}
            onFitImported={(batchId) => {
              setReviewing(null);
              onFitImported?.(batchId);
            }}
            initialMethod="fit"
          />
        </Modal>
      )}
    </div>
  );
}
