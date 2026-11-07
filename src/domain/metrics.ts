import type {
  Activity,
  JournalEntry,
  PlannedSession,
  WeeklyMetrics,
} from "./types";

const outcomeTemplate = () => ({
  planned: 0,
  completed: 0,
  modified: 0,
  skipped: 0,
  moved: 0,
});

export function actualMilesForSession(
  sessionId: string,
  activities: Activity[],
  journals: JournalEntry[],
): number {
  const attached = activities.filter(
    (activity) =>
      activity.plannedSessionId === sessionId && activity.role !== "unrelated",
  );
  if (attached.length > 0)
    return attached.reduce((sum, activity) => sum + activity.distanceMiles, 0);
  return (
    journals.find((entry) => entry.sessionId === sessionId)
      ?.actualDistanceMiles ?? 0
  );
}

export function calculateWeeklyMetrics(
  week: number,
  sessions: PlannedSession[],
  activities: Activity[],
  journals: JournalEntry[],
): WeeklyMetrics {
  const weeklySessions = sessions.filter((session) => session.week === week);
  const runnable = weeklySessions.filter((session) => session.kind !== "rest");
  const core = runnable.filter((session) => !session.flexible);
  const flexible = runnable.filter((session) => session.flexible);
  const actualMiles = weeklySessions.reduce(
    (sum, session) =>
      sum + actualMilesForSession(session.id, activities, journals),
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
            activity.role !== "unrelated" &&
            activity.occurredAt.slice(0, 10) >= weekStart &&
            activity.occurredAt.slice(0, 10) <= weekEnd,
        );
  const outcomes = outcomeTemplate();
  for (const session of runnable) outcomes[session.status] += 1;
  const coreCompleted = core.filter(
    (session) => session.status === "completed",
  ).length;
  const longSessions = weeklySessions.filter(
    (session) => session.kind === "long",
  );
  const runDates = new Set(
    activities
      .filter(
        (activity) =>
          activity.role !== "unrelated" &&
          (attachedIds.has(activity.plannedSessionId ?? "") ||
            unplanned.includes(activity)),
      )
      .map((activity) => activity.occurredAt.slice(0, 10)),
  );
  return {
    week,
    corePlannedMiles: core.reduce(
      (sum, session) => sum + session.plannedDistanceMiles,
      0,
    ),
    flexiblePlannedMiles: flexible.reduce(
      (sum, session) => sum + session.plannedDistanceMiles,
      0,
    ),
    actualMiles:
      actualMiles +
      unplanned.reduce((sum, activity) => sum + activity.distanceMiles, 0),
    coreCompleted,
    coreTotal: core.length,
    coreCompletionRate: core.length ? coreCompleted / core.length : null,
    longRunMiles: longSessions.reduce(
      (max, session) =>
        Math.max(max, actualMilesForSession(session.id, activities, journals)),
      0,
    ),
    runDays: runDates.size,
    outcomes,
  };
}

export function mileageAdherence(metrics: WeeklyMetrics): number | null {
  return metrics.corePlannedMiles === 0
    ? null
    : metrics.actualMiles / metrics.corePlannedMiles;
}

export function isCutbackWeek(
  week: number,
  sessions: PlannedSession[],
): boolean {
  const current = sessions.filter((session) => session.week === week);
  if (
    current.some((session) => session.phase.toLowerCase().includes("cutback"))
  )
    return true;
  const planned = (targetWeek: number) =>
    sessions
      .filter(
        (session) => session.week === targetWeek && session.kind !== "rest",
      )
      .reduce((sum, session) => sum + session.plannedDistanceMiles, 0);
  const previous = planned(week - 1);
  return week > 1 && previous > 0 && planned(week) <= previous * 0.9;
}
