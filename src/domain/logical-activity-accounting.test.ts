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
  projectShoeMileage,
} from "./logical-activity-accounting";
import { calculateWeeklyMetrics } from "./metrics";
import { createInitialData } from "./seed";
import { projectActivePlan } from "./active-plan-projection";
import { currentPlanSessions } from "./active-plan";

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
      original: {
        id: "manual-one",
        date: "2026-11-23",
        updatedAt: "2026-11-24T12:00:00Z",
      },
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
        original: {
          id: "manual-two",
          date: "2026-11-24",
          updatedAt: "2026-11-24T12:00:00Z",
        },
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
it("adds new shoe credits once and refuses to guess historic attribution", () => {
  const data = createInitialData();
  data.shoes = [
    { id: "shoe", name: "Synthetic", mileageMiles: 100, isDefault: true },
  ];
  const result = applyConfirmation(empty, first, "2026-11-24T12:00:00Z");
  if (result.status !== "confirmed") throw new Error("Expected confirmation");
  data.logicalActivities = result.state;
  expect(projectShoeMileage(data).totals.get("shoe")).toBe(104);
  data.journals.push({
    id: "manual-one",
    date: "2026-11-24",
    actualDistanceMiles: 4,
    shoeId: "shoe",
    updatedAt: "2026-11-24T12:00:00Z",
  });
  const projected = projectShoeMileage(data);
  expect(projected.totals.get("shoe")).toBe(100);
  expect(projected.unresolved).toEqual(["run-one"]);
});
it("applies explicit historical shoe attribution and later corrections as a single credit", () => {
  const data = createInitialData();
  data.shoes = [
    { id: "shoe", name: "Synthetic", mileageMiles: 100, isDefault: true },
  ];
  const old = {
    id: "manual-one",
    date: "2026-11-23",
    actualDistanceMiles: 4,
    shoeId: "shoe",
    updatedAt: "2026-11-24T12:00:00Z",
  };
  data.journals = [old];
  const input: ConfirmationCommand = {
    ...first,
    sources: [
      {
        kind: "manual",
        sourceId: old.id,
        original: old,
        legacyShoeCredit: { shoeId: "shoe", distanceMiles: 4 },
        occurredAt: null,
        localDate: old.date,
        timezone: null,
      },
    ],
    recorded: {
      ...first.recorded,
      distanceMiles: 5,
      shoeAllocations: [{ shoeId: "shoe", distanceMiles: 5 }],
    },
  };
  const confirmed = applyConfirmation(empty, input, "2026-11-24T12:00:00Z");
  if (confirmed.status !== "confirmed")
    throw new Error("Expected confirmation");
  data.logicalActivities = confirmed.state;
  expect(projectShoeMileage(data)).toMatchObject({ unresolved: [] });
  expect(projectShoeMileage(data).totals.get("shoe")).toBe(101);
  const corrected = applyCorrection(
    confirmed.state,
    {
      commandId: "correct",
      activityId: "run-one",
      expectedRevision: 1,
      assignedDate: input.assignedDate,
      plannedSessionId: input.plannedSessionId,
      recorded: {
        ...input.recorded,
        distanceMiles: 6,
        shoeAllocations: [{ shoeId: "shoe", distanceMiles: 6 }],
      },
      reason: "Corrected",
    },
    "2026-11-25T12:00:00Z",
  );
  data.logicalActivities = corrected.state;
  expect(projectShoeMileage(data).totals.get("shoe")).toBe(102);
  expect(data.journals[0]).toEqual(old);
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
  data.logicalActivities = result.state;
  expect(projectActivePlan(data, null).legacySessions[0].status).toBe(
    "completed",
  );
  expect(currentPlanSessions(data, null, null)[0].status).toBe("completed");
  expect(data.sessions[0].status).toBe("planned");
});
it("does not reactivate a legacy journal fallback when its attached FIT activity is confirmed", () => {
  const data = createInitialData();
  const session = data.sessions.find((item) => item.kind !== "rest")!;
  data.sessions = [
    { ...session, status: "planned", scheduledDate: "2026-11-24" },
  ];
  data.journals = [
    {
      id: "legacy-journal",
      sessionId: session.id,
      date: "2026-11-24",
      actualDistanceMiles: 4,
      updatedAt: "2026-11-24T12:00:00Z",
    },
  ];
  data.activities = [
    {
      id: "recording",
      sourceHash: "a".repeat(64),
      fileName: "synthetic.fit",
      occurredAt: "2026-11-24T10:00:00Z",
      distanceMiles: 4,
      role: "primary-easy",
      plannedSessionId: session.id,
      isPrimary: true,
      importedAt: "2026-11-24T12:00:00Z",
      laps: [],
    },
  ];
  const input: ConfirmationCommand = {
    ...first,
    plannedSessionId: session.id,
    sources: [
      {
        kind: "fit",
        sourceId: "source",
        activityId: "recording",
        sourceHash: "a".repeat(64),
        occurredAt: "2026-11-24T10:00:00Z",
        localDate: null,
        timezone: null,
      },
    ],
    recorded: { ...first.recorded, shoeAllocations: [] },
  };
  const result = applyConfirmation(empty, input, "2026-11-24T12:00:00Z");
  if (result.status !== "confirmed") throw new Error("Expected confirmation");
  expect(
    calculateWeeklyMetrics(
      session.week,
      data.sessions,
      data.activities,
      data.journals,
      result.state,
    ).actualMiles,
  ).toBe(4);
});
