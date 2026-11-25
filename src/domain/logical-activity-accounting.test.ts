import { expect, it } from "vitest";
import {
  applyConfirmation,
  applyCorrection,
  type ConfirmationCommand,
  type LogicalActivityState,
} from "./logical-activity";
import {
  logicalActivityCredits,
  logicalShoeCredits,
} from "./logical-activity-accounting";
import { calculateWeeklyMetrics } from "./metrics";
import { createInitialData } from "./seed";

const empty: LogicalActivityState = { activities: [], commands: [] };
const first: ConfirmationCommand = {
  commandId: "one",
  activityId: "run-one",
  eventId: "event-one",
  expectedRevision: null,
  assignedDate: "2026-11-24",
  plannedSessionId: "planned-one",
  sources: [
    {
      kind: "manual",
      sourceId: "manual-one",
      occurredAt: null,
      localDate: "2026-11-23",
      timezone: null,
    },
  ],
  recorded: {
    distanceMiles: 4,
    durationSeconds: 2400,
    averageHr: null,
    outcome: "completed",
    note: null,
    shoeAllocations: [{ shoeId: "shoe", distanceMiles: 4 }],
  },
  duplicateDecisions: [],
};
it("credits linked evidence once and separate doubles twice, while revisions replace prior values", () => {
  const initial = applyConfirmation(empty, first, "2026-11-24T12:00:00Z");
  if (initial.status !== "confirmed") throw new Error("Expected confirmation");
  const link: ConfirmationCommand = {
    ...first,
    commandId: "link",
    activityId: "incoming",
    eventId: "unused",
    expectedRevision: 1,
    sources: [
      {
        kind: "garmin",
        providerId: "123",
        sourceHash: "a".repeat(64),
        occurredAt: null,
        localDate: null,
        timezone: null,
      },
    ],
    duplicateDecisions: [{ activityId: "run-one", decision: "merge" }],
  };
  const merged = applyConfirmation(initial.state, link, "2026-11-24T12:30:00Z");
  if (merged.status !== "confirmed") throw new Error("Expected merge");
  expect(logicalActivityCredits(merged.state)).toHaveLength(1);
  expect(logicalShoeCredits(merged.state).get("shoe")).toBe(4);
  const second: ConfirmationCommand = {
    ...first,
    commandId: "two",
    activityId: "run-two",
    eventId: "event-two",
    plannedSessionId: "planned-two",
    sources: [
      {
        kind: "manual",
        sourceId: "manual-two",
        occurredAt: null,
        localDate: "2026-11-24",
        timezone: null,
      },
    ],
    duplicateDecisions: [{ activityId: "run-one", decision: "keep-both" }],
  };
  const doubled = applyConfirmation(
    merged.state,
    second,
    "2026-11-24T18:00:00Z",
  );
  if (doubled.status !== "confirmed")
    throw new Error("Expected separate double");
  expect(
    logicalActivityCredits(doubled.state).map(
      (credit) => credit.plannedSessionId,
    ),
  ).toEqual(["planned-one", "planned-two"]);
  expect(logicalShoeCredits(doubled.state).get("shoe")).toBe(8);
  const corrected = applyCorrection(
    doubled.state,
    {
      commandId: "correction",
      activityId: "run-one",
      expectedRevision: 2,
      assignedDate: "2026-11-24",
      plannedSessionId: "planned-one",
      recorded: {
        ...first.recorded,
        distanceMiles: 5,
        shoeAllocations: [{ shoeId: "shoe", distanceMiles: 5 }],
      },
      reason: "Corrected distance",
    },
    "2026-11-25T12:00:00Z",
  );
  expect(logicalShoeCredits(corrected.state).get("shoe")).toBe(9);
  expect(
    corrected.state.activities.find((item) => item.id === "run-one")?.confirmed
      .confirmedAt,
  ).toBe("2026-11-24T12:00:00Z");
});
it("credits a confirmed manual source once even when its legacy journal remains present", () => {
  const data = createInitialData();
  const session = data.sessions.find((item) => item.kind !== "rest")!;
  data.sessions = [
    { ...session, status: "planned", scheduledDate: "2026-11-24" },
  ];
  data.activities = [];
  data.journals = [
    {
      id: "manual-one",
      sessionId: session.id,
      date: "2026-11-24",
      actualDistanceMiles: 4,
      updatedAt: "2026-11-24T12:00:00Z",
    },
  ];
  const input = {
    ...first,
    assignedDate: "2026-11-24",
    plannedSessionId: session.id,
    recorded: { ...first.recorded, shoeAllocations: [] },
  };
  const result = applyConfirmation(empty, input, "2026-11-24T12:00:00Z");
  if (result.status !== "confirmed") throw new Error("Expected confirmation");
  const metrics = calculateWeeklyMetrics(
    session.week,
    data.sessions,
    data.activities,
    data.journals,
    result.state,
  );
  expect(metrics.actualMiles).toBe(4);
  expect(metrics.coreCompleted).toBe(session.flexible ? 0 : 1);
});
