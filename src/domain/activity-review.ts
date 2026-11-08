import { reviseSession } from "./rules";
import type {
  Activity,
  ActivityReviewDecision,
  ActivityReviewDraft,
  ActivityReviewSegment,
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

export function findPossibleDuplicates(
  source: FitSourceActivity,
  existingActivities: Activity[],
) {
  const sourceStart = new Date(source.occurredAt).getTime();
  const sourceMiles = source.distanceMeters / METERS_PER_MILE;
  return existingActivities
    .flatMap((activity) => {
      const startDifferenceSeconds =
        Math.abs(new Date(activity.occurredAt).getTime() - sourceStart) / 1000;
      const durationDifference =
        source.durationSeconds === undefined ||
        activity.durationSeconds === undefined
          ? undefined
          : Math.abs(source.durationSeconds - activity.durationSeconds);
      const distanceDifference = Math.abs(sourceMiles - activity.distanceMiles);
      const durationTolerance = Math.max(
        60,
        (source.durationSeconds ?? activity.durationSeconds ?? 0) * 0.02,
      );
      if (
        startDifferenceSeconds > 120 ||
        distanceDifference > Math.max(0.1, sourceMiles * 0.02) ||
        (durationDifference !== undefined &&
          durationDifference > durationTolerance)
      ) {
        return [];
      }
      return [
        {
          candidate: {
            activityId: activity.id,
            comparisonVersion: 1 as const,
            evidence: [
              `Starts ${Math.round(startDifferenceSeconds)} seconds from the existing activity.`,
              `Distance differs by ${distanceDifference.toFixed(2)} mi.`,
              durationDifference === undefined
                ? "One record does not include timer duration."
                : `Timer duration differs by ${Math.round(durationDifference)} seconds.`,
            ],
          },
          score:
            startDifferenceSeconds +
            distanceDifference * 100 +
            (durationDifference ?? 0),
        },
      ];
    })
    .sort(
      (left, right) =>
        left.score - right.score ||
        left.candidate.activityId.localeCompare(right.candidate.activityId),
    )
    .map((item) => item.candidate);
}

export function createActivityReviewDraft(
  batch: FitImportBatch,
  sourceActivities: FitSourceActivity[],
  sessions: PlannedSession[],
  shoes: Shoe[],
  now = new Date().toISOString(),
  existingActivities: Activity[] = [],
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
        segments: [],
        segmentUndoStack: [],
        segmentRedoStack: [],
        duplicateCandidates: findPossibleDuplicates(
          activity,
          existingActivities,
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
    if (decision.duplicateCandidates.length > 0 && !decision.duplicateChoice) {
      issues.push({
        id: `possible-duplicate:${decision.sourceActivityId}`,
        sourceActivityId: decision.sourceActivityId,
        message: "Choose which activity should represent this recorded run.",
      });
    }
    const duplicateChoice = decision.duplicateChoice;
    if (
      duplicateChoice?.kind === "use-existing" &&
      !decision.duplicateCandidates.some(
        (candidate) => candidate.activityId === duplicateChoice.activityId,
      )
    ) {
      issues.push({
        id: `duplicate-choice:${decision.sourceActivityId}`,
        sourceActivityId: decision.sourceActivityId,
        message: "Choose an available existing activity or use the import.",
      });
    }
    if (decision.duplicateChoice?.kind === "use-existing") continue;
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
    if (decision.segments.length > 0) {
      const ordered = [...decision.segments].sort(
        (left, right) => left.startSeconds - right.startSeconds,
      );
      const duration = sourceActivity.durationSeconds;
      if (duration === undefined) {
        issues.push({
          id: `segment-duration:${decision.sourceActivityId}`,
          sourceActivityId: decision.sourceActivityId,
          message: "Segments require a recorded activity duration.",
        });
      } else {
        const tolerance = 0.01;
        if (
          Math.abs(ordered[0].startSeconds) > tolerance ||
          Math.abs(ordered.at(-1)!.endSeconds - duration) > tolerance
        ) {
          issues.push({
            id: `segment-coverage:${decision.sourceActivityId}`,
            sourceActivityId: decision.sourceActivityId,
            message: "Segments must cover the complete recorded duration.",
          });
        }
        for (const [index, segment] of ordered.entries()) {
          if (
            segment.startSeconds < 0 ||
            segment.endSeconds > duration + tolerance ||
            segment.endSeconds - segment.startSeconds <= tolerance
          ) {
            issues.push({
              id: `segment-range:${segment.id}`,
              sourceActivityId: decision.sourceActivityId,
              message: "Every segment must have a positive in-range duration.",
            });
          }
          if (
            index > 0 &&
            Math.abs(ordered[index - 1].endSeconds - segment.startSeconds) >
              tolerance
          ) {
            issues.push({
              id: `segment-order:${segment.id}`,
              sourceActivityId: decision.sourceActivityId,
              message: "Segments cannot overlap or leave time unallocated.",
            });
          }
          if (segment.shoeId && !shoes.has(segment.shoeId)) {
            issues.push({
              id: `segment-shoe:${segment.id}`,
              sourceActivityId: decision.sourceActivityId,
              message: "Choose an available shoe for every segment override.",
            });
          }
        }
      }
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
      decision.duplicateChoice?.kind !== "use-existing" &&
      decision.role !== "unrelated" &&
      decision.plannedSessionId
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

function distanceAtTime(
  activity: FitSourceActivity,
  elapsedSeconds: number,
): number {
  const duration = activity.durationSeconds ?? 0;
  if (elapsedSeconds <= 0) return 0;
  if (duration > 0 && elapsedSeconds >= duration)
    return activity.distanceMeters;
  const samples = activity.samples
    .filter(
      (sample) =>
        sample.elapsedSeconds !== undefined &&
        sample.distanceMeters !== undefined,
    )
    .sort((left, right) => left.elapsedSeconds! - right.elapsedSeconds!);
  if (!samples.length) {
    return duration > 0
      ? activity.distanceMeters * (elapsedSeconds / duration)
      : 0;
  }
  if (elapsedSeconds <= (samples[0].elapsedSeconds ?? 0)) {
    return samples[0].distanceMeters ?? 0;
  }
  for (let index = 1; index < samples.length; index += 1) {
    const left = samples[index - 1];
    const right = samples[index];
    if (elapsedSeconds <= right.elapsedSeconds!) {
      const range = right.elapsedSeconds! - left.elapsedSeconds!;
      const ratio = range ? (elapsedSeconds - left.elapsedSeconds!) / range : 0;
      return (
        left.distanceMeters! +
        (right.distanceMeters! - left.distanceMeters!) * ratio
      );
    }
  }
  return samples.at(-1)?.distanceMeters ?? activity.distanceMeters;
}

export function calculateShoeAllocations(
  decision: ActivityReviewDecision,
  activity: FitSourceActivity,
): Array<{ shoeId: string; distanceMiles: number }> {
  if (decision.role === "unrelated") return [];
  if (!decision.segments.length) {
    return decision.shoeId
      ? [
          {
            shoeId: decision.shoeId,
            distanceMiles: activity.distanceMeters / METERS_PER_MILE,
          },
        ]
      : [];
  }
  const allocations = new Map<string, number>();
  for (const segment of decision.segments) {
    const shoeId = segment.shoeId ?? decision.shoeId;
    if (!shoeId) continue;
    const meters = Math.max(
      0,
      distanceAtTime(activity, segment.endSeconds) -
        distanceAtTime(activity, segment.startSeconds),
    );
    allocations.set(shoeId, (allocations.get(shoeId) ?? 0) + meters);
  }
  return Array.from(allocations, ([shoeId, meters]) => ({
    shoeId,
    distanceMiles: meters / METERS_PER_MILE,
  }));
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
    shoeAllocations: calculateShoeAllocations(decision, sourceActivity),
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
  const projected = draft.decisions.flatMap((decision) => {
    if (decision.duplicateChoice?.kind === "use-existing") return [];
    const source = data.fitSourceActivities.find(
      (activity) => activity.id === decision.sourceActivityId,
    );
    if (!source) throw new Error("The source activity is no longer available.");
    return [projectActivity(decision, source, data, reviewId)];
  });

  const shoeDelta = new Map<string, number>();
  for (const activity of previousActivities) {
    const allocations =
      activity.shoeAllocations ??
      (activity.role !== "unrelated" && activity.shoeId
        ? [{ shoeId: activity.shoeId, distanceMiles: activity.distanceMiles }]
        : []);
    for (const allocation of allocations) {
      shoeDelta.set(
        allocation.shoeId,
        (shoeDelta.get(allocation.shoeId) ?? 0) - allocation.distanceMiles,
      );
    }
  }
  for (const activity of projected) {
    for (const allocation of activity.shoeAllocations ?? []) {
      shoeDelta.set(
        allocation.shoeId,
        (shoeDelta.get(allocation.shoeId) ?? 0) + allocation.distanceMiles,
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
