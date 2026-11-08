import { ClipboardCheck, History, MoveRight, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { useAppData } from "../data/app-context";
import type { PlannedSession } from "../domain/types";
import { formatDate, formatMiles } from "../utils/format";
import { Modal } from "../components/Modal";
import { PlanEditForm } from "../components/PlanEditForm";
import { RunEntryWorkflow } from "../components/RunEntryWorkflow";
import { StatusBadge } from "../components/StatusBadge";

export function PlanScreen() {
  const { data, saveSession } = useAppData();
  const [week, setWeek] = useState(1);
  const [editing, setEditing] = useState<PlannedSession | null>(null);
  const [creating, setCreating] = useState(false);
  const [moving, setMoving] = useState<PlannedSession | null>(null);
  const [reviewing, setReviewing] = useState<PlannedSession | null>(null);
  const [moveDate, setMoveDate] = useState("");
  const maxWeek = Math.max(...data.sessions.map((session) => session.week));
  const sessions = data.sessions.filter((session) => session.week === week);
  const total = sessions.reduce(
    (sum, session) => sum + session.plannedDistanceMiles,
    0,
  );

  return (
    <div className="screen">
      <header className="page-header">
        <div>
          <p className="eyebrow">{maxWeek}-week plan</p>
          <h1>Weekly plan</h1>
          <p>Changes keep the original prescription and session identity.</p>
        </div>
        <button className="button secondary" onClick={() => setCreating(true)}>
          <Plus size={17} /> Add session
        </button>
      </header>
      <div className="toolbar">
        <label>
          Week
          <select
            value={week}
            onChange={(event) => setWeek(Number(event.target.value))}
          >
            {Array.from({ length: maxWeek }, (_, index) => (
              <option key={index + 1} value={index + 1}>
                Week {index + 1}
              </option>
            ))}
          </select>
        </label>
        <span className="phase-label">{sessions[0]?.phase}</span>
        <span className="toolbar-summary">{formatMiles(total)} planned</span>
      </div>
      <div className="plan-table-wrap">
        <table className="data-table plan-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Session</th>
              <th>Guidance</th>
              <th>Miles</th>
              <th>Status</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => (
              <tr key={session.id}>
                <td>
                  <strong>
                    {new Date(
                      `${session.scheduledDate}T12:00:00`,
                    ).toLocaleDateString("en-US", { weekday: "short" })}
                  </strong>
                  <span>{formatDate(session.scheduledDate)}</span>
                  {session.scheduledDate !== session.originalDate && (
                    <small>Originally {formatDate(session.originalDate)}</small>
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
                  {formatMiles(session.plannedDistanceMiles)}
                  {session.plannedDistanceMiles !==
                    session.originalDistanceMiles && (
                    <small>
                      Original {formatMiles(session.originalDistanceMiles)}
                    </small>
                  )}
                </td>
                <td>
                  <StatusBadge status={session.status} />
                </td>
                <td>
                  <div className="row-actions">
                    {session.kind !== "rest" && (
                      <button
                        className="icon-button"
                        aria-label={`Log result for ${session.title} on ${formatDate(session.scheduledDate)}`}
                        title="Log result"
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
                    <button
                      className="icon-button"
                      aria-label={`Move ${session.title}`}
                      onClick={() => {
                        setMoving(session);
                        setMoveDate(session.scheduledDate);
                      }}
                    >
                      <MoveRight size={17} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section className="revision-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Traceable changes</p>
            <h2>Revision history</h2>
          </div>
          <History size={20} />
        </div>
        {sessions.flatMap((session) =>
          session.revisions.map((revision) => ({ session, revision })),
        ).length === 0 ? (
          <div className="empty-state">
            <p>No changes in this week.</p>
            <span>
              Moves and edits will appear here with the original value.
            </span>
          </div>
        ) : (
          <ul className="revision-list">
            {sessions.flatMap((session) =>
              session.revisions.map((revision) => (
                <li key={revision.id}>
                  <strong>{session.title}</strong>
                  <span>
                    {revision.field}: {String(revision.from)} →{" "}
                    {String(revision.to)}
                  </span>
                  <small>{revision.reason}</small>
                </li>
              )),
            )}
          </ul>
        )}
      </section>
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
      {reviewing && (
        <Modal
          title={`Log result · ${reviewing.title} · ${formatDate(reviewing.scheduledDate)}`}
          onClose={() => setReviewing(null)}
        >
          <RunEntryWorkflow
            session={reviewing}
            onSaved={() => setReviewing(null)}
            onCancel={() => setReviewing(null)}
            initialMethod="manual"
          />
        </Modal>
      )}
      {creating && (
        <Modal title="Add planned session" onClose={() => setCreating(false)}>
          <PlanEditForm week={week} onSaved={() => setCreating(false)} />
        </Modal>
      )}
      {moving && (
        <Modal title={`Move · ${moving.title}`} onClose={() => setMoving(null)}>
          <form
            className="form-grid"
            onSubmit={(event) => {
              event.preventDefault();
              saveSession(
                moving.id,
                { scheduledDate: moveDate },
                "Session moved",
              );
              setMoving(null);
            }}
          >
            <p className="full form-explainer">
              Moving this session preserves its identity and does not create a
              skip.
            </p>
            <label className="full">
              New date
              <input
                type="date"
                value={moveDate}
                onChange={(event) => setMoveDate(event.target.value)}
                required
              />
            </label>
            <div className="form-actions full">
              <button className="button primary">Move session</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
