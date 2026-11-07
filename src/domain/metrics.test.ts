import { describe, expect, it } from "vitest";
import {
  calculateWeeklyMetrics,
  isCutbackWeek,
  mileageAdherence,
} from "./metrics";
import { createInitialData } from "./seed";

describe("weekly metrics", () => {
  it("keeps flexible mileage out of core planned mileage", () => {
    const data = createInitialData();
    const weekOne = calculateWeeklyMetrics(
      1,
      data.sessions,
      data.activities,
      data.journals,
    );
    expect(weekOne.corePlannedMiles).toBe(24);
    expect(weekOne.flexiblePlannedMiles).toBe(3.5);
    expect(weekOne.corePlannedMiles + weekOne.flexiblePlannedMiles).toBe(27.5);
  });

  it("reconciles the first three workbook weekly totals", () => {
    const data = createInitialData();
    const totals = [1, 2, 3].map((week) =>
      data.sessions
        .filter((session) => session.week === week)
        .reduce((sum, session) => sum + session.plannedDistanceMiles, 0),
    );
    expect(totals).toEqual([27.5, 30.5, 34]);
  });

  it("reconciles all core, flexible, and total mileage from the replacement workbook", () => {
    const data = createInitialData();
    const reconciled = Array.from({ length: 13 }, (_, index) => {
      const metrics = calculateWeeklyMetrics(
        index + 1,
        data.sessions,
        data.activities,
        data.journals,
      );
      return [
        metrics.corePlannedMiles,
        metrics.flexiblePlannedMiles,
        metrics.corePlannedMiles + metrics.flexiblePlannedMiles,
      ];
    });
    expect(reconciled).toEqual([
      [24, 3.5, 27.5],
      [27, 3.5, 30.5],
      [30, 4, 34],
      [24, 3, 27],
      [33, 4, 37],
      [37, 4, 41],
      [39.5, 4.5, 44],
      [31, 3.5, 34.5],
      [41, 5, 46],
      [43, 5, 48],
      [44.5, 5.5, 50],
      [34.5, 4, 38.5],
      [39.5, 5, 44.5],
    ]);
  });

  it("counts actual mileage separately from core completion", () => {
    const data = createInitialData();
    const session = data.sessions.find(
      (item) => item.week === 2 && item.kind === "easy",
    )!;
    session.status = "completed";
    data.journals.push({
      id: "week-2-entry",
      sessionId: session.id,
      date: session.scheduledDate,
      actualDistanceMiles: 4.5,
      updatedAt: "2026-11-10T10:00:00Z",
    });
    const metrics = calculateWeeklyMetrics(
      2,
      data.sessions,
      data.activities,
      data.journals,
    );
    expect(metrics.actualMiles).toBeCloseTo(4.5);
    expect(metrics.coreCompleted).toBe(1);
    expect(metrics.coreTotal).toBe(5);
    expect(mileageAdherence(metrics)).toBeCloseTo(4.5 / 27);
  });

  it("does not let unplanned extra mileage complete a core session", () => {
    const data = createInitialData();
    data.activities.push({
      id: "extra",
      sourceHash: "extra",
      fileName: "extra.fit",
      occurredAt: "2026-11-14T09:00:00-08:00",
      distanceMiles: 20,
      role: "primary-easy",
      isPrimary: true,
      importedAt: "2026-11-14T10:00:00-08:00",
      laps: [],
    });
    const metrics = calculateWeeklyMetrics(
      2,
      data.sessions,
      data.activities,
      data.journals,
    );
    expect(metrics.actualMiles).toBeCloseTo(20);
    expect(metrics.coreCompleted).toBe(0);
  });

  it("identifies a meaningful planned mileage reduction as a cutback", () => {
    const data = createInitialData();
    expect(
      [4, 8, 12].map((week) => isCutbackWeek(week, data.sessions)),
    ).toEqual([true, true, true]);
  });
});
