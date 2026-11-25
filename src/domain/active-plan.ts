import type { TrainingPlan, PlanDiagnostic } from "./training-plan-contract";
import type {
  AppData,
  PlannedDay,
  PlannedSession,
  PlanQuantity,
} from "./types";

export interface ActivationPreview {
  planId: string;
  versionId: string;
  days: number;
  sessions: number;
  replacingSessions: number;
  diagnostics: PlanDiagnostic[];
}

export function currentPlanSessions(
  data: AppData,
  activationId: string | null,
  effectiveDate: string | null,
): PlannedSession[] {
  return data.sessions.filter(
    (session) =>
      !session.retiredAt &&
      (!activationId ||
        session.id.startsWith(`active:${activationId}:session:`) ||
        (!session.sourceSessionId &&
          effectiveDate !== null &&
          session.scheduledDate >= effectiveDate)),
  );
}

const issue = (
  code: string,
  path: string,
  message: string,
): PlanDiagnostic => ({
  severity: "error",
  code,
  path,
  message,
});

/** Eligibility is stricter than JSON validity: no unknown relationship is guessed. */
export function activationDiagnostics(plan: TrainingPlan): PlanDiagnostic[] {
  const diagnostics: PlanDiagnostic[] = [];
  plan.weeks.forEach((week, wi) =>
    week.days.forEach((day, di) =>
      day.sessions.forEach((session, si) => {
        const path = `/weeks/${wi}/days/${di}/sessions/${si}`;
        if (session.runType === "unspecified")
          diagnostics.push(
            issue(
              "unsupported_active_run_type",
              `${path}/runType`,
              "This run type has no supported active-session behavior.",
            ),
          );
        if (session.role === "unspecified")
          diagnostics.push(
            issue(
              "unknown_session_relationship",
              `${path}/role`,
              "The session relationship must be known before activation.",
            ),
          );
        if (
          plan.schemaVersion === "1.2" &&
          (!session.schedulingPolicy ||
            session.schedulingPolicy === "unspecified")
        )
          diagnostics.push(
            issue(
              "unknown_scheduling_policy",
              `${path}/schedulingPolicy`,
              "The scheduling policy must be resolved before activation.",
            ),
          );
      }),
    ),
  );
  return diagnostics;
}

export function previewActivation(
  plan: TrainingPlan,
  data: AppData,
  effectiveDate: string,
): ActivationPreview {
  const diagnostics = activationDiagnostics(plan);
  if (
    effectiveDate < plan.calendar.startDate ||
    effectiveDate > plan.calendar.endDate
  )
    diagnostics.push(
      issue(
        "outside_plan_calendar",
        "/calendar",
        "Immediate activation requires today's date within the imported plan calendar.",
      ),
    );
  const current = data.sessions.filter(
    (session) => !session.retiredAt && session.scheduledDate >= effectiveDate,
  );
  for (const session of current) {
    if (
      session.revisions.length ||
      session.status !== "planned" ||
      data.activities.some(
        (activity) => activity.plannedSessionId === session.id,
      ) ||
      data.journals.some((entry) => entry.sessionId === session.id) ||
      data.logicalActivities?.activities.some(
        (activity) => activity.versions.at(-1)?.plannedSessionId === session.id,
      )
    )
      diagnostics.push(
        issue(
          "replacement_conflict",
          "",
          `Session ${session.id} has revisions or a recorded result and cannot be replaced automatically.`,
        ),
      );
  }
  return {
    planId: plan.manifest.planId,
    versionId: plan.manifest.versionId,
    days: plan.weeks.reduce(
      (sum, week) =>
        sum + week.days.filter((day) => day.date >= effectiveDate).length,
      0,
    ),
    sessions: plan.weeks.reduce(
      (sum, week) =>
        sum +
        week.days.reduce(
          (count, day) =>
            count + (day.date >= effectiveDate ? day.sessions.length : 0),
          0,
        ),
      0,
    ),
    replacingSessions: current.length,
    diagnostics,
  };
}

function exactMiles(value: PlanQuantity | undefined): number | null {
  if (!value || value.kind !== "exact") return null;
  if (value.unit === "mi") return value.value;
  if (value.unit === "km") return value.value / 1.609344;
  if (value.unit === "m") return value.value / 1609.344;
  return null;
}
function schedulingQuantity(
  value: PlanQuantity | undefined,
): PlanQuantity | undefined {
  if (!value) return undefined;
  return "value" in value
    ? { kind: "exact", value: value.value, unit: value.unit }
    : { kind: "range", min: value.min, max: value.max, unit: value.unit };
}

/** Pure candidate construction. Native persistence must compare and commit atomically. */
export function activationCandidate(
  plan: TrainingPlan,
  data: AppData,
  activationId: string,
  effectiveDate: string,
  changedAt: string,
): AppData {
  const preview = previewActivation(plan, data, effectiveDate);
  if (preview.diagnostics.length)
    throw new Error(`Activation is blocked: ${preview.diagnostics[0].code}`);
  const days: PlannedDay[] = [];
  const sessions: PlannedSession[] = [];
  for (const week of plan.weeks)
    for (const day of week.days) {
      if (day.date < effectiveDate) continue;
      days.push({
        id: `active:${activationId}:day:${day.id}`,
        sourceDayId: day.id,
        sourcePlanId: plan.manifest.planId,
        sourceVersionId: plan.manifest.versionId,
        originalDate: day.date,
        kind: day.kind,
      });
      for (const session of day.sessions) {
        const distance = schedulingQuantity(
          session.distance as PlanQuantity | undefined,
        );
        const duration = schedulingQuantity(
          session.duration as PlanQuantity | undefined,
        );
        const miles = exactMiles(distance);
        sessions.push({
          id: `active:${activationId}:session:${session.id}`,
          sourceKey: `plan:${plan.manifest.planId}:${plan.manifest.versionId}:${session.id}`,
          sourceSessionId: session.id,
          sourceDayId: day.id,
          sourcePlanId: plan.manifest.planId,
          sourceVersionId: plan.manifest.versionId,
          week: week.number,
          originalDate: day.date,
          scheduledDate: day.date,
          originalDistanceMiles: miles,
          plannedDistanceMiles: miles,
          ...(distance && {
            originalDistance: distance,
            plannedDistance: distance,
          }),
          ...(duration && {
            originalDuration: duration,
            plannedDuration: duration,
          }),
          title: session.title,
          kind: session.runType as PlannedSession["kind"],
          instructions: session.coachText.join("\n"),
          guidance: "",
          flexible: session.completionClass === "flexible",
          phase: "",
          status: "planned",
          revisions: [],
        });
      }
    }
  return {
    ...data,
    schemaVersion: data.schemaVersion === 7 ? 7 : 5,
    days: [
      ...(data.days ?? []).map((day) =>
        day.retiredAt || day.originalDate < effectiveDate
          ? day
          : { ...day, retiredAt: changedAt },
      ),
      ...days,
    ],
    sessions: [
      ...data.sessions.map((session) => {
        const migrated =
          data.schemaVersion === 4 || (data.schemaVersion === 7 && !data.days)
            ? {
                ...session,
                originalDistance: {
                  kind: "exact" as const,
                  value: session.originalDistanceMiles!,
                  unit: "mi" as const,
                },
                plannedDistance: {
                  kind: "exact" as const,
                  value: session.plannedDistanceMiles!,
                  unit: "mi" as const,
                },
              }
            : session;
        return migrated.retiredAt || migrated.scheduledDate < effectiveDate
          ? migrated
          : { ...migrated, retiredAt: changedAt };
      }),
      ...sessions,
    ],
  };
}
