import type {
  Activity,
  JournalEntry,
  PlannedSession,
  WeeklyMetrics,
} from "./types";
import type { LogicalActivityState } from "./logical-activity";
import { logicalActivityCredits } from "./logical-activity-accounting";

const outcomeTemplate = () => ({
  planned: 0,
  completed: 0,
  modified: 0,
  skipped: 0,
  moved: 0,
});

export function plannedMileageRange(
  sessions: PlannedSession[],
): { min: number; max: number } | null {
  let min = 0;
  let max = 0;
  for (const session of sessions) {
    const quantity = session.plannedDistance;
    if (!quantity && session.plannedDistanceMiles === null) return null;
    const divisor =
      quantity?.unit === "km"
        ? 1.609344
        : quantity?.unit === "m"
          ? 1609.344
          : 1;
    min += quantity
      ? (quantity.kind === "exact" ? quantity.value : quantity.min) / divisor
      : session.plannedDistanceMiles!;
    max += quantity
      ? (quantity.kind === "exact" ? quantity.value : quantity.max) / divisor
      : session.plannedDistanceMiles!;
  }
  return { min, max };
}

function knownPlannedMiles(sessions: PlannedSession[]): number | null {
  const range = plannedMileageRange(sessions);
  return range && range.min === range.max ? range.min : null;
}

export function actualMilesForSession(
  sessionId: string,
  activities: Activity[],
  journals: JournalEntry[],
  logical?: LogicalActivityState,
): number {
  const credits = logicalActivityCredits(logical);
  const ownedActivities = new Set(
    credits.flatMap((credit) => credit.fitActivityIds),
  );
  const ownedJournals = new Set(
    credits.flatMap((credit) => credit.manualSourceIds),
  );
  const attached = activities.filter(
    (activity) =>
      activity.plannedSessionId === sessionId &&
      activity.role !== "unrelated" &&
      !ownedActivities.has(activity.id),
  );
  const legacy =
    attached.length > 0
      ? attached.reduce((sum, activity) => sum + activity.distanceMiles, 0)
      : (journals.find(
          (entry) =>
            entry.sessionId === sessionId && !ownedJournals.has(entry.id),
        )?.actualDistanceMiles ?? 0);
  return (
    legacy +
    credits
      .filter((credit) => credit.plannedSessionId === sessionId)
      .reduce((sum, credit) => sum + (credit.recorded.distanceMiles ?? 0), 0)
  );
}

export function calculateWeeklyMetrics(
  week: number,
  sessions: PlannedSession[],
  activities: Activity[],
  journals: JournalEntry[],
  logical?: LogicalActivityState,
): WeeklyMetrics {
  const credits = logicalActivityCredits(logical);
  const ownedActivities = new Set(
    credits.flatMap((credit) => credit.fitActivityIds),
  );
  const weeklySessions = sessions.filter(
    (session) => session.week === week && !session.retiredAt,
  );
  const runnable = weeklySessions.filter((session) => session.kind !== "rest");
  const core = runnable.filter((session) => !session.flexible);
  const flexible = runnable.filter((session) => session.flexible);
  const actualMiles = weeklySessions.reduce(
    (sum, session) =>
      sum + actualMilesForSession(session.id, activities, journals, logical),
    0,
  );
  const attachedIds = new Set(weeklySessions.map((session) => session.id));
  const weekStart = weeklySessions[0]?.scheduledDate;
  const weekEnd = weeklySessions.at(-1)?.scheduledDate;
  const unplanned =
    !weekStart || !weekEnd
      ? []
      : activities.filter(
          (activity) =>
            !activity.plannedSessionId &&
            !ownedActivities.has(activity.id) &&
            activity.role !== "unrelated" &&
            activity.occurredAt.slice(0, 10) >= weekStart &&
            activity.occurredAt.slice(0, 10) <= weekEnd,
        );
  const outcomes = outcomeTemplate();
  const outcome = (session: PlannedSession) => {
    const associated = credits.filter(
      (credit) => credit.plannedSessionId === session.id,
    );
    if (associated.some((credit) => credit.recorded.outcome === "completed"))
      return "completed" as const;
    if (associated.some((credit) => credit.recorded.outcome === "modified"))
      return "modified" as const;
    return session.status;
  };
  for (const session of runnable) outcomes[outcome(session)] += 1;
  const coreCompleted = core.filter(
    (session) => outcome(session) === "completed",
  ).length;
  const longSessions = weeklySessions.filter(
    (session) => session.kind === "long",
  );
  const runDates = new Set(
    activities
      .filter(
        (activity) =>
          activity.role !== "unrelated" &&
          !ownedActivities.has(activity.id) &&
          (attachedIds.has(activity.plannedSessionId ?? "") ||
            unplanned.includes(activity)),
      )
      .map((activity) => activity.occurredAt.slice(0, 10)),
  );
  for (const credit of credits)
    if (
      attachedIds.has(credit.plannedSessionId ?? "") ||
      (!credit.plannedSessionId &&
        weekStart &&
        weekEnd &&
        credit.assignedDate >= weekStart &&
        credit.assignedDate <= weekEnd)
    )
      runDates.add(credit.assignedDate);
  const unplannedCredits =
    !weekStart || !weekEnd
      ? []
      : credits.filter(
          (credit) =>
            !credit.plannedSessionId &&
            credit.assignedDate >= weekStart &&
            credit.assignedDate <= weekEnd,
        );
  return {
    week,
    corePlannedMiles: knownPlannedMiles(core),
    flexiblePlannedMiles: knownPlannedMiles(flexible),
    corePlannedRange: plannedMileageRange(core),
    flexiblePlannedRange: plannedMileageRange(flexible),
    actualMiles:
      actualMiles +
      unplanned.reduce((sum, activity) => sum + activity.distanceMiles, 0) +
      unplannedCredits.reduce(
        (sum, credit) => sum + (credit.recorded.distanceMiles ?? 0),
        0,
      ),
    coreCompleted,
    coreTotal: core.length,
    coreCompletionRate: core.length ? coreCompleted / core.length : null,
    longRunMiles: longSessions.reduce(
      (max, session) =>
        Math.max(
          max,
          actualMilesForSession(session.id, activities, journals, logical),
        ),
      0,
    ),
    runDays: runDates.size,
    outcomes,
  };
}

export function mileageAdherence(metrics: WeeklyMetrics): number | null {
  return metrics.corePlannedMiles === null || metrics.corePlannedMiles === 0
    ? null
    : metrics.actualMiles / metrics.corePlannedMiles;
}

export function isCutbackWeek(
  week: number,
  sessions: PlannedSession[],
): boolean {
  const current = sessions.filter(
    (session) => session.week === week && !session.retiredAt,
  );
  if (
    current.some((session) => session.phase.toLowerCase().includes("cutback"))
  )
    return true;
  const planned = (targetWeek: number) =>
    knownPlannedMiles(
      sessions.filter(
        (session) =>
          session.week === targetWeek &&
          session.kind !== "rest" &&
          !session.retiredAt,
      ),
    );
  const previous = planned(week - 1);
  const currentPlanned = planned(week);
  return (
    week > 1 &&
    previous !== null &&
    currentPlanned !== null &&
    previous > 0 &&
    currentPlanned <= previous * 0.9
  );
}
