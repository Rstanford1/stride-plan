import { expect, it } from "vitest";
import { createInitialData } from "../domain/seed";
import type { GarminRetrieval } from "./garmin";
import {
  fitConfirmation,
  fitEvidence,
  garminConfirmation,
  garminEvidence,
  manualEvidence,
} from "./logical-activity-evidence";

it("keeps a manual training date separate from unknown original time", () => {
  expect(
    manualEvidence({
      id: "journal",
      date: "2026-11-23",
      createdAt: "2026-11-24T12:00:00Z",
      updatedAt: "2026-11-24T12:00:00Z",
    }),
  ).toEqual({
    kind: "manual",
    sourceId: "journal",
    original: {
      id: "journal",
      date: "2026-11-23",
      createdAt: "2026-11-24T12:00:00Z",
      updatedAt: "2026-11-24T12:00:00Z",
    },
    occurredAt: null,
    localDate: "2026-11-23",
    timezone: null,
  });
});
it("retains FIT source identity and recorded time, and refuses unverified sources", () => {
  const data = createInitialData();
  data.fitSources.push({
    id: "source",
    sourceHash: "a".repeat(64),
    originalFileName: "synthetic.fit",
    byteLength: 1,
    importedAt: "2026-11-24T12:00:00Z",
    decoderId: "test",
    decoderVersion: "1",
    preservationStatus: "verified",
  });
  data.fitSourceActivities.push({
    id: "recording",
    sourceId: "source",
    sourceIndex: 0,
    occurredAt: "2026-11-23T23:30:00Z",
    localDate: "2026-11-23",
    sport: "running",
    distanceMeters: 1000,
    recordCount: 0,
    laps: [],
    samples: [],
  });
  expect(fitEvidence(data, "recording")).toMatchObject({
    kind: "fit",
    sourceId: "source",
    activityId: "recording",
    occurredAt: "2026-11-23T23:30:00Z",
    localDate: "2026-11-23",
    timezone: null,
  });
  data.fitSources[0].preservationStatus = "failed";
  expect(() => fitEvidence(data, "recording")).toThrow(/preserved/);
});
it("keeps Garmin provider ID distinct from FIT hash", () => {
  const result = {
    provider: "garmin",
    activityId: "123",
    source: { sourceHash: "a".repeat(64) },
  } as GarminRetrieval;
  expect(garminEvidence(result)).toEqual({
    kind: "garmin",
    providerId: "123",
    sourceHash: "a".repeat(64),
    occurredAt: null,
    localDate: null,
    timezone: null,
  });
  expect(
    garminEvidence({
      ...result,
      relatedSourceHashes: ["a".repeat(64), "b".repeat(64)],
    }),
  ).toMatchObject({ relatedSourceHashes: ["a".repeat(64), "b".repeat(64)] });
});
it("requires callers to supply the assigned date and plan association for FIT and Garmin commands", () => {
  const data = createInitialData();
  data.fitSources.push({
    id: "source",
    sourceHash: "a".repeat(64),
    originalFileName: "synthetic.fit",
    byteLength: 1,
    importedAt: "2026-11-24T12:00:00Z",
    decoderId: "test",
    decoderVersion: "1",
    preservationStatus: "verified",
  });
  data.fitSourceActivities.push({
    id: "recording",
    sourceId: "source",
    sourceIndex: 0,
    occurredAt: "2026-11-23T23:30:00Z",
    sport: "running",
    distanceMeters: 1000,
    recordCount: 0,
    laps: [],
    samples: [],
  });
  const details = {
    commandId: "command",
    logicalActivityId: "logical",
    confirmationEventId: "event",
    assignedDate: "2026-11-24",
    plannedSessionId: "chosen-session",
    recorded: {
      distanceMiles: 1,
      durationSeconds: 600,
      averageHr: null,
      outcome: "completed" as const,
      note: null,
      shoeAllocations: [],
    },
  };
  expect(fitConfirmation(data, "recording", details)).toMatchObject({
    assignedDate: "2026-11-24",
    plannedSessionId: "chosen-session",
    sources: [{ occurredAt: "2026-11-23T23:30:00Z" }],
  });
  const garmin = {
    provider: "garmin",
    activityId: "123",
    source: { sourceHash: "a".repeat(64) },
  } as GarminRetrieval;
  expect(
    garminConfirmation(garmin, { ...details, plannedSessionId: null }),
  ).toMatchObject({
    assignedDate: "2026-11-24",
    plannedSessionId: null,
    sources: [{ providerId: "123" }],
  });
});
