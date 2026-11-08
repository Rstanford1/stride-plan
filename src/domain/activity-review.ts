import { reviseSession } from "./rules";
import type {
  Activity,
  ActivityReviewDecision,
  ActivityReviewDraft,
  AppData,
  FitImportBatch,
  FitSourceActivity,
  PlannedSession,
  SessionKind,
  Shoe,
} from "./types";

const METERS_PER_MILE = 1609.344;

export interface ActivityReviewIssue {
  id: string;
  message: string;
  sourceActivityId?: string;
}

interface MatchSuggestion {
  session?: PlannedSession;
  evidence: string[];
  score: number;
}

function dateDistance(left: string, right: string): number {
  return Math.round(
    Math.abs(
      new Date(`${left}T12:00:00`).getTime() -
        new Date(`${right}T12:00:00`).getTime(),
    ) / 86_400_000,
  );
}

function roleForKind(kind: SessionKind) {
  if (kind === "long") return "primary-long" as const;
  if (kind === "workout") return "primary-workout" as const;
  return "primary-easy" as const;
}

export function suggestSessionMatch(
  activity: FitSourceActivity,
  sessions: PlannedSession[],
): MatchSuggestion {
  const activityDate = activity.localDate ?? activity.occurredAt.slice(0, 10);
  const distanceMiles = activity.distanceMeters / METERS_PER_MILE;
  const candidates = sessions
    .filter(
      (session) =>
        session.kind !== "rest" &&
        dateDistance(activityDate, session.scheduledDate) <= 2,
    )
    .map((session) => {
      const days = dateDistance(activityDate, session.scheduledDate);
      const distanceDifference = Math.abs(
        distanceMiles - session.plannedDistanceMiles,
      );
      return {
        session,
        score: days * 100 + distanceDifference,
        evidence: [
          days === 0
            ? "The activity and plan share the same calendar date."
            : `The activity is ${days} day${days === 1 ? "" : "s"} from the planned date.`,
          `Recorded ${distanceMiles.toFixed(1)} mi versus ${session.plannedDistanceMiles.toFixed(1)} mi planned.`,
          `The source sport is ${activity.sport}.`,
        ],
      };
    })
    .sort((left, right) => left.score - right.score);
  if (!candidates[0]) {
    return {
      score: Number.POSITIVE_INFINITY,
      evidence: ["No runnable planned session is within two days."],
    };
  }
  if (
    candidates[1] &&
    Math.abs(candidates[0].score - candidates[1].score) < 0.01
  ) {
    return {
      score: candidates[0].score,
      evidence: [
        "Two planned sessions have equally strong date and distance evidence.",
      ],
    };
  }
  return candidates[0];
}

function activitiesForBatch(
  batch: FitImportBatch,
  activities: FitSourceActivity[],
): FitSourceActivity[] {
  const activityIds = new Set(
    batch.sourceResults.flatMap((result) => result.activityIds),
  );
  return activities.filter((activity) => activityIds.has(activity.id));
}

function defaultShoe(shoes: Shoe[]): Shoe | undefined {
  return (
    shoes.find((shoe) => shoe.isDefault && !shoe.retired) ??
    shoes.find((shoe) => !shoe.retired)
  );
}

export function createActivityReviewDraft(
  batch: FitImportBatch,
  sourceActivities: FitSourceActivity[],
  sessions: PlannedSession[],
  shoes: Shoe[],
  now = new Date().toISOString(),
): ActivityReviewDraft {
  const activities = activitiesForBatch(batch, sourceActivities);
  const suggestions = activities.map((activity) => ({
    activity,
    match: suggestSessionMatch(activity, sessions),
  }));
  const primaryBySession = new Map<string, string>();
  for (const suggestion of suggestions) {
    const sessionId = suggestion.match.session?.id;
    if (!sessionId) continue;
    const currentId = primaryBySession.get(sessionId);
    const current = suggestions.find((item) => item.activity.id === currentId);
    if (!current || suggestion.match.score < current.match.score) {
      primaryBySession.set(sessionId, suggestion.activity.id);
    }
  }
  const shoe = defaultShoe(shoes);
  const decisions: ActivityReviewDecision[] = suggestions.map(
    ({ activity, match }) => {
      const session = match.session;
      const isPrimary = session
        ? primaryBySession.get(session.id) === activity.id
        : false;
      return {
        sourceActivityId: activity.id,
        plannedSessionId: session?.id,
        role: session
          ? isPrimary
            ? roleForKind(session.kind)
            : "supporting-recovery"
          : undefined,
        isPrimary,
        shoeId: session ? shoe?.id : undefined,
        lapRoles: Object.fromEntries(
          activity.laps.map((lap) => [lap.id, "other" as const]),
        ),
        suggestionEvidence: match.evidence,
      };
    },
  );
  return {
    id: `review-draft:${batch.id}`,
    batchId: batch.id,
    createdAt: now,
    updatedAt: now,
    selectedSourceActivityId: activities[0]?.id,
    decisions,
  };
}

export function createRevisionDraft(
  data: AppData,
  batchId: string,
  now = new Date().toISOString(),
): ActivityReviewDraft | undefined {
  const confirmation = data.activityReviewConfirmations
    .filter((item) => item.batchId === batchId)
    .sort((left, right) => right.revisionNumber - left.revisionNumber)[0];
  if (!confirmation) return undefined;
  return {
    id: `review-draft:${batchId}`,
    batchId,
    createdAt: now,
    updatedAt: now,
    selectedSourceActivityId: confirmation.decisions[0]?.sourceActivityId,
    decisions: structuredClone(confirmation.decisions),
  };
}

export function validateActivityReview(
  draft: ActivityReviewDraft,
  data: Pick<
    AppData,
    | "fitSourceActivities"
    | "fitSources"
    | "fitImportBatches"
    | "sessions"
    | "shoes"
  >,
): ActivityReviewIssue[] {
  const issues: ActivityReviewIssue[] = [];
  const batch = data.fitImportBatches.find((item) => item.id === draft.batchId);
  const expectedActivityIds = new Set(
    batch?.sourceResults.flatMap((result) => result.activityIds) ?? [],
  );
  const decisionCounts = new Map<string, number>();
  for (const decision of draft.decisions) {
    decisionCounts.set(
      decision.sourceActivityId,
      (decisionCounts.get(decision.sourceActivityId) ?? 0) + 1,
    );
  }
  for (const sourceActivityId of expectedActivityIds) {
    if (!decisionCounts.has(sourceActivityId)) {
      issues.push({
        id: `missing-decision:${sourceActivityId}`,
        sourceActivityId,
        message: "Review this imported activity before confirming.",
      });
    }
  }
  for (const [sourceActivityId, count] of decisionCounts) {
    if (count > 1) {
      issues.push({
        id: `duplicate-decision:${sourceActivityId}`,
        sourceActivityId,
        message: "The imported activity has more than one review decision.",
      });
    }
  }
  if (!batch || expectedActivityIds.size === 0) {
    issues.push({
      id: "empty-batch",
      message: "This import batch has no reviewable activities.",
    });
  }
  const sourceIds = new Set(
    data.fitSourceActivities.map((activity) => activity.id),
  );
  const sessions = new Set(data.sessions.map((session) => session.id));
  const shoes = new Set(data.shoes.map((shoe) => shoe.id));
  for (const decision of draft.decisions) {
    const sourceActivity = data.fitSourceActivities.find(
      (activity) => activity.id === decision.sourceActivityId,
    );
    if (!sourceIds.has(decision.sourceActivityId) || !sourceActivity) {
      issues.push({
        id: `missing-source:${decision.sourceActivityId}`,
        sourceActivityId: decision.sourceActivityId,
        message: "The source activity is no longer available.",
      });
      continue;
    }
    const source = data.fitSources.find(
      (item) => item.id === sourceActivity.sourceId,
    );
    if (
      source?.preservationStatus === "failed" ||
      source?.preservationStatus === "pending"
    ) {
      issues.push({
        id: `preservation:${decision.sourceActivityId}`,
        sourceActivityId: decision.sourceActivityId,
        message:
          source.preservationStatus === "failed"
            ? "Re-import the original FIT file to retry source preservation before confirming."
            : "Wait for source-file preservation before confirming.",
      });
    }
    if (!decision.role) {
      issues.push({
        id: `role:${decision.sourceActivityId}`,
        sourceActivityId: decision.sourceActivityId,
        message: "Choose what this activity represents.",
      });
    }
    if (decision.plannedSessionId && !sessions.has(decision.plannedSessionId)) {
      issues.push({
        id: `session:${decision.sourceActivityId}`,
        sourceActivityId: decision.sourceActivityId,
        message: "Choose an available planned session.",
      });
    }
    if (
      decision.role !== "unrelated" &&
      (!decision.shoeId || !shoes.has(decision.shoeId))
    ) {
      issues.push({
        id: `shoe:${decision.sourceActivityId}`,
        sourceActivityId: decision.sourceActivityId,
        message: "Assign a shoe before confirming this activity.",
      });
    }
    const primaryRole = decision.role?.startsWith("primary-") ?? false;
    if (primaryRole !== decision.isPrimary) {
      issues.push({
        id: `primary-role:${decision.sourceActivityId}`,
        sourceActivityId: decision.sourceActivityId,
        message: "Primary status and the selected activity role must agree.",
      });
    }
    if (
      decision.role !== "unrelated" &&
      !decision.isPrimary &&
      !decision.plannedSessionId
    ) {
      issues.push({
        id: `supporting-match:${decision.sourceActivityId}`,
        sourceActivityId: decision.sourceActivityId,
        message: "Attach a supporting activity to a planned session.",
      });
    }
  }
  const sessionIds = new Set(
    draft.decisions.flatMap((decision) =>
      decision.role !== "unrelated" && decision.plannedSessionId
        ? [decision.plannedSessionId]
        : [],
    ),
  );
  for (const sessionId of sessionIds) {
    const primaries = draft.decisions.filter(
      (decision) =>
        decision.plannedSessionId === sessionId && decision.isPrimary,
    );
    if (primaries.length !== 1) {
      issues.push({
        id: `primary:${sessionId}`,
        message:
          primaries.length === 0
            ? "Choose one primary activity for the planned session."
            : "Only one activity can be primary for the planned session.",
      });
    }
  }
  return issues;
}

function projectActivity(
  decision: ActivityReviewDecision,
  sourceActivity: FitSourceActivity,
  data: AppData,
  reviewId: string,
): Activity {
  const source = data.fitSources.find(
    (item) => item.id === sourceActivity.sourceId,
  );
  const bundleKey =
    decision.plannedSessionId ?? `unplanned:${sourceActivity.id}`;
  return {
    id: `activity:${sourceActivity.id}`,
    sourceActivityId: sourceActivity.id,
    reviewId,
    sourceHash: source?.sourceHash ?? sourceActivity.sourceId,
    fileName: source?.originalFileName ?? "Imported FIT activity",
    occurredAt: sourceActivity.occurredAt,
    distanceMiles: sourceActivity.distanceMeters / METERS_PER_MILE,
    durationSeconds: sourceActivity.durationSeconds,
    averageHr: sourceActivity.averageHr,
    role: decision.role ?? "unrelated",
    plannedSessionId: decision.plannedSessionId,
    bundleId: `bundle:${reviewId}:${bundleKey}`,
    isPrimary: decision.isPrimary,
    shoeId: decision.shoeId,
    importedAt: source?.importedAt ?? new Date().toISOString(),
    laps: sourceActivity.laps.map((lap) => ({
      id: `activity-lap:${lap.id}`,
      distanceMiles: lap.distanceMeters / METERS_PER_MILE,
      durationSeconds: lap.durationSeconds,
      averageHr: lap.averageHr,
      role: decision.lapRoles[lap.id] ?? "other",
    })),
  };
}

export function confirmActivityReview(
  data: AppData,
  draft: ActivityReviewDraft,
  confirmedAt = new Date().toISOString(),
): AppData {
  const issues = validateActivityReview(draft, data);
  if (issues.length) {
    throw new Error(issues[0].message);
  }
  const previousConfirmations = data.activityReviewConfirmations.filter(
    (item) => item.batchId === draft.batchId,
  );
  const previousReviewIds = new Set(
    previousConfirmations.map((item) => item.id),
  );
  const previousActivities = data.activities.filter(
    (activity) => activity.reviewId && previousReviewIds.has(activity.reviewId),
  );
  const retainedActivities = data.activities.filter(
    (activity) =>
      !activity.reviewId || !previousReviewIds.has(activity.reviewId),
  );
  const revisionNumber =
    Math.max(0, ...previousConfirmations.map((item) => item.revisionNumber)) +
    1;
  const reviewId = `review:${draft.batchId}:${revisionNumber}`;
  const projected = draft.decisions.map((decision) => {
    const source = data.fitSourceActivities.find(
      (activity) => activity.id === decision.sourceActivityId,
    );
    if (!source) throw new Error("The source activity is no longer available.");
    return projectActivity(decision, source, data, reviewId);
  });

  const shoeDelta = new Map<string, number>();
  for (const activity of previousActivities) {
    if (activity.role !== "unrelated" && activity.shoeId) {
      shoeDelta.set(
        activity.shoeId,
        (shoeDelta.get(activity.shoeId) ?? 0) - activity.distanceMiles,
      );
    }
  }
  for (const activity of projected) {
    if (activity.role !== "unrelated" && activity.shoeId) {
      shoeDelta.set(
        activity.shoeId,
        (shoeDelta.get(activity.shoeId) ?? 0) + activity.distanceMiles,
      );
    }
  }
  const nextActivities = [...retainedActivities, ...projected];
  const previouslyCompletedSessions = new Set(
    previousActivities.flatMap((activity) =>
      activity.isPrimary && activity.plannedSessionId
        ? [activity.plannedSessionId]
        : [],
    ),
  );
  const newlyCompletedSessions = new Set(
    projected.flatMap((activity) =>
      activity.isPrimary && activity.plannedSessionId
        ? [activity.plannedSessionId]
        : [],
    ),
  );
  const sessions = data.sessions.map((session) => {
    if (newlyCompletedSessions.has(session.id)) {
      return reviseSession(
        session,
        { status: "completed" },
        "Activity Review confirmation",
        confirmedAt,
      );
    }
    if (
      previouslyCompletedSessions.has(session.id) &&
      !nextActivities.some(
        (activity) =>
          activity.plannedSessionId === session.id && activity.isPrimary,
      )
    ) {
      return reviseSession(
        session,
        { status: "planned" },
        "Activity Review revision",
        confirmedAt,
      );
    }
    return session;
  });
  return {
    ...data,
    sessions,
    activities: nextActivities,
    shoes: data.shoes.map((shoe) => ({
      ...shoe,
      mileageMiles: Math.max(
        0,
        shoe.mileageMiles + (shoeDelta.get(shoe.id) ?? 0),
      ),
    })),
    activityReviewDrafts: data.activityReviewDrafts.filter(
      (item) => item.id !== draft.id,
    ),
    activityReviewConfirmations: [
      ...data.activityReviewConfirmations,
      {
        id: reviewId,
        batchId: draft.batchId,
        bundleId: `bundle:${reviewId}`,
        revisionNumber,
        confirmedAt,
        decisions: structuredClone(draft.decisions),
      },
    ],
  };
}
