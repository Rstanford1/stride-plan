import { describe, expect, it } from "vitest";
import { createInitialData } from "./seed";
import { parseBackup, serializeBackup } from "./backup";

describe("portable backup", () => {
  it("round-trips a temporary copy without losing revisions or activities", () => {
    const source = createInitialData();
    source.activities.push({
      id: "activity-1",
      sourceHash: "activity-1",
      fileName: "activity.fit",
      occurredAt: "2026-11-03T07:00:00-08:00",
      distanceMiles: 4,
      role: "primary-easy",
      isPrimary: true,
      importedAt: "2026-11-03T08:00:00-08:00",
      laps: [],
    });
    source.sessions[1].revisions.push({
      id: "revision-1",
      changedAt: "2026-11-06T12:00:00Z",
      field: "plannedDistanceMiles",
      from: 5,
      to: 4,
      reason: "Temporary test copy",
    });
    const restored = parseBackup(serializeBackup(source));
    expect(restored).toEqual(source);
    expect(restored.sessions[1].revisions[0].id).toBe("revision-1");
    expect(restored.activities[0].sourceHash).toBe(
      source.activities[0].sourceHash,
    );
  });

  it("rejects incomplete data", () => {
    expect(() => parseBackup('{"schemaVersion":1}')).toThrow("unsupported");
  });
});
