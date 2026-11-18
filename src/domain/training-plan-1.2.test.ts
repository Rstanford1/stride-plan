import { describe, expect, expectTypeOf, it } from "vitest";
import {
  parseTrainingPlan,
  validateTrainingPlan,
  serializeTrainingPlan,
} from "./training-plan";
import { validateTrainingPlan as validate11 } from "./training-plan-validation";
import v11 from "./__fixtures__/training-plan/valid-independent.json";
import forty from "./__fixtures__/training-plan/valid-1.2-40.json";
import fiftyFive from "./__fixtures__/training-plan/valid-1.2-55.json";
import sixtyFive from "./__fixtures__/training-plan/valid-1.2-65.json";
import seventyFive from "./__fixtures__/training-plan/valid-1.2-75plus.json";
import type { Plan12 } from "./training-plan-contract";
const copy = () => structuredClone(forty) as Plan12;
const codes = (plan: unknown) =>
  validateTrainingPlan(plan).diagnostics.map((d) => d.code);
const removeEvidence = (p: Plan12, suffix: string) => {
  p.interpretationEvidence = p.interpretationEvidence?.filter(
    (e) => !e.path.endsWith(suffix),
  );
};
describe("1.2 independent contract semantics", () => {
  it.each([forty, fiftyFive, sixtyFive, seventyFive])(
    "retains synthetic $manifest.mileageTier MPW intent without applying policy",
    (fixture) => {
      const before = JSON.stringify(fixture);
      const result = validateTrainingPlan(fixture);
      expect(result.diagnostics).toEqual([]);
      expect(result.ok).toBe(true);
      expect(JSON.stringify(fixture)).toBe(before);
      expect(
        parseTrainingPlan(serializeTrainingPlan(fixture as Plan12)),
      ).toEqual(result);
      expect(fixture.weeks[0].days[0].sessions[0]).toMatchObject({
        schedulingPolicy: "movable-within-week",
        priorityClass: "supporting",
        participation: "required",
        completionClass: "core",
      });
      expect(fixture.weeks[0].days[1].sessions[0]).toMatchObject({
        schedulingPolicy: "fixed-date",
        priorityClass: "priority",
      });
      expect(fixture.weeks[0].days[1].sessions[1]).toMatchObject({
        participation: "optional",
        completionClass: "flexible",
        role: "double",
      });
    },
  );
  it("routes new 1.1 imports through the unchanged validator and never interprets 1.2-looking optional metadata", () => {
    const old = {
      ...structuredClone(v11),
      interpretationPolicies: [],
      weeks: structuredClone(v11.weeks),
    };
    Object.assign(old.weeks[0], {
      totalMileageTarget: { value: 0, unit: "s" },
    });
    expect(validateTrainingPlan(old)).toEqual(validate11(old));
    expect(validateTrainingPlan(old).ok).toBe(true);
    expect(
      validateTrainingPlan(old).diagnostics.some(
        (d) => d.code === "unknown_optional_field",
      ),
    ).toBe(true);
  });
  it.each(["m", "km", "mi"])(
    "accepts explicit weekly %s quantities independently of display unit, tier, session and core sums",
    (unit) => {
      const p = copy();
      p.weeks[0].totalMileageTarget = { min: 0, max: 100, unit: unit as "mi" };
      p.weeks[0].coreTarget = { value: 900, unit: "km" };
      expect(validateTrainingPlan(p).ok).toBe(true);
      expect(p.weeks[0].totalMileageTarget).toEqual({ min: 0, max: 100, unit });
    },
  );
  it.each([
    {},
    { value: 1 },
    { value: 1, unit: "s" },
    { value: 1, unit: "min" },
    { min: 55, max: 40, unit: "mi" },
    { value: 0, min: 0, max: 1, unit: "mi" },
    null,
    { value: "40", unit: "mi" },
  ])("rejects malformed or non-distance weekly target %j", (target) => {
    const p = copy();
    Object.assign(p.weeks[0], { totalMileageTarget: target });
    expect(validateTrainingPlan(p).ok).toBe(false);
  });
  it("keeps missing or explicit unspecified classifications and unknown targets unknown", () => {
    const p = copy();
    delete p.weeks[0].totalMileageTarget;
    p.interpretationEvidence = [];
    for (const day of p.weeks[0].days)
      for (const session of day.sessions) {
        delete session.schedulingPolicy;
        session.priorityClass = "unspecified";
      }
    const before = JSON.stringify(p);
    const r = validateTrainingPlan(p);
    expect(r.ok).toBe(true);
    expect(r.diagnostics.map((d) => d.code)).toContain(
      "unspecified_classification",
    );
    expect(r.diagnostics.map((d) => d.code)).toContain(
      "unspecified_total_mileage",
    );
    expect(JSON.stringify(p)).toBe(before);
  });
  it.each([false, true, null, 0, "optional", "required", "unknown"])(
    "rejects an unrecognized scheduling or priority value %j",
    (value) => {
      for (const field of ["priorityClass", "schedulingPolicy"]) {
        const p = copy();
        Object.assign(p.weeks[0].days[0].sessions[0], { [field]: value });
        expect(validateTrainingPlan(p).ok).toBe(false);
      }
    },
  );
  it("does not conflate priority, participation, core/flexible or scheduling", () => {
    const p = copy();
    const session = p.weeks[0].days[0].sessions[0];
    session.priorityClass = "priority";
    session.participation = "optional";
    session.completionClass = "flexible";
    expect(validateTrainingPlan(p).ok).toBe(true);
    session.completionClass = "core";
    expect(codes(p)).toContain("optional_core");
  });
  it("requires a valid explicit basis and preserves policy text apart from coach text", () => {
    const p = copy();
    const coach = structuredClone(p.weeks[0].days[0].sessions[0].coachText);
    p.interpretationPolicies![0].statement = "  User words\r\nKeep exact.\n";
    expect(validateTrainingPlan(p).ok).toBe(true);
    expect(p.weeks[0].days[0].sessions[0].coachText).toEqual(coach);
    removeEvidence(p, "/priorityClass");
    expect(codes(p)).toContain("missing_interpretation_evidence");
    const missing = copy();
    const policy = missing.interpretationEvidence!.find(
      (e) => e.kind === "user-policy",
    )!;
    Object.assign(policy, { policyId: "not-a-policy" });
    expect(codes(missing)).toContain("invalid_reference");
    const approval = copy();
    Object.assign(approval.interpretationPolicies![0], {
      approval: "suggested",
    });
    expect(validateTrainingPlan(approval).ok).toBe(false);
  });
  it("rejects missing coach provenance, invalid scope, conflicting evidence and duplicate identities", () => {
    const p = copy();
    p.provenance = p.provenance.filter((e) => e.path !== "");
    p.provenance.push({
      path: "/weeks/0/days",
      sourceId: "synthetic-source",
      location: { kind: "authored" },
    });
    expect(codes(p)).toContain("missing_provenance");
    const wrong = copy();
    wrong.interpretationEvidence![0].path = "/manifest/title";
    expect(codes(wrong)).toContain("invalid_interpretation_path");
    const duplicate = copy();
    duplicate.interpretationEvidence!.push(
      duplicate.interpretationEvidence![0],
    );
    expect(codes(duplicate)).toContain("duplicate_interpretation_evidence");
    const identity = copy();
    identity.interpretationPolicies![0].id = "week-1";
    expect(codes(identity)).toContain("duplicate_id");
  });
  it("rejects unsupported versions, features, duplicate JSON keys and unsafe object input", () => {
    expect(validateTrainingPlan({ ...copy(), schemaVersion: "1.3" }).ok).toBe(
      false,
    );
    expect(
      validateTrainingPlan({
        ...copy(),
        requiredFeatures: ["completion-engine"],
      }).ok,
    ).toBe(false);
    expect(
      parseTrainingPlan('{"schemaVersion":"1.2","schemaVersion":"1.1"}')
        .diagnostics[0].code,
    ).toBe("duplicate_json_key");
    const hostile = Object.defineProperty({}, "schemaVersion", {
      get() {
        throw Error("getter executed");
      },
      enumerable: true,
    });
    expect(() => validateTrainingPlan(hostile)).not.toThrow();
    expect(validateTrainingPlan(hostile).ok).toBe(false);
    expectTypeOf<Plan12["schemaVersion"]>().toEqualTypeOf<"1.2">();
  });
  it("rejects missing participation/completion without inventing defaults", () => {
    for (const field of ["participation", "completionClass"]) {
      const p = copy();
      delete p.weeks[0].days[0].sessions[0][field];
      const before = JSON.stringify(p);
      expect(validateTrainingPlan(p).ok).toBe(false);
      expect(JSON.stringify(p)).toBe(before);
    }
  });
});
