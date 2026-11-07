import type { PlannedSession, SessionStatus } from "./types";

export interface SessionUpdate {
  scheduledDate?: string;
  plannedDistanceMiles?: number;
  title?: string;
  kind?: PlannedSession["kind"];
  instructions?: string;
  guidance?: string;
  flexible?: boolean;
  phase?: string;
  status?: SessionStatus;
  outcomeNote?: string;
  replacementDescription?: string;
}

export function reviseSession(
  session: PlannedSession,
  update: SessionUpdate,
  reason: string,
  changedAt = new Date().toISOString(),
): PlannedSession {
  const next = { ...session, revisions: [...session.revisions] };
  for (const [field, value] of Object.entries(update)) {
    const key = field as keyof SessionUpdate;
    const previous = next[key as keyof PlannedSession] as
      string | number | boolean | null | undefined;
    if (value === undefined || previous === value) continue;
    next.revisions.push({
      id: `${session.id}:${next.revisions.length + 1}`,
      changedAt,
      field,
      from: previous ?? null,
      to: value,
      reason,
    });
    (next as unknown as Record<string, unknown>)[field] = value;
  }
  if (
    update.scheduledDate &&
    update.scheduledDate !== session.originalDate &&
    update.status === undefined
  ) {
    next.status = "moved";
  }
  return next;
}

export function validateSessionUpdate(
  session: PlannedSession,
  update: SessionUpdate,
): string[] {
  const errors: string[] = [];
  if (
    update.plannedDistanceMiles !== undefined &&
    update.plannedDistanceMiles < 0
  ) {
    errors.push("Planned distance cannot be negative.");
  }
  if (update.status === "completed" && session.kind === "rest") {
    errors.push("Rest days are not completed runs.");
  }
  if (update.status === "modified" && !update.outcomeNote?.trim()) {
    errors.push("Describe what changed for a modified session.");
  }
  if (update.replacementDescription && update.status !== "modified") {
    errors.push("A replacement must use Modified status.");
  }
  return errors;
}
