import { describe, expect, it } from "vitest";
import independent from "./__fixtures__/training-plan/valid-independent.json";
import partial from "./__fixtures__/training-plan/valid-partial.json";
import forty from "./__fixtures__/training-plan/valid-1.2-40.json";
import { validateTrainingPlan } from "./training-plan";
import { createInitialData } from "./seed";
import {
  activationCandidate,
  activationDiagnostics,
  previewActivation,
} from "./active-plan";
import { validateCurrentSnapshot } from "./snapshot-validation";
import { projectActivePlan } from "./active-plan-projection";
import { currentPlanSessions } from "./active-plan";
import { plannedMileageRange } from "./metrics";
import type { Plan12 } from "./training-plan-contract";
import workout from "./__fixtures__/training-plan/valid-workout.json";

function validated(value: unknown) {
  const result = validateTrainingPlan(value);
  if (!result.ok) throw new Error("Invalid test fixture");
  return result.plan;
}

describe("active plan candidate", () => {
  it("preserves missing distance, supplied duration, Rest and source identities", () => {
    const plan = validated(independent);
    const before = JSON.stringify(plan);
    const data = createInitialData();
    const result = activationCandidate(
      plan,
      data,
      "synthetic-activation",
      "2026-11-16",
      "2026-11-20T00:00:00Z",
    );
    expect(JSON.stringify(plan)).toBe(before);
    expect(result.schemaVersion).toBe(5);
    expect(result.days?.map((day) => day.kind)).toEqual(["training", "rest"]);
    const session = result.sessions.find(
      (item) => item.sourceSessionId === "session-1",
    );
    expect(session).toMatchObject({
      sourceDayId: "day-1",
      sourcePlanId: "synthetic-plan",
      sourceVersionId: "synthetic-version-1",
      originalDistanceMiles: null,
      plannedDistanceMiles: null,
      originalDuration: { kind: "exact", value: 30, unit: "min" },
    });
    expect(result.sessions.filter((item) => item.retiredAt)).toHaveLength(
      data.sessions.filter((item) => item.scheduledDate >= "2026-11-16").length,
    );
    expect(
      result.sessions.find((item) => item.id === data.sessions[0].id),
    ).toMatchObject({
      ...data.sessions[0],
      originalDistance: {
        kind: "exact",
        value: data.sessions[0].originalDistanceMiles,
        unit: "mi",
      },
      plannedDistance: {
        kind: "exact",
        value: data.sessions[0].plannedDistanceMiles,
        unit: "mi",
      },
    });
    expect(() => validateCurrentSnapshot(result)).not.toThrow();
    const projected = projectActivePlan(result, plan, "2026-11-16");
    expect(projected.days.map((day) => day.kind)).toEqual(["training", "rest"]);
    expect(projected.days[0].sessions[0]).toMatchObject({
      sourceSessionId: "session-1",
      originalDate: "2026-11-16",
      scheduledDate: "2026-11-16",
    });
    expect(projected.days[0].sessions[0].source?.coachText).toEqual(
      plan.weeks[0].days[0].sessions[0].coachText,
    );
    projected.days[0].sessions[0].source!.coachText.push("local-only mutation");
    expect(plan.weeks[0].days[0].sessions[0].coachText).not.toContain(
      "local-only mutation",
    );
  });

  it("rejects unresolved source relationship without inventing a main", () => {
    const plan = validated(partial);
    expect(activationDiagnostics(plan)).toContainEqual(
      expect.objectContaining({
        code: "unknown_session_relationship",
        path: "/weeks/0/days/0/sessions/0/role",
      }),
    );
  });

  it("blocks replacement of a revised or activity-associated session", () => {
    const data = createInitialData();
    data.sessions
      .find((session) => session.scheduledDate === "2026-11-16")!
      .revisions.push({
        id: "revision-1",
        changedAt: "2026-11-20T00:00:00Z",
        field: "title",
        from: "old",
        to: "new",
        reason: "Synthetic",
      });
    expect(
      previewActivation(validated(forty), data, "2026-11-16").diagnostics,
    ).toContainEqual(expect.objectContaining({ code: "replacement_conflict" }));
  });

  it("keeps source ranges, linked doubles, independent sessions and unspecified days distinct", () => {
    const source = structuredClone(forty) as unknown as Plan12;
    source.weeks[0].days[0].sessions[0].distance = {
      min: 4,
      max: 6,
      unit: "mi",
    };
    const rest = source.weeks[0].days.find((day) => day.kind === "rest")!;
    rest.kind = "unspecified";
    delete rest.restDistance;
    const plan = validated(source);
    const candidate = activationCandidate(
      plan,
      createInitialData(),
      "range-proof",
      "2026-11-16",
      "2026-11-16T12:00:00Z",
    );
    const ranged = candidate.sessions.find(
      (session) => session.sourceSessionId === "session-1",
    )!;
    expect(ranged).toMatchObject({
      originalDistanceMiles: null,
      plannedDistanceMiles: null,
      originalDistance: { kind: "range", min: 4, max: 6, unit: "mi" },
    });
    expect(plannedMileageRange([ranged])).toEqual({ min: 4, max: 6 });
    expect(candidate.days?.some((day) => day.kind === "unspecified")).toBe(
      true,
    );
    const scoped = currentPlanSessions(candidate, "range-proof", "2026-11-16");
    expect(
      scoped.every((session) =>
        session.id.startsWith("active:range-proof:session:"),
      ),
    ).toBe(true);
    const projection = projectActivePlan(
      candidate,
      plan,
      "2026-11-16",
      "range-proof",
    );
    const double = projection.days
      .flatMap((day) => day.sessions)
      .find((session) => session.role === "double")!;
    expect(double.primarySessionId).toBe("session-2");
    expect(
      projection.days
        .flatMap((day) => day.sessions)
        .some((session) => session.role === "independent"),
    ).toBe(true);
    expect(() => validateCurrentSnapshot(candidate)).not.toThrow();
  });

  it("activates an in-progress plan only from the effective date while retaining its earlier source days", () => {
    const plan = validated(forty);
    const before = createInitialData();
    const past = before.sessions.find(
      (session) => session.scheduledDate === "2026-11-04",
    )!;
    before.journals.push({
      id: "historical-result",
      sessionId: past.id,
      date: past.scheduledDate,
      actualDistanceMiles: 5,
      updatedAt: "2026-11-18T12:00:00Z",
    });
    before.activities.push({
      id: "historical-activity",
      sourceHash: "synthetic-hash",
      fileName: "synthetic.fit",
      occurredAt: "2026-11-04T08:00:00Z",
      distanceMiles: 5,
      role: "primary-easy",
      plannedSessionId: past.id,
      isPrimary: true,
      importedAt: "2026-11-04T12:00:00Z",
      laps: [],
    });
    const after = activationCandidate(
      plan,
      before,
      "mid-plan",
      "2026-11-18",
      "2026-11-18T12:00:00Z",
    );
    expect(after.days?.every((day) => day.originalDate >= "2026-11-18")).toBe(
      true,
    );
    expect(
      after.sessions
        .filter((session) => session.sourceSessionId)
        .every((session) => session.originalDate >= "2026-11-18"),
    ).toBe(true);
    expect(
      after.sessions.find((session) => session.id === past.id),
    ).toMatchObject(past);
    expect(after.journals).toContainEqual(
      before.journals.find((entry) => entry.id === "historical-result"),
    );
    expect(after.activities).toContainEqual(
      before.activities.find(
        (activity) => activity.id === "historical-activity",
      ),
    );
    const projection = projectActivePlan(after, plan, "2026-11-18", "mid-plan");
    expect(projection.preActivationSourceDays.map((day) => day.date)).toEqual([
      "2026-11-16",
      "2026-11-17",
    ]);
    expect(projection.sourcePlan?.weeks[0].days).toHaveLength(7);
    expect(
      projection.days.every((day) => day.originalDate >= "2026-11-18"),
    ).toBe(true);
  });

  it("keeps a complete workout solely in the immutable D1 source", () => {
    const plan = validated(workout);
    const after = activationCandidate(
      plan,
      createInitialData(),
      "workout-source",
      "2026-11-16",
      "2026-11-16T12:00:00Z",
    );
    const projection = projectActivePlan(
      after,
      plan,
      "2026-11-16",
      "workout-source",
    );
    const session = projection.days
      .flatMap((day) => day.sessions)
      .find((item) => item.sourceSessionId === "session-1")!;
    expect(session.source?.workout?.structureStatus).toBe("complete");
    expect(
      after.sessions.find((item) => item.sourceSessionId === "session-1"),
    ).not.toHaveProperty("workout");
  });
});
