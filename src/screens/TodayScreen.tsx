import {
  CalendarDays,
  ChevronRight,
  Clock3,
  HeartPulse,
  Route,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useAppData } from "../data/app-context";
import { calculateWeeklyMetrics } from "../domain/metrics";
import type { PlannedSession } from "../domain/types";
import { formatDate, formatMiles } from "../utils/format";
import { Metric } from "../components/Metric";
import { Modal } from "../components/Modal";
import { RunEntryWorkflow } from "../components/RunEntryWorkflow";
import { StatusBadge } from "../components/StatusBadge";

const TODAY = "2026-11-06";

export function TodayScreen({
  openActivityReview,
  openPlan,
}: {
  openActivityReview: () => void;
  openPlan: () => void;
}) {
  const { data } = useAppData();
  const [editing, setEditing] = useState<PlannedSession | null>(null);
  const session =
    data.sessions.find((item) => item.scheduledDate === TODAY) ??
    data.sessions.find((item) => item.kind !== "rest")!;
  const metrics = useMemo(
    () =>
      calculateWeeklyMetrics(
        session.week,
        data.sessions,
        data.activities,
        data.journals,
      ),
    [data, session.week],
  );
  const newActivities = data.activities.filter(
    (activity) => activity.importedAt.slice(0, 10) >= "2026-11-03",
  );
  const weekSessions = data.sessions.filter(
    (item) => item.week === session.week,
  );

  return (
    <div className="screen today-screen">
      <header className="page-header">
        <div>
          <p className="eyebrow">
            Friday ·{" "}
            {formatDate(TODAY, {
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </p>
          <h1>Today</h1>
        </div>
        <span className="local-note">Saved on this device</span>
      </header>

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
          {session.kind === "rest" ? (
            <div className="button-row">
              <button className="button primary" onClick={openPlan}>
                View weekly plan
              </button>
            </div>
          ) : (
            <>
              <div className="button-row">
                <button
                  className="button primary"
                  onClick={() => setEditing(session)}
                >
                  Review today’s run
                </button>
                <button
                  className="button secondary"
                  onClick={() => setEditing(session)}
                >
                  Update details
                </button>
              </div>
              <p className="keyboard-hint">
                Tip: press Tab to move through fields. Enter activates the
                focused action.
              </p>
            </>
          )}
        </div>

        <aside className="week-progress" aria-labelledby="week-progress-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">
                Week {session.week} · {session.phase}
              </p>
              <h2 id="week-progress-title">Week progress</h2>
            </div>
            <strong>
              {Math.round(
                (metrics.actualMiles / Math.max(metrics.corePlannedMiles, 1)) *
                  100,
              )}
              %
            </strong>
          </div>
          <div
            className="progress-track"
            aria-label={`${metrics.actualMiles} of ${metrics.corePlannedMiles} core planned miles`}
          >
            <span
              style={{
                width: `${Math.min(100, (metrics.actualMiles / Math.max(metrics.corePlannedMiles, 1)) * 100)}%`,
              }}
            />
          </div>
          <div className="metrics-row compact">
            <Metric label="Actual" value={formatMiles(metrics.actualMiles)} />
            <Metric
              label="Core plan"
              value={formatMiles(metrics.corePlannedMiles)}
            />
            <Metric label="Run days" value={metrics.runDays} />
          </div>
          <ol className="week-strip" aria-label="Week sessions">
            {weekSessions.map((item) => (
              <li
                key={item.id}
                className={item.scheduledDate === TODAY ? "today" : ""}
              >
                <span>
                  {new Date(`${item.scheduledDate}T12:00:00`)
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

      <section className="secondary-grid">
        <div className="panel next-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Next up</p>
              <h2>Saturday easy</h2>
            </div>
            <CalendarDays size={20} />
          </div>
          <p>
            {formatMiles(
              weekSessions.find((item) => item.scheduledDate === "2026-11-07")
                ?.plannedDistanceMiles ?? 4,
            )}{" "}
            · Comfortable effort
          </p>
          <span>Keep this supporting run easy before Sunday’s long run.</span>
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
          <button className="text-button" onClick={openActivityReview}>
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
              <dt>Pace</dt>
              <dd>8:10–8:45/mi</dd>
            </div>
            <div>
              <dt>Heart rate</dt>
              <dd>≤157 bpm after 10 min</dd>
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
          title={`Review · ${editing.title}`}
          onClose={() => setEditing(null)}
        >
          <RunEntryWorkflow
            session={editing}
            onSaved={() => setEditing(null)}
            onCancel={() => setEditing(null)}
          />
        </Modal>
      )}
    </div>
  );
}
