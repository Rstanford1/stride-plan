import type { TrainingPlan } from "./training-plan-contract";
import { logicalSessionStatus } from "./logical-activity-accounting";
import type {
  AppData,
  PlannedSession,
  PlanQuantity,
  SessionRevision,
} from "./types";

export interface ProjectedSession {
  id: string;
  sourceSessionId: string | null;
  sourceDayId: string | null;
  sourcePlanId: string | null;
  sourceVersionId: string | null;
  originalDate: string;
  scheduledDate: string;
  originalDistance: PlanQuantity | null;
  plannedDistance: PlanQuantity | null;
  originalDuration: PlanQuantity | null;
  plannedDuration: PlanQuantity | null;
  status: PlannedSession["status"];
  retiredAt: string | null;
  revisions: SessionRevision[];
  role: string | null;
  primarySessionId: string | null;
  source:
    TrainingPlan["weeks"][number]["days"][number]["sessions"][number] | null;
}

export interface ProjectedDay {
  id: string;
  sourceDayId: string | null;
  originalDate: string;
  kind: "training" | "rest" | "unspecified";
  coachText: string[];
  source: TrainingPlan["weeks"][number]["days"][number];
  sessions: ProjectedSession[];
}

export interface ActivePlanProjection {
  planId: string | null;
  versionId: string | null;
  provenance: TrainingPlan["provenance"] | null;
  sourcePlan: TrainingPlan | null;
  preActivationSourceDays: TrainingPlan["weeks"][number]["days"];
  days: ProjectedDay[];
  legacySessions: ProjectedSession[];
  historicalSessions: ProjectedSession[];
}

function prescription(
  session: PlannedSession,
  original: boolean,
): PlanQuantity | null {
  const value = original ? session.originalDistance : session.plannedDistance;
  const miles = original
    ? session.originalDistanceMiles
    : session.plannedDistanceMiles;
  return value
    ? structuredClone(value)
    : miles === null
      ? null
      : { kind: "exact", value: miles, unit: "mi" };
}

function projectedWithoutSource(session: PlannedSession): ProjectedSession {
  return {
    id: session.id,
    sourceSessionId: session.sourceSessionId ?? null,
    sourceDayId: session.sourceDayId ?? null,
    sourcePlanId: session.sourcePlanId ?? null,
    sourceVersionId: session.sourceVersionId ?? null,
    originalDate: session.originalDate,
    scheduledDate: session.scheduledDate,
    originalDistance: prescription(session, true),
    plannedDistance: prescription(session, false),
    originalDuration: session.originalDuration
      ? structuredClone(session.originalDuration)
      : null,
    plannedDuration: session.plannedDuration
      ? structuredClone(session.plannedDuration)
      : null,
    status: session.status,
    retiredAt: session.retiredAt ?? null,
    revisions: structuredClone(session.revisions),
    role: null,
    primarySessionId: null,
    source: null,
  };
}

/** Source and snapshot are inspected only. A draft supplied here is not activation. */
export function projectActivePlan(
  data: AppData,
  activeSource: TrainingPlan | null,
  effectiveDate: string | null = null,
  activationId: string | null = null,
): ActivePlanProjection {
  const sessionsWithStatus = data.sessions.map((session) => ({
    ...session,
    status: logicalSessionStatus(
      session.id,
      session.status,
      data.logicalActivities,
    ),
  }));
  const current = sessionsWithStatus.filter((session) => !session.retiredAt);
  const legacy = current.filter((session) => !session.sourceSessionId);
  const projectedLegacy = legacy.map(projectedWithoutSource);
  const historicalSessions = sessionsWithStatus
    .filter(
      (session) =>
        session.retiredAt ||
        (session.sourceSessionId &&
          (activationId
            ? !session.id.startsWith(`active:${activationId}:session:`)
            : !activeSource ||
              session.sourcePlanId !== activeSource.manifest.planId ||
              session.sourceVersionId !== activeSource.manifest.versionId ||
              (effectiveDate !== null &&
                session.originalDate < effectiveDate))),
    )
    .map(projectedWithoutSource);
  if (!activeSource)
    return {
      planId: null,
      versionId: null,
      provenance: null,
      sourcePlan: null,
      preActivationSourceDays: [],
      days: [],
      legacySessions: projectedLegacy,
      historicalSessions,
    };
  const planId = activeSource.manifest.planId;
  const versionId = activeSource.manifest.versionId;
  const preActivationSourceDays = activeSource.weeks
    .flatMap((week) =>
      week.days.filter(
        (day) => effectiveDate !== null && day.date < effectiveDate,
      ),
    )
    .map((day) => structuredClone(day));
  const days: ProjectedDay[] = [];
  for (const week of activeSource.weeks)
    for (const day of week.days) {
      if (effectiveDate && day.date < effectiveDate) continue;
      const mapped = data.days?.find(
        (item) =>
          !item.retiredAt &&
          (!activationId ||
            item.id === `active:${activationId}:day:${day.id}`) &&
          item.sourceDayId === day.id &&
          item.sourcePlanId === planId &&
          item.sourceVersionId === versionId,
      );
      if (!mapped) throw new Error(`Active day mapping missing: ${day.id}`);
      const sessions = day.sessions.map((sourceSession) => {
        const mappedSession = current.find(
          (item) =>
            item.sourceSessionId === sourceSession.id &&
            (!activationId ||
              item.id ===
                `active:${activationId}:session:${sourceSession.id}`) &&
            item.sourceDayId === day.id &&
            item.sourcePlanId === planId &&
            item.sourceVersionId === versionId,
        );
        if (!mappedSession)
          throw new Error(
            `Active session mapping missing: ${sourceSession.id}`,
          );
        return {
          id: mappedSession.id,
          sourceSessionId: sourceSession.id,
          sourceDayId: day.id,
          sourcePlanId: planId,
          sourceVersionId: versionId,
          originalDate: mappedSession.originalDate,
          scheduledDate: mappedSession.scheduledDate,
          originalDistance: prescription(mappedSession, true),
          plannedDistance: prescription(mappedSession, false),
          originalDuration: mappedSession.originalDuration
            ? structuredClone(mappedSession.originalDuration)
            : null,
          plannedDuration: mappedSession.plannedDuration
            ? structuredClone(mappedSession.plannedDuration)
            : null,
          status: mappedSession.status,
          retiredAt: null,
          revisions: structuredClone(mappedSession.revisions),
          role: sourceSession.role,
          primarySessionId: sourceSession.primarySessionId ?? null,
          source: structuredClone(sourceSession),
        };
      });
      days.push({
        id: mapped.id,
        sourceDayId: day.id,
        originalDate: day.date,
        kind: day.kind,
        coachText: structuredClone(day.coachText),
        source: structuredClone(day),
        sessions,
      });
    }
  return {
    planId,
    versionId,
    provenance: structuredClone(activeSource.provenance),
    sourcePlan: structuredClone(activeSource),
    preActivationSourceDays,
    days,
    legacySessions: projectedLegacy,
    historicalSessions,
  };
}
