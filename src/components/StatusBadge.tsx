import type { SessionStatus } from "../domain/types";

const labels: Record<SessionStatus, string> = {
  planned: "Planned",
  completed: "Completed",
  modified: "Modified",
  skipped: "Skipped",
  moved: "Moved",
};

const symbols: Record<SessionStatus, string> = {
  planned: "○",
  completed: "✓",
  modified: "±",
  skipped: "—",
  moved: "→",
};

export function StatusBadge({ status }: { status: SessionStatus }) {
  return (
    <span className={`status status-${status}`}>
      <span aria-hidden="true">{symbols[status]}</span> {labels[status]}
    </span>
  );
}
