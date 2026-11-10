import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  HeartPulse,
  Route,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useAppData } from "../data/app-context";
import { calculateWeeklyMetrics } from "../domain/metrics";
import type { PlannedSession } from "../domain/types";
import { formatDuration } from "../domain/run-entry";
import { formatDate, formatMiles, paceFrom } from "../utils/format";
import { Metric } from "../components/Metric";
import { Modal } from "../components/Modal";
import { RunEntryWorkflow } from "../components/RunEntryWorkflow";
import { StatusBadge } from "../components/StatusBadge";

function isoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateAtNoon(value: string): Date {
  return new Date(`${value}T12:00:00`);
}

function addDays(value: string, amount: number): string {
  const date = dateAtNoon(value);
  date.setDate(date.getDate() + amount);
  return isoDate(date);
}

function weekDates(value: string): string[] {
  const date = dateAtNoon(value);
  const day = date.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + mondayOffset);
  return Array.from({ length: 7 }, (_, index) => {
    const item = new Date(date);
    item.setDate(date.getDate() + index);
    return isoDate(item);
  });
}

function relativeDateLabel(selected: string, today: string): string {
  if (selected === today) return "Today";
  if (selected === addDays(today, -1)) return "Yesterday";
  if (selected === addDays(today, 1)) return "Tomorrow";
  return formatDate(selected, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function TodayDashboard({
  openActivityReview,
  openPlan,
}: {
  openActivityReview: (batchId?: string) => void;
  openPlan: () => void;
}) {
  const { data } = useAppData();
  const today = useMemo(() => isoDate(new Date()), []);
  const [selectedDate, setSelectedDate] = useState(today);
  const [editing, setEditing] = useState<PlannedSession | null>(null);
  const selectedWeek = weekDates(selectedDate);
  const session = data.sessions.find(
    (item) => item.scheduledDate === selectedDate,
  );
  const journal = data.journals.find(
    (entry) =>
      entry.date === selectedDate &&
      (!session || !entry.sessionId || entry.sessionId === session.id),
  );
  const recordedActivity = session
    ? (data.activities.find(
        (activity) =>
          activity.plannedSessionId === session.id && activity.isPrimary,
      ) ??
      data.activities.find(
        (activity) => activity.plannedSessionId === session.id,
      ))
    : undefined;
  const activityShoe = data.shoes.find(
    (shoe) => shoe.id === recordedActivity?.shoeId,
  );
  const weekSessions = data.sessions
    .filter((item) => selectedWeek.includes(item.scheduledDate))
    .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));
  const referenceSession = session ?? weekSessions[0];
  const metrics = useMemo(
    () =>
      referenceSession
        ? calculateWeeklyMetrics(
            referenceSession.week,
            data.sessions,
            data.activities,
            data.journals,
          )
        : null,
    [data, referenceSession],
  );
  const importCutoff = addDays(today, -3);
  const pendingActivityIds = new Set(
    data.fitImportBatches
      .filter(
        (batch) =>
          batch.createdAt.slice(0, 10) >= importCutoff &&
          !data.activityReviewConfirmations.some(
            (confirmation) => confirmation.batchId === batch.id,
          ),
      )
      .flatMap((batch) =>
        batch.sourceResults.flatMap((result) => result.activityIds),
      ),
  );
  const newActivities = data.fitSourceActivities.filter((activity) =>
    pendingActivityIds.has(activity.id),
  );
  const nextSession = data.sessions
    .filter((item) => item.scheduledDate > selectedDate && item.kind !== "rest")
    .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate))[0];
  const isPast = selectedDate < today;

  return (
    <div className="screen today-screen">
      <header className="page-header date-aware-header">
        <div>
          <p className="eyebrow">
            {formatDate(selectedDate, {
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </p>
          <h1>{relativeDateLabel(selectedDate, today)}</h1>
        </div>
        <div className="date-stepper" aria-label="Select day">
          <button
            className="icon-button"
            type="button"
            aria-label="Previous day"
            onClick={() => setSelectedDate(addDays(selectedDate, -1))}
          >
            <ChevronLeft size={19} />
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={() => setSelectedDate(today)}
            disabled={selectedDate === today}
          >
            Today
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="Next day"
            onClick={() => setSelectedDate(addDays(selectedDate, 1))}
          >
            <ChevronRight size={19} />
          </button>
        </div>
      </header>

      <nav className="week-date-picker" aria-label="Week dates">
        {selectedWeek.map((date) => {
          const item = data.sessions.find(
            (candidate) => candidate.scheduledDate === date,
          );
          const hasResult =
            data.journals.some((entry) => entry.date === date) ||
            Boolean(
              item &&
              data.activities.some(
                (activity) => activity.plannedSessionId === item.id,
              ),
            );
          return (
            <button
              key={date}
              type="button"
              className={`${date === selectedDate ? "selected" : ""} ${date === today ? "literal-today" : ""}`.trim()}
              aria-current={date === selectedDate ? "date" : undefined}
              onClick={() => setSelectedDate(date)}
            >
              <span>
                {dateAtNoon(date).toLocaleDateString("en-US", {
                  weekday: "short",
                })}
              </span>
              <strong>{dateAtNoon(date).getDate()}</strong>
              <small>
                {item?.kind === "rest"
                  ? "Rest"
                  : hasResult
                    ? "Recorded"
                    : item
                      ? `${item.plannedDistanceMiles} mi`
                      : "—"}
              </small>
            </button>
          );
        })}
      </nav>

      {session ? (
        <section className="today-layout" aria-labelledby="today-session-title">
          <div className="primary-panel session-hero">
            <div className="session-heading">
              <div>
                <span className="session-kind">{session.kind}</span>
                <h2 id="today-session-title">{session.title}</h2>
              </div>
              <StatusBadge status={session.status} />
            </div>
            <div className="session-target">
              <strong>
                {session.kind === "rest"
                  ? "Rest day"
                  : formatMiles(session.plannedDistanceMiles)}
              </strong>
              <span>{session.guidance}</span>
            </div>
            <div className="instruction">
              <p>{session.instructions}</p>
              <span>
                Original prescription:{" "}
                {session.kind === "rest"
                  ? "Rest"
                  : formatMiles(session.originalDistanceMiles)}{" "}
                on {formatDate(session.originalDate)}
              </span>
            </div>
            {journal ? (
              <div className="recorded-day-summary">
                <div>
                  <span>Recorded result</span>
                  <strong>
                    {journal.actualDistanceMiles === undefined
                      ? session.status
                      : `${journal.actualDistanceMiles.toFixed(2)} mi`}
                  </strong>
                </div>
                <div>
                  <span>Duration</span>
                  <strong>
                    {journal.durationSeconds === undefined
                      ? "Not recorded"
                      : formatDuration(journal.durationSeconds)}
                  </strong>
                </div>
                <div>
                  <span>RPE</span>
                  <strong>
                    {journal.rpe === undefined
                      ? "Not recorded"
                      : `${journal.rpe}/10`}
                  </strong>
                </div>
              </div>
            ) : recordedActivity ? (
              <div className="recorded-day-summary">
                <div>
                  <span>Recorded activity</span>
                  <strong>{formatMiles(recordedActivity.distanceMiles)}</strong>
                </div>
                <div>
                  <span>Duration</span>
                  <strong>
                    {recordedActivity.durationSeconds === undefined
                      ? "Not recorded"
                      : formatDuration(recordedActivity.durationSeconds)}
                  </strong>
                </div>
                <div>
                  <span>Pace</span>
                  <strong>
                    {paceFrom(
                      recordedActivity.distanceMiles,
                      recordedActivity.durationSeconds,
                    )}
                  </strong>
                </div>
                <div>
                  <span>Heart rate</span>
                  <strong>
                    {recordedActivity.averageHr === undefined
                      ? "Not recorded"
                      : `${recordedActivity.averageHr} bpm`}
                  </strong>
                  {activityShoe && <small>{activityShoe.name}</small>}
                </div>
              </div>
            ) : isPast && session.kind !== "rest" ? (
              <p className="missing-day-message">
                No result has been recorded for this day. Add the run data when
                you are ready.
              </p>
            ) : null}
            <div className="button-row">
              {session.kind === "rest" ? (
                <button className="button primary" onClick={openPlan}>
                  View weekly plan
                </button>
              ) : recordedActivity ? (
                <button
                  className="button primary"
                  onClick={() => openActivityReview()}
                >
                  View activity
                </button>
              ) : (
                <button
                  className="button primary"
                  onClick={() => setEditing(session)}
                >
                  {journal ? "Update entry" : "Log this run"}
                </button>
              )}
            </div>
          </div>

          <aside
            className="week-progress"
            aria-labelledby="week-progress-title"
          >
            <div className="section-heading">
              <div>
                <p className="eyebrow">
                  Week {session.week} · {session.phase}
                </p>
                <h2 id="week-progress-title">Week progress</h2>
              </div>
              <strong>
                {metrics?.coreCompletionRate === null ||
                metrics?.coreCompletionRate === undefined
                  ? "—"
                  : `${Math.round(metrics.coreCompletionRate * 100)}%`}
              </strong>
            </div>
            <div className="metrics-row compact">
              <Metric
                label="Actual"
                value={formatMiles(metrics?.actualMiles ?? 0)}
              />
              <Metric
                label="Core plan"
                value={formatMiles(metrics?.corePlannedMiles ?? 0)}
              />
              <Metric label="Run days" value={metrics?.runDays ?? 0} />
            </div>
            <ol className="week-strip" aria-label="Week sessions">
              {weekSessions.map((item) => (
                <li
                  key={item.id}
                  className={item.scheduledDate === selectedDate ? "today" : ""}
                >
                  <span>
                    {dateAtNoon(item.scheduledDate)
                      .toLocaleDateString("en-US", { weekday: "short" })
                      .slice(0, 2)}
                  </span>
                  <i
                    className={`day-mark mark-${item.status}`}
                    aria-hidden="true"
                  />
                  <small>
                    {item.kind === "rest" ? "Rest" : item.plannedDistanceMiles}
                  </small>
                </li>
              ))}
            </ol>
          </aside>
        </section>
      ) : (
        <section className="primary-panel no-session-day">
          <CalendarDays size={24} aria-hidden="true" />
          <div>
            <h2>No planned session</h2>
            <p>This literal date has no session in the current plan.</p>
          </div>
          <button className="button secondary" onClick={openPlan}>
            View plan
          </button>
        </section>
      )}

      <section className="secondary-grid">
        <div className="panel next-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Next up</p>
              <h2>{nextSession?.title ?? "No upcoming session"}</h2>
            </div>
            <CalendarDays size={20} />
          </div>
          {nextSession && (
            <>
              <p>
                {formatDate(nextSession.scheduledDate)} ·{" "}
                {formatMiles(nextSession.plannedDistanceMiles)}
              </p>
              <span>{nextSession.guidance}</span>
            </>
          )}
        </div>
        <div className="panel import-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Imports</p>
              <h2>{newActivities.length} activities ready</h2>
            </div>
            <Route size={20} />
          </div>
          <p>Matches are suggested and remain editable.</p>
          <button className="text-button" onClick={() => openActivityReview()}>
            Review activities <ChevronRight size={16} />
          </button>
        </div>
        <div className="panel reference-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Reference</p>
              <h2>Easy guidance</h2>
            </div>
            <HeartPulse size={20} />
          </div>
          <dl>
            <div>
              <dt>Heart rate</dt>
              <dd>
                {data.settings.easyHrLow ?? "—"}–
                {data.settings.easyHrHigh ?? "—"} bpm
              </dd>
            </div>
            <div>
              <dt>Review time</dt>
              <dd>
                <Clock3 size={14} /> under 2 min
              </dd>
            </div>
          </dl>
        </div>
      </section>
      <p className="medical-note">
        Training observations are review prompts only. This app does not provide
        medical advice or prescribe training.
      </p>
      {editing && (
        <Modal
          className="log-workout-modal"
          eyebrow={formatDate(editing.scheduledDate, {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
          title="Log workout"
          subtitle={`Planned: ${editing.title} · ${formatMiles(editing.plannedDistanceMiles)}`}
          closeLabel="Close log workout"
          onClose={() => setEditing(null)}
        >
          <RunEntryWorkflow
            session={editing}
            onSaved={() => setEditing(null)}
            onCancel={() => setEditing(null)}
            onFitImported={(batchId) => {
              setEditing(null);
              openActivityReview(batchId);
            }}
          />
        </Modal>
      )}
    </div>
  );
}
