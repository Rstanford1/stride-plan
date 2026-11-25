import { describe, expect, it } from "vitest";
import { validateLogicalActivityState } from "./logical-activity-validation";
import {
  applyConfirmation,
  applyCorrection,
  confirmedDistance,
  prepareConfirmation,
  type ActivityEvidence,
  type ConfirmationCommand,
  type LogicalActivityState,
} from "./logical-activity";
const empty = (): LogicalActivityState => ({ activities: [], commands: [] });
const source = (
  kind: "manual" | "fit" | "garmin",
  id: string,
  time: string | null = "2026-11-24T10:00:00Z",
): ActivityEvidence =>
  kind === "manual"
    ? {
        kind,
        sourceId: id,
        original: { id, date: "2026-11-24", updatedAt: "2026-11-24T12:00:00Z" },
        occurredAt: time,
        localDate: null,
        timezone: null,
      }
    : kind === "fit"
      ? {
          kind,
          sourceId: `fit-source:${"a".repeat(64)}`,
          activityId: id,
          sourceHash: "a".repeat(64),
          occurredAt: time,
          localDate: null,
          timezone: null,
        }
      : {
          kind,
          providerId: id,
          sourceHash: "a".repeat(64),
          occurredAt: time,
          localDate: null,
          timezone: null,
        };
const command = (
  id: string,
  sources: ActivityEvidence[],
): ConfirmationCommand => ({
  commandId: `command-${id}`,
  activityId: `activity-${id}`,
  eventId: `event-${id}`,
  expectedRevision: null,
  assignedDate: "2026-11-24",
  plannedSessionId: null,
  sources,
  recorded: {
    distanceMiles: 4,
    durationSeconds: 2400,
    averageHr: null,
    outcome: "unplanned",
    note: null,
    shoeAllocations: [],
  },
  duplicateDecisions: [],
});
const time = "2026-11-24T12:00:00Z";
function committed(result: ReturnType<typeof applyConfirmation>) {
  if (result.status !== "confirmed")
    throw new Error(`Unexpected ${result.status}`);
  return result;
}
describe("confirmed activity candidate rules", () => {
  it.each(["manual", "fit", "garmin"] as const)(
    "prepares a %s-only confirmed identity",
    (kind) => {
      const result = committed(
        applyConfirmation(empty(), command(kind, [source(kind, "1")]), time),
      );
      expect(result.receipt).toMatchObject({
        logicalActivityId: `activity-${kind}`,
        committedRevision: 1,
        confirmedAt: time,
      });
      expect(confirmedDistance(result.state)).toBe(4);
    },
  );
  it("reuses exact FIT and Garmin provider identities rather than crediting again", () => {
    for (const kind of ["fit", "garmin"] as const) {
      const first = committed(
        applyConfirmation(
          empty(),
          command("first", [source(kind, "same")]),
          time,
        ),
      );
      expect(
        prepareConfirmation(
          first.state,
          command("new", [source(kind, "same")]),
        ),
      ).toEqual({ status: "exact-duplicate", activityId: "activity-first" });
    }
  });
  it("requires an explicit merge to attach new evidence to an already-owned source", () => {
    const manual = source("manual", "m");
    const first = committed(
      applyConfirmation(empty(), command("first", [manual]), time),
    );
    const next = command("second", [manual, source("garmin", "g")]);
    expect(prepareConfirmation(first.state, next)).toEqual({
      status: "review-required",
      candidates: ["activity-first"],
    });
    next.duplicateDecisions = [
      { activityId: "activity-first", decision: "keep-both" },
    ];
    expect(() => applyConfirmation(first.state, next, time)).toThrow(
      /cannot belong/,
    );
    next.duplicateDecisions = [
      { activityId: "activity-first", decision: "merge" },
    ];
    next.expectedRevision = 1;
    const merged = committed(applyConfirmation(first.state, next, time));
    expect(merged.state.activities).toHaveLength(1);
    expect(merged.state.activities[0].versions[1].sources).toHaveLength(2);
  });
  it("rejects saved activity snapshots that lose receipts or reuse a source", () => {
    const first = committed(
      applyConfirmation(
        empty(),
        command("first", [source("manual", "a")]),
        time,
      ),
    );
    const next = command("second", [source("manual", "b")]);
    next.duplicateDecisions = [
      { activityId: "activity-first", decision: "keep-both" },
    ];
    const both = committed(applyConfirmation(first.state, next, time));
    expect(() => validateLogicalActivityState(both.state)).not.toThrow();
    const noReceipt = structuredClone(both.state);
    noReceipt.commands = noReceipt.commands.filter(
      (item) => item.id !== "command-first",
    );
    expect(() => validateLogicalActivityState(noReceipt)).toThrow(
      /Missing original/,
    );
    const repeated = structuredClone(both.state);
    repeated.activities[1].versions[0].sources = structuredClone(
      repeated.activities[0].versions[0].sources,
    );
    expect(() => validateLogicalActivityState(repeated)).toThrow(
      /more than one/,
    );
  });
  it("requires explicit duplicate review and preserves records on review later", () => {
    const first = committed(
      applyConfirmation(
        empty(),
        command("manual", [source("manual", "m")]),
        time,
      ),
    );
    const next = command("fit", [source("fit", "f")]);
    expect(prepareConfirmation(first.state, next)).toEqual({
      status: "review-required",
      candidates: ["activity-manual"],
    });
    next.duplicateDecisions = [
      { activityId: "activity-manual", decision: "review-later" },
    ];
    expect(applyConfirmation(first.state, next, time)).toEqual({
      status: "review-later",
    });
    expect(first.state.activities).toHaveLength(1);
  });
  it("requires review of a FIT recording and Garmin source with identical bytes even when their timestamps disagree", () => {
    const first = committed(
      applyConfirmation(
        empty(),
        command("fit", [source("fit", "f", "2026-11-20T10:00:00Z")]),
        time,
      ),
    );
    const next = command("garmin", [
      source("garmin", "g", "2026-11-24T10:00:00Z"),
    ]);
    expect(prepareConfirmation(first.state, next)).toEqual({
      status: "review-required",
      candidates: ["activity-fit"],
    });
  });
  it("keeps two distinct recordings in one FIT source separate after explicit review", () => {
    const first = committed(
      applyConfirmation(
        empty(),
        command("first", [source("fit", "recording-1")]),
        time,
      ),
    );
    const next = command("second", [source("fit", "recording-2")]);
    expect(prepareConfirmation(first.state, next)).toEqual({
      status: "review-required",
      candidates: ["activity-first"],
    });
    next.duplicateDecisions = [
      { activityId: "activity-first", decision: "keep-both" },
    ];
    const both = committed(applyConfirmation(first.state, next, time));
    expect(both.state.activities).toHaveLength(2);
    expect(confirmedDistance(both.state)).toBe(8);
  });
  it("merges explicit evidence once or keeps both only by an explicit decision", () => {
    const first = committed(
      applyConfirmation(
        empty(),
        command("manual", [source("manual", "m")]),
        time,
      ),
    );
    const next = command("garmin", [source("garmin", "g")]);
    next.duplicateDecisions = [
      { activityId: "activity-manual", decision: "merge" },
    ];
    next.expectedRevision = 1;
    const merged = committed(
      applyConfirmation(first.state, next, "2026-11-24T13:00:00Z"),
    );
    expect(merged.state.activities).toHaveLength(1);
    expect(merged.state.activities[0].versions).toHaveLength(2);
    expect(merged.state.activities[0].versions[1].sources).toHaveLength(2);
    expect(merged.receipt.confirmedAt).toBe(time);
    expect(confirmedDistance(merged.state)).toBe(4);
    const both = command("fit", [source("fit", "f")]);
    both.duplicateDecisions = [
      { activityId: "activity-manual", decision: "keep-both" },
    ];
    expect(
      confirmedDistance(
        committed(applyConfirmation(first.state, both, time)).state,
      ),
    ).toBe(8);
  });
  it("returns the prior receipt for the same command and rejects reuse with different content", () => {
    const input = command("same", [source("manual", "m")]);
    const first = committed(applyConfirmation(empty(), input, time));
    expect(
      committed(applyConfirmation(first.state, input, "2026-11-25T12:00:00Z"))
        .receipt,
    ).toEqual(first.receipt);
    expect(() =>
      applyConfirmation(
        first.state,
        { ...input, assignedDate: "2026-11-25" },
        time,
      ),
    ).toThrow(/different request/);
  });
  it("preserves confirmation and previous values across corrections and retries", () => {
    const first = committed(
      applyConfirmation(
        empty(),
        command("manual", [source("manual", "m")]),
        time,
      ),
    );
    const correction = {
      commandId: "correction-1",
      activityId: "activity-manual",
      expectedRevision: 1,
      assignedDate: "2026-11-25",
      plannedSessionId: "planned-session-1",
      recorded: {
        ...first.state.activities[0].versions[0].recorded,
        note: "Corrected",
        distanceMiles: 5,
      },
      reason: "Corrected distance and training date",
    };
    const result = applyCorrection(
      first.state,
      correction,
      "2026-11-25T12:00:00Z",
    );
    expect(result.receipt).toMatchObject({
      committedRevision: 2,
      confirmedAt: time,
      confirmationEventId: "event-manual",
    });
    expect(result.state.activities[0].versions[0]).toMatchObject({
      assignedDate: "2026-11-24",
      plannedSessionId: null,
      recorded: { distanceMiles: 4, note: null },
    });
    expect(result.state.activities[0].versions[1]).toMatchObject({
      assignedDate: "2026-11-25",
      plannedSessionId: "planned-session-1",
      recorded: { distanceMiles: 5, note: "Corrected" },
    });
    expect(
      applyCorrection(result.state, correction, "2026-11-26T12:00:00Z").receipt,
    ).toEqual(result.receipt);
    expect(() =>
      applyCorrection(
        result.state,
        { ...correction, commandId: "stale" },
        time,
      ),
    ).toThrow(/changed/);
    expect(() => validateLogicalActivityState(result.state)).not.toThrow();
    const damaged = structuredClone(result.state);
    damaged.activities[0].versions[1].sources[0].occurredAt =
      "2026-11-25T10:00:00Z";
    expect(() => validateLogicalActivityState(damaged)).toThrow(
      /source evidence/,
    );
  });
  it("rejects incomplete allocations, stale revisions, and silent merge changes", () => {
    const invalid = command("shoe", [source("manual", "m")]);
    invalid.recorded.shoeAllocations = [{ shoeId: "shoe", distanceMiles: 3 }];
    expect(() => applyConfirmation(empty(), invalid, time)).toThrow(
      /allocations/,
    );
    const first = committed(
      applyConfirmation(
        empty(),
        command("manual", [source("manual", "m")]),
        time,
      ),
    );
    const next = command("fit", [source("fit", "f")]);
    next.duplicateDecisions = [
      { activityId: "activity-manual", decision: "merge" },
    ];
    expect(() => applyConfirmation(first.state, next, time)).toThrow(/changed/);
    next.expectedRevision = 1;
    next.recorded.distanceMiles = 5;
    expect(() => applyConfirmation(first.state, next, time)).toThrow(
      /silently change/,
    );
  });
  it("requires an explicit value choice when merging different notes and shoes", () => {
    const first = committed(
      applyConfirmation(
        empty(),
        command("manual", [source("manual", "m")]),
        time,
      ),
    );
    const next = command("fit", [source("fit", "f")]);
    next.duplicateDecisions = [
      { activityId: "activity-manual", decision: "merge" },
    ];
    next.expectedRevision = 1;
    next.recorded.note = "New detail";
    next.recorded.shoeAllocations = [{ shoeId: "shoe", distanceMiles: 4 }];
    expect(() => applyConfirmation(first.state, next, time)).toThrow(
      /choose which values/,
    );
    const kept = committed(
      applyConfirmation(
        first.state,
        { ...next, mergeRecordedChoice: "keep-existing" },
        time,
      ),
    );
    expect(kept.state.activities[0].versions[1].recorded).toEqual(
      first.state.activities[0].versions[0].recorded,
    );
    const changed = committed(
      applyConfirmation(
        first.state,
        { ...next, mergeRecordedChoice: "use-incoming" },
        time,
      ),
    );
    expect(changed.state.activities[0].versions[0].recorded.note).toBeNull();
    expect(changed.state.activities[0].versions[1].recorded).toMatchObject({
      note: "New detail",
      shoeAllocations: [{ shoeId: "shoe", distanceMiles: 4 }],
    });
    expect(changed.receipt.confirmedAt).toBe(time);
  });
});
