import { AlertCircle, CheckCircle2, Info, ListTree } from "lucide-react";
import { useMemo, useState } from "react";
import { useAppData } from "../data/app-context";
import { calculateWeeklyMetrics, mileageAdherence } from "../domain/metrics";
import { buildObservations } from "../domain/observations";
import { formatMiles } from "../utils/format";
import { Metric } from "../components/Metric";
import { StatusBadge } from "../components/StatusBadge";

export function WeeklyReviewScreen() {
  const { data } = useAppData();
  const [week, setWeek] = useState(1);
  const maxWeek = Math.max(...data.sessions.map((session) => session.week));
  const metrics = useMemo(
    () =>
      calculateWeeklyMetrics(
        week,
        data.sessions,
        data.activities,
        data.journals,
      ),
    [week, data],
  );
  const observations = useMemo(
    () =>
      buildObservations(week, data.sessions, data.activities, data.journals),
    [week, data],
  );
  const sessions = data.sessions.filter(
    (session) => session.week === week && session.kind !== "rest",
  );
  const adherence = mileageAdherence(metrics);
  return (
    <div className="screen">
      <header className="page-header">
        <div>
          <p className="eyebrow">Review without prescription</p>
          <h1>Weekly review</h1>
          <p>
            Completion and mileage are measured separately. Extra miles never
            erase a missed core session.
          </p>
        </div>
        <label className="header-select">
          Week
          <select
            value={week}
            onChange={(event) => setWeek(Number(event.target.value))}
          >
            {Array.from({ length: maxWeek }, (_, index) => (
              <option value={index + 1} key={index + 1}>
                Week {index + 1}
              </option>
            ))}
          </select>
        </label>
      </header>
      <section className="metrics-panel">
        <Metric
          label="Core planned"
          value={formatMiles(metrics.corePlannedMiles)}
          detail={`${metrics.coreTotal} sessions`}
        />
        <Metric
          label="Flexible planned"
          value={formatMiles(metrics.flexiblePlannedMiles)}
          detail="Excluded from core"
        />
        <Metric
          label="Actual"
          value={formatMiles(metrics.actualMiles)}
          detail={
            adherence === null
              ? "No core plan"
              : `${Math.round(adherence * 100)}% mileage adherence`
          }
        />
        <Metric
          label="Core complete"
          value={
            metrics.coreCompletionRate === null
              ? "—"
              : `${Math.round(metrics.coreCompletionRate * 100)}%`
          }
          detail={`${metrics.coreCompleted} of ${metrics.coreTotal}`}
        />
        <Metric label="Long run" value={formatMiles(metrics.longRunMiles)} />
        <Metric label="Run days" value={metrics.runDays} />
      </section>
      <div className="review-summary-grid">
        <section className="panel outcome-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Plan outcomes</p>
              <h2>Session status</h2>
            </div>
            <ListTree size={20} />
          </div>
          <div className="outcome-bar" aria-label="Session outcomes">
            {sessions.map((session) => (
              <span
                key={session.id}
                className={`outcome-${session.status}`}
                title={`${session.title}: ${session.status}`}
              />
            ))}
          </div>
          <table className="data-table compact-table">
            <thead>
              <tr>
                <th>Session</th>
                <th>Planned</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr key={session.id}>
                  <td>
                    {session.title}
                    {session.flexible && <small>Flexible</small>}
                  </td>
                  <td>{formatMiles(session.plannedDistanceMiles)}</td>
                  <td>
                    <StatusBadge status={session.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="panel observation-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Deterministic review</p>
              <h2>Observations</h2>
            </div>
            <Info size={20} />
          </div>
          {observations.length === 0 ? (
            <div className="empty-observation">
              <CheckCircle2 size={22} />
              <div>
                <strong>No observation rules triggered</strong>
                <span>Missing entries are not treated as healthy values.</span>
              </div>
            </div>
          ) : (
            <div className="observation-list">
              {observations.map((observation) => (
                <details key={observation.id}>
                  <summary>
                    <AlertCircle size={18} />
                    <span>
                      <strong>{observation.title}</strong>
                      <small>{observation.summary}</small>
                    </span>
                  </summary>
                  <div className="evidence">
                    <h4>Why this appeared</h4>
                    {observation.evidence.map((item) => (
                      <p key={item.label}>
                        <strong>{item.label}:</strong> {item.detail}
                      </p>
                    ))}
                    <h4>Missing data</h4>
                    <p>
                      {observation.missingData.length
                        ? observation.missingData.join(" ")
                        : "None for this rule."}
                    </p>
                  </div>
                </details>
              ))}
            </div>
          )}
        </section>
      </div>
      <p className="medical-note">
        These observations explain recorded patterns. They do not diagnose
        injury, prescribe treatment, or change the plan.
      </p>
    </div>
  );
}
