import { expect, it } from "vitest";
import { createInitialData } from "../domain/seed";
import type { GarminRetrieval } from "./garmin";
import {
  fitEvidence,
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
});
