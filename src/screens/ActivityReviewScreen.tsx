import { Check, FileClock, Link2, Route } from "lucide-react";
import { useState } from "react";
import { useAppData } from "../data/app-context";
import type { ActivityRole, LapRole } from "../domain/types";
import {
  formatDate,
  formatDuration,
  formatMiles,
  paceFrom,
} from "../utils/format";

const roles: { value: ActivityRole; label: string }[] = [
  { value: "primary-easy", label: "Primary easy / recovery" },
  { value: "primary-long", label: "Primary long run" },
  { value: "primary-workout", label: "Primary workout" },
  { value: "warm-up", label: "Warm-up" },
  { value: "cooldown", label: "Cooldown" },
  { value: "strides", label: "Strides" },
  { value: "unrelated", label: "Unrelated" },
];

export function ActivityReviewScreen() {
  const { data, updateActivity, updateLapRole } = useAppData();
  const [selectedId, setSelectedId] = useState(data.activities[0]?.id ?? "");
  const selected = data.activities.find(
    (activity) => activity.id === selectedId,
  );
  const matched = data.sessions.find(
    (session) => session.id === selected?.plannedSessionId,
  );
  return (
    <div className="screen">
      <header className="page-header">
        <div>
          <p className="eyebrow">Imported activities</p>
          <h1>Activity review</h1>
          <p>Confirm the bundle, primary activity, role, and lap labels.</p>
        </div>
        <button className="button primary" disabled={!data.activities.length}>
          <Check size={17} /> Confirm reviewed
        </button>
      </header>
      {!data.activities.length ? (
        <div className="panel empty-state activity-empty">
          <Route size={28} />
          <p>No imported activities to review.</p>
          <span>Import FIT files from Data & settings when you are ready.</span>
        </div>
      ) : (
        <div className="review-layout">
          <aside className="activity-list" aria-label="Imported activities">
            {data.activities.map((activity) => {
              const session = data.sessions.find(
                (item) => item.id === activity.plannedSessionId,
              );
              return (
                <button
                  key={activity.id}
                  className={
                    activity.id === selectedId
                      ? "activity-item selected"
                      : "activity-item"
                  }
                  onClick={() => setSelectedId(activity.id)}
                >
                  <span className="activity-icon">
                    <Route size={18} />
                  </span>
                  <span>
                    <strong>
                      {formatMiles(activity.distanceMiles)} ·{" "}
                      {formatDate(activity.occurredAt.slice(0, 10))}
                    </strong>
                    <small>
                      {session
                        ? `Suggested: ${session.title}`
                        : "No plan match"}
                    </small>
                  </span>
                  <i aria-hidden="true" />
                </button>
              );
            })}
          </aside>
          {selected && (
            <section className="activity-detail">
              <div className="activity-summary">
                <div>
                  <p className="eyebrow">{selected.fileName}</p>
                  <h2>{formatMiles(selected.distanceMiles)} easy run</h2>
                  <span>
                    {formatDuration(selected.durationSeconds)} ·{" "}
                    {paceFrom(selected.distanceMiles, selected.durationSeconds)}{" "}
                    · {selected.averageHr ?? "—"} bpm
                  </span>
                </div>
                <span className="match-confidence">
                  <Check size={15} /> Suggested match
                </span>
              </div>
              <div className="match-grid">
                <label>
                  Planned session
                  <select
                    value={selected.plannedSessionId ?? ""}
                    onChange={(event) =>
                      updateActivity(selected.id, {
                        plannedSessionId: event.target.value || undefined,
                      })
                    }
                  >
                    <option value="">Unplanned activity</option>
                    {data.sessions
                      .filter(
                        (session) =>
                          session.kind !== "rest" &&
                          Math.abs(
                            new Date(session.scheduledDate).getTime() -
                              new Date(selected.occurredAt).getTime(),
                          ) <
                            5 * 86400000,
                      )
                      .map((session) => (
                        <option value={session.id} key={session.id}>
                          {session.scheduledDate} · {session.title} ·{" "}
                          {formatMiles(session.plannedDistanceMiles)}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Activity role
                  <select
                    value={selected.role}
                    onChange={(event) =>
                      updateActivity(selected.id, {
                        role: event.target.value as ActivityRole,
                      })
                    }
                  >
                    {roles.map((role) => (
                      <option key={role.value} value={role.value}>
                        {role.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={selected.isPrimary}
                    onChange={(event) =>
                      updateActivity(selected.id, {
                        isPrimary: event.target.checked,
                      })
                    }
                  />{" "}
                  Primary activity in bundle
                </label>
              </div>
              <div className="bundle-note">
                <Link2 size={18} />
                <div>
                  <strong>
                    {matched ? `Matched to ${matched.title}` : "Unplanned run"}
                  </strong>
                  <span>
                    {matched
                      ? `${formatMiles(matched.plannedDistanceMiles)} planned on ${formatDate(matched.scheduledDate)}. Supporting activities add mileage but remain secondary.`
                      : "This mileage counts as actual, not core completion, unless attached as a replacement."}
                  </span>
                </div>
              </div>
              <div className="laps-section">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Source detail</p>
                    <h3>Laps</h3>
                  </div>
                  <FileClock size={19} />
                </div>
                {selected.laps.length ? (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Lap</th>
                        <th>Distance</th>
                        <th>Time</th>
                        <th>Avg HR</th>
                        <th>Classification</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.laps.map((lap, index) => (
                        <tr key={lap.id}>
                          <td>{index + 1}</td>
                          <td>{formatMiles(lap.distanceMiles)}</td>
                          <td>{formatDuration(lap.durationSeconds)}</td>
                          <td>{lap.averageHr ?? "—"}</td>
                          <td>
                            <select
                              aria-label={`Lap ${index + 1} classification`}
                              value={lap.role}
                              onChange={(event) =>
                                updateLapRole(
                                  selected.id,
                                  lap.id,
                                  event.target.value as LapRole,
                                )
                              }
                            >
                              <option value="work">Work</option>
                              <option value="recovery">Recovery</option>
                              <option value="warm-up">Warm-up</option>
                              <option value="cooldown">Cooldown</option>
                              <option value="other">Other</option>
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="empty-state">
                    <p>No laps in this source activity.</p>
                    <span>The original activity is still preserved.</span>
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
