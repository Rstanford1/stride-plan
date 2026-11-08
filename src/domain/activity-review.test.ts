import { describe, expect, it } from "vitest";
import { createInitialData } from "./seed";
import {
  confirmActivityReview,
  createActivityReviewDraft,
  validateActivityReview,
} from "./activity-review";
import type { FitImportBatch, FitSourceActivity } from "./types";

function addImportedActivity() {
  const data = createInitialData();
  const sourceActivity: FitSourceActivity = {
    id: "fit-activity:test:0",
    sourceId: "fit-source:test",
    sourceIndex: 0,
    occurredAt: "2026-11-08T15:00:00.000Z",
    localDate: "2026-11-08",
    sport: "running",
    distanceMeters: 11_265.408,
    durationSeconds: 3_600,
    averageHr: 151,
    recordCount: 2,
    laps: [
      {
        id: "fit-lap:test:0",
        sourceIndex: 0,
        distanceMeters: 11_265.408,
        durationSeconds: 3_600,
        averageHr: 151,
      },
    ],
    samples: [],
  };
  const batch: FitImportBatch = {
    id: "fit-batch:test",
    createdAt: "2026-11-08T16:00:00.000Z",
    completedAt: "2026-11-08T16:00:01.000Z",
    sourceResults: [
      {
        sourceId: "fit-source:test",
        status: "decoded",
        activityIds: [sourceActivity.id],
      },
    ],
  };
  data.fitSources.push({
    id: "fit-source:test",
    sourceHash: "a".repeat(64),
    originalFileName: "generated.fit",
    byteLength: 100,
    importedAt: batch.createdAt,
    decoderId: "test",
    decoderVersion: "1",
    preservationStatus: "verified",
  });
  data.fitSourceActivities.push(sourceActivity);
  data.fitImportBatches.push(batch);
  return { data, sourceActivity, batch };
}

describe("Activity Review", () => {
  it("creates reversible suggestions without changing confirmed data", () => {
    const { data, batch, sourceActivity } = addImportedActivity();
    const draft = createActivityReviewDraft(
      batch,
      data.fitSourceActivities,
      data.sessions,
      data.shoes,
      "2026-11-08T16:01:00.000Z",
    );
    expect(draft.decisions[0]).toMatchObject({
      sourceActivityId: sourceActivity.id,
      plannedSessionId: "plan-w1-d7",
      role: "primary-long",
      isPrimary: true,
      shoeId: "shoe-daily-trainer",
    });
    expect(draft.decisions[0].suggestionEvidence).not.toHaveLength(0);
    expect(data.activities).toEqual([]);
    expect(data.shoes[0].mileageMiles).toBe(0);
    expect(data.sessions[6].status).toBe("planned");
  });

  it("blocks confirmation when a required shoe is missing", () => {
    const { data, batch } = addImportedActivity();
    const draft = createActivityReviewDraft(
      batch,
      data.fitSourceActivities,
      data.sessions,
      data.shoes,
    );
    draft.decisions[0].shoeId = undefined;
    expect(validateActivityReview(draft, data)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining("shoe") }),
      ]),
    );
    expect(() => confirmActivityReview(data, draft)).toThrow("shoe");
  });

  it("blocks an incomplete draft that omits an imported activity", () => {
    const { data, batch } = addImportedActivity();
    const draft = createActivityReviewDraft(
      batch,
      data.fitSourceActivities,
      data.sessions,
      data.shoes,
    );
    draft.decisions = [];
    expect(validateActivityReview(draft, data)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "Review this imported activity before confirming.",
        }),
      ]),
    );
  });

  it("atomically confirms the projection, plan result, and shoe mileage", () => {
    const { data, batch, sourceActivity } = addImportedActivity();
    const draft = createActivityReviewDraft(
      batch,
      data.fitSourceActivities,
      data.sessions,
      data.shoes,
    );
    data.activityReviewDrafts.push(draft);
    const confirmed = confirmActivityReview(
      data,
      draft,
      "2026-11-08T17:00:00.000Z",
    );
    expect(confirmed.activities[0]).toMatchObject({
      sourceActivityId: sourceActivity.id,
      plannedSessionId: "plan-w1-d7",
      role: "primary-long",
      isPrimary: true,
      shoeId: "shoe-daily-trainer",
    });
    expect(confirmed.sessions[6].status).toBe("completed");
    expect(confirmed.shoes[0].mileageMiles).toBeCloseTo(7);
    expect(confirmed.activityReviewDrafts).toEqual([]);
    expect(confirmed.activityReviewConfirmations[0].revisionNumber).toBe(1);
    expect(data.activities).toEqual([]);
    expect(data.sessions[6].status).toBe("planned");
  });

  it("replaces a prior review projection without double-counting mileage", () => {
    const { data, batch } = addImportedActivity();
    const firstDraft = createActivityReviewDraft(
      batch,
      data.fitSourceActivities,
      data.sessions,
      data.shoes,
    );
    const first = confirmActivityReview(data, firstDraft);
    const revision = {
      ...firstDraft,
      id: `revision:${firstDraft.id}`,
      decisions: firstDraft.decisions.map((decision) => ({
        ...decision,
        suggestionEvidence: [...decision.suggestionEvidence],
        lapRoles: { ...decision.lapRoles },
      })),
    };
    const second = confirmActivityReview(first, revision);
    expect(second.activities).toHaveLength(1);
    expect(second.shoes[0].mileageMiles).toBeCloseTo(7);
    expect(second.activityReviewConfirmations).toHaveLength(2);
    expect(second.activityReviewConfirmations[1].revisionNumber).toBe(2);
  });

  it("validates complete segment coverage and allocates mileage by segment shoe", () => {
    const { data, batch } = addImportedActivity();
    data.shoes[1].mileageMiles = 10;
    const draft = createActivityReviewDraft(
      batch,
      data.fitSourceActivities,
      data.sessions,
      data.shoes,
    );
    draft.decisions[0].segments = [
      {
        id: "segment-1",
        startSeconds: 0,
        endSeconds: 1_800,
        role: "warm-up",
      },
      {
        id: "segment-2",
        startSeconds: 1_800,
        endSeconds: 3_600,
        role: "work",
        shoeId: "shoe-workout",
      },
    ];
    expect(validateActivityReview(draft, data)).toEqual([]);
    const confirmed = confirmActivityReview(data, draft);
    expect(confirmed.activities[0].shoeAllocations?.[0].shoeId).toBe(
      "shoe-daily-trainer",
    );
    expect(
      confirmed.activities[0].shoeAllocations?.[0].distanceMiles,
    ).toBeCloseTo(3.5);
    expect(confirmed.activities[0].shoeAllocations?.[1].shoeId).toBe(
      "shoe-workout",
    );
    expect(
      confirmed.activities[0].shoeAllocations?.[1].distanceMiles,
    ).toBeCloseTo(3.5);
    expect(confirmed.shoes[0].mileageMiles).toBeCloseTo(3.5);
    expect(confirmed.shoes[1].mileageMiles).toBeCloseTo(13.5);

    draft.decisions[0].segments[1].startSeconds = 1_900;
    expect(validateActivityReview(draft, data)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "Segments cannot overlap or leave time unallocated.",
        }),
      ]),
    );
  });

  it("requires an explicit choice for a possible duplicate", () => {
    const { data, batch, sourceActivity } = addImportedActivity();
    data.activities.push({
      id: "existing-activity",
      sourceHash: "existing",
      fileName: "existing.fit",
      occurredAt: sourceActivity.occurredAt,
      distanceMiles: 7,
      durationSeconds: 3_600,
      role: "primary-long",
      plannedSessionId: "plan-w1-d7",
      isPrimary: true,
      importedAt: "2026-11-08T15:30:00.000Z",
      laps: [],
    });
    const draft = createActivityReviewDraft(
      batch,
      data.fitSourceActivities,
      data.sessions,
      data.shoes,
      "2026-11-08T16:01:00.000Z",
      data.activities,
    );
    expect(draft.decisions[0].duplicateCandidates[0].activityId).toBe(
      "existing-activity",
    );
    expect(validateActivityReview(draft, data)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "Choose which activity should represent this recorded run.",
        }),
      ]),
    );
    draft.decisions[0].duplicateChoice = {
      kind: "use-existing",
      activityId: "existing-activity",
    };
    const confirmed = confirmActivityReview(data, draft);
    expect(confirmed.activities).toHaveLength(1);
    expect(confirmed.activities[0].id).toBe("existing-activity");
  });
});
