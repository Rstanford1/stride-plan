import { AlertCircle, Check, FileClock, Link2, Route } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAppData } from "../data/app-context";
import {
  createActivityReviewDraft,
  validateActivityReview,
} from "../domain/activity-review";
import type {
  ActivityReviewDecision,
  ActivityReviewDraft,
  ActivityRole,
  FitSourceActivity,
  LapRole,
} from "../domain/types";
import {
  formatDate,
  formatDuration,
  formatMiles,
  paceFrom,
} from "../utils/format";

const METERS_PER_MILE = 1609.344;
const roles: { value: ActivityRole; label: string }[] = [
  { value: "primary-easy", label: "Primary easy / recovery" },
  { value: "primary-long", label: "Primary long run" },
  { value: "primary-workout", label: "Primary workout" },
  { value: "warm-up", label: "Warm-up" },
  { value: "cooldown", label: "Cooldown" },
  { value: "strides", label: "Strides" },
  { value: "supporting-recovery", label: "Supporting recovery" },
  { value: "unrelated", label: "Unrelated" },
];

function roleLabel(role?: ActivityRole) {
  return roles.find((item) => item.value === role)?.label ?? "Choose role";
}

function PaceTimeline({ activity }: { activity: FitSourceActivity }) {
  const samples = activity.samples.filter(
    (sample) =>
      sample.distanceMeters !== undefined &&
      sample.speedMetersPerSecond !== undefined &&
      sample.speedMetersPerSecond > 0,
  );
  if (samples.length < 2)
    return (
      <div className="empty-state compact-empty">
        <p>Pace samples were not recorded.</p>
        <span>Source laps remain available below.</span>
      </div>
    );
  const paces = samples.map(
    (sample) => METERS_PER_MILE / (sample.speedMetersPerSecond ?? 1),
  );
  const slow = Math.max(...paces);
  const fast = Math.min(...paces);
  const distance = Math.max(
    activity.distanceMeters,
    ...samples.map((sample) => sample.distanceMeters ?? 0),
  );
  const points = samples
    .map((sample, index) => {
      const x =
        ((sample.distanceMeters ?? 0) / Math.max(distance, 1)) * 760 + 20;
      const y = ((paces[index] - fast) / Math.max(slow - fast, 1)) * 120 + 20;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  let lapDistance = 0;
  return (
    <figure className="pace-timeline">
      <svg
        viewBox="0 0 800 165"
        role="img"
        aria-label="Recorded pace by distance; faster pace appears higher"
      >
        <title>Recorded pace by distance</title>
        <line x1="20" y1="140" x2="780" y2="140" />
        {activity.laps.map((lap, index) => {
          lapDistance += lap.distanceMeters;
          const x = (lapDistance / Math.max(distance, 1)) * 760 + 20;
          return (
            <g key={lap.id}>
              <line className="lap-landmark" x1={x} y1="14" x2={x} y2="140" />
              <text x={Math.min(x + 4, 760)} y="158">
                Lap {index + 1}
              </text>
            </g>
          );
        })}
        <polyline points={points} />
      </svg>
      <figcaption>
        Pace is primary. Dashed lines are recorded FIT laps, not automatic
        workout segments.
      </figcaption>
    </figure>
  );
}

export function ActivityReviewScreen() {
  const {
    data,
    saveActivityReviewDraft,
    confirmActivityReviewDraft,
    reviseActivityReview,
  } = useAppData();
  const batches = data.fitImportBatches.filter((batch) =>
    batch.sourceResults.some((result) => result.activityIds.length),
  );
  const initial =
    [...batches]
      .reverse()
      .find(
        (batch) =>
          !data.activityReviewConfirmations.some(
            (confirmation) => confirmation.batchId === batch.id,
          ),
      ) ?? batches.at(-1);
  const [batchId, setBatchId] = useState(initial?.id ?? "");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const batch = batches.find((item) => item.id === batchId);
  const draft = data.activityReviewDrafts.find(
    (item) => item.batchId === batchId,
  );
  const latestConfirmation = data.activityReviewConfirmations
    .filter((item) => item.batchId === batchId)
    .sort((left, right) => right.revisionNumber - left.revisionNumber)[0];

  useEffect(() => {
    if (!batch || draft || latestConfirmation) return;
    saveActivityReviewDraft(
      createActivityReviewDraft(
        batch,
        data.fitSourceActivities,
        data.sessions,
        data.shoes,
      ),
    );
  }, [
    batch,
    data.fitSourceActivities,
    data.sessions,
    data.shoes,
    draft,
    latestConfirmation,
    saveActivityReviewDraft,
  ]);

  const decisions = draft?.decisions ?? latestConfirmation?.decisions ?? [];
  const selectedId =
    draft?.selectedSourceActivityId ?? decisions[0]?.sourceActivityId;
  const selected = data.fitSourceActivities.find(
    (item) => item.id === selectedId,
  );
  const decision = decisions.find(
    (item) => item.sourceActivityId === selectedId,
  );
  const source = data.fitSources.find((item) => item.id === selected?.sourceId);
  const issues = useMemo(
    () => (draft ? validateActivityReview(draft, data) : []),
    [data, draft],
  );
  const included = decisions.filter((item) => item.role !== "unrelated");
  const totalMiles = included.reduce(
    (sum, item) =>
      sum +
      (data.fitSourceActivities.find(
        (sourceItem) => sourceItem.id === item.sourceActivityId,
      )?.distanceMeters ?? 0) /
        METERS_PER_MILE,
    0,
  );
  const totalDuration = included.reduce(
    (sum, item) =>
      sum +
      (data.fitSourceActivities.find(
        (sourceItem) => sourceItem.id === item.sourceActivityId,
      )?.durationSeconds ?? 0),
    0,
  );
  const session = data.sessions.find(
    (item) => item.id === decision?.plannedSessionId,
  );

  function saveDraft(next: ActivityReviewDraft) {
    saveActivityReviewDraft({ ...next, updatedAt: new Date().toISOString() });
  }
  function selectActivity(sourceActivityId: string) {
    if (draft)
      saveDraft({ ...draft, selectedSourceActivityId: sourceActivityId });
  }
  function updateDecision(
    sourceActivityId: string,
    update: Partial<ActivityReviewDecision>,
  ) {
    if (!draft) return;
    const requestedPrimary = update.role?.startsWith("primary-");
    const target = draft.decisions.find(
      (item) => item.sourceActivityId === sourceActivityId,
    );
    saveDraft({
      ...draft,
      decisions: draft.decisions.map((item) => {
        if (
          requestedPrimary &&
          target?.plannedSessionId &&
          item.sourceActivityId !== sourceActivityId &&
          item.plannedSessionId === target.plannedSessionId &&
          item.isPrimary
        ) {
          return { ...item, role: "supporting-recovery", isPrimary: false };
        }
        if (item.sourceActivityId !== sourceActivityId) return item;
        return {
          ...item,
          ...update,
          isPrimary:
            update.role === undefined
              ? (update.isPrimary ?? item.isPrimary)
              : Boolean(requestedPrimary),
        };
      }),
    });
  }

  if (!batches.length)
    return (
      <div className="screen">
        <header className="page-header">
          <div>
            <p className="eyebrow">Imported activities</p>
            <h1>Activity review</h1>
            <p>Confirm how imported runs correspond to the plan.</p>
          </div>
        </header>
        <div className="panel empty-state activity-empty">
          <Route size={28} />
          <p>No imported activities to review.</p>
          <span>Import FIT files from Data & settings when you are ready.</span>
        </div>
      </div>
    );

  return (
    <div className="screen activity-review-screen">
      <header className="page-header review-page-header">
        <div>
          <p className="eyebrow">Imported activities</p>
          <h1>Activity review</h1>
          <p>
            Confirm the plan match and meaning without changing source data.
          </p>
        </div>
        {batches.length > 1 && (
          <label className="review-batch-picker">
            Import batch
            <select
              value={batchId}
              onChange={(event) => setBatchId(event.target.value)}
            >
              {batches.map((item, index) => (
                <option value={item.id} key={item.id}>
                  Import {index + 1} · {formatDate(item.createdAt.slice(0, 10))}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>

      <section
        className="panel review-overview"
        aria-labelledby="review-summary-title"
      >
        <div>
          <p className="eyebrow">Review summary</p>
          <h2 id="review-summary-title">
            {latestConfirmation && !draft ? "Reviewed import" : "Draft import"}
          </h2>
          <p>
            {decisions.length} source{" "}
            {decisions.length === 1 ? "activity" : "activities"} ·{" "}
            {formatMiles(totalMiles)} · {formatDuration(totalDuration)}
          </p>
        </div>
        <div className="review-overview-status">
          {draft ? (
            <>
              <strong>
                {issues.length
                  ? `${issues.length} need attention`
                  : "Ready to confirm"}
              </strong>
              <span>Draft saved locally</span>
              <button
                className="button primary"
                disabled={issues.length > 0}
                onClick={() => confirmActivityReviewDraft(draft)}
              >
                <Check size={17} /> Confirm review
              </button>
              {issues.length > 0 && (
                <small>Resolve the items below before confirming.</small>
              )}
            </>
          ) : latestConfirmation ? (
            <>
              <strong>Reviewed</strong>
              <span>Source facts are read only.</span>
              <button
                className="button secondary"
                onClick={() => reviseActivityReview(batchId)}
              >
                Revise review
              </button>
            </>
          ) : (
            <>
              <strong>Preparing review…</strong>
              <span>Building reversible suggestions.</span>
            </>
          )}
        </div>
      </section>

      {issues.length > 0 && (
        <section
          className="review-issues"
          aria-labelledby="review-issues-title"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">Needs attention</p>
              <h2 id="review-issues-title">Resolve before confirming</h2>
            </div>
            <AlertCircle size={19} />
          </div>
          <ul>
            {issues.map((issue) => (
              <li key={issue.id}>
                <button
                  className="text-button"
                  onClick={() =>
                    issue.sourceActivityId &&
                    selectActivity(issue.sourceActivityId)
                  }
                >
                  {issue.message}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="review-layout">
        <aside className="activity-list" aria-label="Imported activities">
          {decisions.map((item) => {
            const activity = data.fitSourceActivities.find(
              (sourceItem) => sourceItem.id === item.sourceActivityId,
            );
            if (!activity) return null;
            const matched = data.sessions.find(
              (sessionItem) => sessionItem.id === item.plannedSessionId,
            );
            const hasIssue = issues.some(
              (issue) => issue.sourceActivityId === activity.id,
            );
            return (
              <button
                key={activity.id}
                className={
                  activity.id === selectedId
                    ? "activity-item selected"
                    : "activity-item"
                }
                onClick={() => selectActivity(activity.id)}
                aria-pressed={activity.id === selectedId}
              >
                <span className="activity-icon">
                  <Route size={18} />
                </span>
                <span>
                  <strong>
                    {formatMiles(activity.distanceMeters / METERS_PER_MILE)} ·{" "}
                    {new Date(activity.occurredAt).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </strong>
                  <small>{matched?.title ?? "No plan match"}</small>
                  <small>{roleLabel(item.role)}</small>
                </span>
                <i
                  className={hasIssue ? "needs-attention" : "ready"}
                  aria-label={hasIssue ? "Needs attention" : "Ready"}
                />
              </button>
            );
          })}
        </aside>

        {selected && decision && (
          <section className="activity-detail">
            <div className="activity-summary">
              <div>
                <p className="eyebrow">
                  {source?.originalFileName ?? "Imported FIT"}
                </p>
                <h2>
                  {formatMiles(selected.distanceMeters / METERS_PER_MILE)} run
                </h2>
                <span>
                  {formatDuration(selected.durationSeconds)} ·{" "}
                  {paceFrom(
                    selected.distanceMeters / METERS_PER_MILE,
                    selected.durationSeconds,
                  )}{" "}
                  ·{" "}
                  {selected.averageHr
                    ? `${selected.averageHr} bpm`
                    : "HR not recorded"}
                  {selected.totalAscentMeters !== undefined
                    ? ` · ${Math.round(selected.totalAscentMeters)} m ascent`
                    : ""}
                </span>
              </div>
              <span className="match-confidence">
                {draft ? "Suggested · editable" : "Confirmed"}
              </span>
            </div>

            {decision.suggestionEvidence.length > 0 && (
              <div className="match-evidence">
                <strong>Why this match was suggested</strong>
                <ul>
                  {decision.suggestionEvidence.map((evidence) => (
                    <li key={evidence}>{evidence}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="match-grid">
              <label>
                Planned session
                <select
                  disabled={!draft}
                  value={decision.plannedSessionId ?? ""}
                  onChange={(event) =>
                    updateDecision(selected.id, {
                      plannedSessionId: event.target.value || undefined,
                    })
                  }
                >
                  <option value="">Unplanned activity</option>
                  {data.sessions
                    .filter((item) => item.kind !== "rest")
                    .map((item) => (
                      <option value={item.id} key={item.id}>
                        {item.scheduledDate} · {item.title} ·{" "}
                        {formatMiles(item.plannedDistanceMiles)}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Activity role
                <select
                  disabled={!draft}
                  value={decision.role ?? ""}
                  onChange={(event) =>
                    updateDecision(selected.id, {
                      role: (event.target.value || undefined) as
                        ActivityRole | undefined,
                    })
                  }
                >
                  <option value="">Choose role</option>
                  {roles.map((role) => (
                    <option key={role.value} value={role.value}>
                      {role.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Shoe
                <select
                  disabled={!draft || decision.role === "unrelated"}
                  value={decision.shoeId ?? ""}
                  onChange={(event) =>
                    updateDecision(selected.id, {
                      shoeId: event.target.value || undefined,
                    })
                  }
                >
                  <option value="">Choose shoe</option>
                  {data.shoes
                    .filter((shoe) => !shoe.retired)
                    .map((shoe) => (
                      <option value={shoe.id} key={shoe.id}>
                        {shoe.name} · {formatMiles(shoe.mileageMiles)}
                      </option>
                    ))}
                </select>
              </label>
            </div>

            <div className="bundle-note">
              <Link2 size={18} />
              <div>
                <strong>
                  {session
                    ? `Attached to ${session.title}`
                    : "Unplanned activity"}
                </strong>
                <span>
                  {session
                    ? `Original prescription: ${formatMiles(session.originalDistanceMiles)} on ${formatDate(session.originalDate)}. Confirmation records the result without rewriting it.`
                    : "Choose a primary role to retain this as an unplanned run, or mark it unrelated to exclude it from running metrics."}
                </span>
              </div>
            </div>

            <button
              className="text-button review-details-toggle"
              onClick={() => setDetailsOpen((open) => !open)}
              aria-expanded={detailsOpen}
            >
              {detailsOpen
                ? "Hide activity details"
                : "Review activity details"}
            </button>
            {detailsOpen && (
              <div className="activity-review-details">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Source detail</p>
                    <h3>Pace and recorded laps</h3>
                  </div>
                  <FileClock size={19} />
                </div>
                <PaceTimeline activity={selected} />
                {selected.laps.length ? (
                  <div
                    className="table-scroll"
                    tabIndex={0}
                    aria-label="Recorded laps and classifications"
                  >
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
                            <td>
                              {formatMiles(
                                lap.distanceMeters / METERS_PER_MILE,
                              )}
                            </td>
                            <td>{formatDuration(lap.durationSeconds)}</td>
                            <td>{lap.averageHr ?? "Not recorded"}</td>
                            <td>
                              <select
                                aria-label={`Lap ${index + 1} classification`}
                                disabled={!draft}
                                value={decision.lapRoles[lap.id] ?? "other"}
                                onChange={(event) =>
                                  updateDecision(selected.id, {
                                    lapRoles: {
                                      ...decision.lapRoles,
                                      [lap.id]: event.target.value as LapRole,
                                    },
                                  })
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
                  </div>
                ) : (
                  <div className="empty-state compact-empty">
                    <p>No recorded laps in this source activity.</p>
                  </div>
                )}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
