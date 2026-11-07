import { describe, expect, it } from "vitest";
import { buildObservations } from "./observations";
import { createInitialData } from "./seed";

describe("explainable observations", () => {
  it("shows triggering records and missing-data explanations", () => {
    const data = createInitialData();
    const weekTwoSessions = data.sessions.filter(
      (session) => session.week === 2 && session.kind !== "rest",
    );
    data.journals.push(
      {
        id: "j2",
        sessionId: weekTwoSessions[1].id,
        date: weekTwoSessions[1].scheduledDate,
        rpe: 4,
        soreness: "mild",
        sorenessLocation: "calves",
        updatedAt: "2026-11-11T10:00:00Z",
      },
      {
        id: "j3",
        sessionId: weekTwoSessions[2].id,
        date: weekTwoSessions[2].scheduledDate,
        rpe: 8,
        soreness: "mild",
        updatedAt: "2026-11-12T10:00:00Z",
      },
    );
    const observations = buildObservations(
      2,
      data.sessions,
      data.activities,
      data.journals,
    );
    const soreness = observations.find((item) =>
      item.id.startsWith("recurring-soreness"),
    );
    expect(soreness?.evidence[0].recordIds).toContain("j3");
    expect(soreness?.missingData.length).toBeGreaterThan(0);
    expect(
      observations.some((item) => item.id.startsWith("high-easy-rpe")),
    ).toBe(true);
  });

  it("explains consistent work laps from their lap records", () => {
    const data = createInitialData();
    const session = data.sessions.find(
      (item) => item.week === 2 && item.kind === "easy",
    )!;
    data.activities.push({
      id: "workout-activity",
      sourceHash: "workout-activity",
      fileName: "workout.fit",
      occurredAt: `${session.scheduledDate}T07:00:00-08:00`,
      distanceMiles: 6,
      durationSeconds: 2600,
      role: "primary-workout",
      plannedSessionId: session.id,
      isPrimary: true,
      importedAt: `${session.scheduledDate}T08:00:00-08:00`,
      laps: [
        {
          id: "w1",
          distanceMiles: 1,
          durationSeconds: 420,
          role: "work",
        },
        {
          id: "w2",
          distanceMiles: 1,
          durationSeconds: 425,
          role: "work",
        },
        {
          id: "w3",
          distanceMiles: 1,
          durationSeconds: 422,
          role: "work",
        },
      ],
    });
    const observations = buildObservations(
      2,
      data.sessions,
      data.activities,
      data.journals,
    );
    const consistent = observations.find((item) =>
      item.id.startsWith("consistent-work-laps"),
    );
    expect(consistent?.evidence[0].recordIds).toEqual(["w1", "w2", "w3"]);
  });
});
