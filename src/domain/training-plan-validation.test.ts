import { describe, expect, expectTypeOf, it } from "vitest";
import independent from "./__fixtures__/training-plan/valid-independent.json";
import workout from "./__fixtures__/training-plan/valid-workout.json";
import partial from "./__fixtures__/training-plan/valid-partial.json";
import missingUnit from "./__fixtures__/training-plan/invalid-missing-unit.json";
import invalidDate from "./__fixtures__/training-plan/invalid-date.json";
import unsupported from "./__fixtures__/training-plan/invalid-unsupported-version.json";
import {
  parseTrainingPlan,
  serializeTrainingPlan,
  validateTrainingPlan,
} from "./training-plan-validation";
import type {
  TrainingPlan,
  Session,
  Quantity,
  Progression,
} from "./training-plan-contract";
import type { ExerciseBlock } from "../../.generated/training-plan";

const copy = (value: unknown = independent) =>
  JSON.parse(JSON.stringify(value)) as TrainingPlan;
const session = (plan: TrainingPlan) => plan.weeks[0].days[0].sessions[0];
const work = (plan: TrainingPlan) =>
  session(plan).workout!.blocks[1] as ExerciseBlock;
const errors = (value: unknown) => {
  const result = validateTrainingPlan(value);
  expect(result.ok).toBe(false);
  expect(result).not.toHaveProperty("plan");
  return result.diagnostics.filter((issue) => issue.severity === "error");
};

describe("training-plan 1.1 contract", () => {
  it.each([
    ["independent", independent],
    ["workout", workout],
    ["partial", partial],
  ])("accepts the synthetic %s fixture", (_, fixture) => {
    const result = validateTrainingPlan(fixture);
    expect(
      result.diagnostics.filter((issue) => issue.severity === "error"),
    ).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it.each([
    ["missing units", missingUnit, "schema.required"],
    ["impossible date", invalidDate, "invalid_date"],
    ["historical version", unsupported, "unsupported_version"],
  ])("rejects the %s fixture", (_, fixture, code) => {
    expect(errors(fixture).map((issue) => issue.code)).toContain(code);
  });

  it("preserves independent-only same-day sessions without creating a main", () => {
    const plan = copy();
    plan.weeks[0].days[0].sessions.push({
      ...session(plan),
      id: "independent-2",
      participation: "optional",
      completionClass: "flexible",
    });
    const original = JSON.stringify(plan);
    const result = validateTrainingPlan(plan);
    expect(result.ok).toBe(true);
    expect(JSON.stringify(plan)).toBe(original);
    expect(
      plan.weeks[0].days[0].sessions.every((s) => s.role === "independent"),
    ).toBe(true);
  });

  it("keeps source ambiguity explicit and reviewable", () => {
    const result = validateTrainingPlan(partial);
    expect(result.ok).toBe(true);
    expect(result.diagnostics.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "unspecified_session",
        "structure_needs_review",
        "source_ambiguous",
        "source_unsupported",
      ]),
    );
    if (result.ok) {
      expect(session(result.plan).role).toBe("unspecified");
      expect(result.plan.progressions).toEqual([]);
      expect(session(result.plan).workout!.blocks).toEqual([]);
    }
  });

  it("retains numeric zero, unknown mileage, raw whitespace, Unicode and nested metadata", () => {
    const plan = copy(partial);
    session(plan).coachText.push("  🏃 café\r\n\tsecond line\n");
    session(plan).futureNote = { nested: [null, 0, "exact\r\ntext"] };
    const serialized = serializeTrainingPlan(plan);
    const result = parseTrainingPlan(serialized);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan).toEqual(plan);
      expect(session(result.plan)).not.toHaveProperty("distance");
      expect(result.plan.weeks[0].days[1].restDistance).toEqual({
        value: 0,
        unit: "mi",
      });
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "unknown_optional_field",
          path: "/weeks/0/days/0/sessions/0/futureNote",
        }),
      );
      expect(
        result.diagnostics.some((issue) => issue.code === "optional_extension"),
      ).toBe(true);
    }
  });

  it("validates recursively frozen input without mutating or filling targets", () => {
    const plan = copy(workout);
    const before = JSON.stringify(plan);
    function freeze(value: unknown) {
      if (value && typeof value === "object") {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
      }
    }
    freeze(plan);
    expect(validateTrainingPlan(plan).ok).toBe(true);
    expect(JSON.stringify(plan)).toBe(before);
    expect(work(plan).sets[0].repetitions[1].targets).toBeUndefined();
    expect(plan.paceReferences[0].pace).toBeUndefined();
  });

  it("preserves explicit recovery order and adds no final or between-set interval", () => {
    const plan = copy(workout);
    const original = JSON.stringify(plan);
    expect(validateTrainingPlan(plan).ok).toBe(true);
    expect(work(plan).sets[0].recoveryAfter).toMatchObject({
      components: [
        { quantity: { value: 30, unit: "s" }, movement: "walk" },
        { quantity: { value: 200, unit: "m" }, movement: "jog" },
      ],
    });
    expect(work(plan).sets[1].recoveryAfter).toBeUndefined();
    expect(
      work(plan).sets[1].repetitions.at(-1)!.recoveryAfter,
    ).toBeUndefined();
    expect(session(plan).workout!.blocks[2].role).toBe("recovery");
    expect(JSON.stringify(plan)).toBe(original);
  });

  it("allows an explicitly required core double", () => {
    const plan = copy(workout);
    Object.assign(plan.weeks[0].days[0].sessions[1], {
      participation: "required",
      completionClass: "core",
    });
    expect(validateTrainingPlan(plan).ok).toBe(true);
  });

  const invalidCases: Array<[string, string, (plan: TrainingPlan) => void]> = [
    [
      "duplicate IDs",
      "duplicate_id",
      (p) => {
        p.weeks[0].days[1].id = p.weeks[0].days[0].id;
      },
    ],
    [
      "manifest ID collision",
      "duplicate_id",
      (p) => {
        p.manifest.planId = "set-1";
      },
    ],
    [
      "unknown required feature",
      "unsupported_feature",
      (p) => {
        p.requiredFeatures = ["org.example:required"];
      },
    ],
    [
      "unknown run type",
      "schema.enum",
      (p) => {
        Object.assign(session(p), { runType: "teleport" });
      },
    ],
    [
      "unknown unit",
      "schema.enum",
      (p) => {
        Object.assign(work(p).sets[0].quantity!, { unit: "yards" });
      },
    ],
    [
      "coerced numeric string",
      "schema.type",
      (p) => {
        Object.assign(work(p).sets[0].quantity!, { value: "400" });
      },
    ],
    [
      "dangling double link",
      "invalid_double_link",
      (p) => {
        p.weeks[0].days[0].sessions[1].primarySessionId = "missing";
      },
    ],
    [
      "double linking to itself",
      "invalid_double_link",
      (p) => {
        p.weeks[0].days[0].sessions[1].primarySessionId = "session-double";
      },
    ],
    [
      "artificial independent link",
      "unexpected_primary_link",
      (p) => {
        session(p).role = "independent";
        session(p).primarySessionId = "session-double";
      },
    ],
    [
      "two mains",
      "multiple_main_sessions",
      (p) => {
        p.weeks[0].days[0].sessions[1].role = "main";
      },
    ],
    [
      "optional core",
      "optional_core",
      (p) => {
        session(p).participation = "optional";
      },
    ],
    [
      "rest with sessions",
      "day_kind_conflict",
      (p) => {
        p.weeks[0].days[0].kind = "rest";
      },
    ],
    [
      "nonzero rest",
      "invalid_rest_distance",
      (p) => {
        p.weeks[0].days[1].restDistance = { value: 1, unit: "mi" };
      },
    ],
    [
      "missing day",
      "day_coverage",
      (p) => {
        p.weeks[0].days.pop();
      },
    ],
    [
      "wrong day order",
      "day_order",
      (p) => {
        p.weeks[0].days.reverse();
      },
    ],
    [
      "wrong week order",
      "week_order",
      (p) => {
        p.weeks[0].number = 2;
      },
    ],
    [
      "bad calendar end",
      "calendar_coverage",
      (p) => {
        p.calendar.endDate = "2026-11-18";
      },
    ],
    [
      "duration as mileage",
      "wrong_dimension",
      (p) => {
        session(p).distance = { value: 5, unit: "min" };
      },
    ],
    [
      "reversed quantity range",
      "invalid_range",
      (p) => {
        work(p).sets[0].quantity = { min: 5, max: 2, unit: "mi" };
      },
    ],
    [
      "conflicting exact/range keys",
      "conflicting_quantity",
      (p) => {
        Object.assign(work(p).sets[0].quantity!, { min: 2 });
      },
    ],
    [
      "reversed pace range",
      "invalid_range",
      (p) => {
        session(p).targets = [
          { kind: "pace", min: 400, max: 300, unit: "s/mi" },
        ];
      },
    ],
    [
      "dangling pace reference",
      "invalid_reference",
      (p) => {
        session(p).targets = [
          { kind: "pace-reference", referenceId: "missing" },
        ];
      },
    ],
    [
      "invalid hammer index",
      "invalid_hammer_index",
      (p) => {
        work(p).sets[0].hammerRepetitionIndices = [3];
      },
    ],
    [
      "duplicate hammer index",
      "schema.uniqueItems",
      (p) => {
        work(p).sets[0].hammerRepetitionIndices = [1, 1];
      },
    ],
    [
      "wrong repetition index",
      "repetition_order",
      (p) => {
        work(p).sets[0].repetitions[0].index = 2;
      },
    ],
    [
      "wrong set index",
      "set_order",
      (p) => {
        work(p).sets[0].index = 3;
      },
    ],
    [
      "duplicate set recovery",
      "duplicate_recovery",
      (p) => {
        work(p).sets[0].repetitions[1].recoveryAfter = {
          quantity: { value: 1, unit: "min" },
          movement: "jog",
          coachText: [],
        };
      },
    ],
    [
      "duplicate ordered recovery",
      "duplicate_recovery",
      (p) => {
        work(p).recoveryAfter = {
          quantity: { value: 1, unit: "min" },
          movement: "walk",
          coachText: [],
        };
      },
    ],
    [
      "recovery at wrong boundary",
      "invalid_recovery_placement",
      (p) => {
        Object.assign(session(p).workout!.blocks[2], {
          afterId: "block-warmup",
        });
      },
    ],
    [
      "first block recovery",
      "invalid_recovery_placement",
      (p) => {
        session(p).workout!.blocks.unshift({
          id: "first-recovery",
          role: "recovery",
          afterId: "block-work",
          recovery: {
            quantity: { value: 1, unit: "s" },
            movement: "walk",
            coachText: [],
          },
          coachText: [],
        });
      },
    ],
    [
      "partial workout without note",
      "missing_review_note",
      (p) => {
        session(p).workout!.structureStatus = "partial";
      },
    ],
    [
      "unstructured with blocks",
      "structure_status_conflict",
      (p) => {
        session(p).workout!.structureStatus = "unstructured";
      },
    ],
    [
      "bad provenance path",
      "invalid_pointer",
      (p) => {
        p.provenance[0].path = "/missing";
      },
    ],
    [
      "bad provenance source",
      "invalid_reference",
      (p) => {
        p.provenance[0].sourceId = "missing";
      },
    ],
    [
      "wrong provenance source kind",
      "source_location_mismatch",
      (p) => {
        p.provenance[0].location = {
          kind: "cell",
          sheet: "Synthetic",
          cell: "A1",
        };
      },
    ],
    [
      "invalid review pointer",
      "invalid_pointer",
      (p) => {
        p.reviewNotes = [
          { path: "/weeks/00", code: "ambiguous", message: "Synthetic" },
        ];
      },
    ],
    [
      "missing expected source text",
      "source_missing-source-text",
      (p) => {
        p.reviewNotes = [
          {
            path: "/manifest/coachText",
            code: "missing-source-text",
            message: "Expected source text is missing.",
          },
        ];
      },
    ],
    [
      "missing zone",
      "missing_zone",
      (p) => {
        delete p.paceReferences[0].zone;
      },
    ],
    [
      "phase outside calendar",
      "invalid_phase_span",
      (p) => {
        p.phases[0].span = {
          kind: "dates",
          startDate: "2026-11-01",
          endDate: "2026-11-17",
        };
      },
    ],
    [
      "bad phase member",
      "invalid_reference",
      (p) => {
        p.weeks[0].days[0].phaseIds = ["missing"];
      },
    ],
    [
      "cross-workout progression",
      "cross_workout_progression",
      (p) => {
        p.progressions[0].workoutSessionId = "session-double";
      },
    ],
    [
      "wrong progression scope",
      "invalid_reference",
      (p) => {
        p.progressions[0].scope = "repetition";
      },
    ],
    [
      "reversed progression",
      "progression_order",
      (p) => {
        p.progressions[0].sequence.reverse();
      },
    ],
    [
      "week progression",
      "schema.enum",
      (p) => {
        Object.assign(p.progressions[0], { scope: "week" });
      },
    ],
    [
      "phase progression",
      "schema.enum",
      (p) => {
        Object.assign(p.progressions[0], { scope: "phase" });
      },
    ],
    [
      "missing progression wording",
      "missing_progression_text",
      (p) => {
        p.progressions[0].coachText = [];
      },
    ],
    [
      "incompatible progression units",
      "progression_dimension",
      (p) => {
        p.progressions[0].parameters = {
          quantityIncrement: { value: 30, unit: "s" },
        };
      },
    ],
    [
      "invalid UTC timestamp",
      "invalid_timestamp",
      (p) => {
        p.manifest.generator.generatedAt = "2026-02-30T12:00:00Z";
      },
    ],
  ];
  it.each(invalidCases)("rejects %s", (_, code, mutate) => {
    const plan = copy(workout);
    mutate(plan);
    const original = JSON.stringify(plan);
    expect(errors(plan).map((issue) => issue.code)).toContain(code);
    expect(JSON.stringify(plan)).toBe(original);
  });

  it("handles leap dates without local timezone conversion", () => {
    const plan = copy();
    Object.assign(plan.calendar, {
      startDate: "2028-02-29",
      endDate: "2028-03-01",
    });
    Object.assign(plan.weeks[0], {
      startDate: "2028-02-29",
      endDate: "2028-03-01",
    });
    plan.weeks[0].days[0].date = "2028-02-29";
    plan.weeks[0].days[1].date = "2028-03-01";
    expect(validateTrainingPlan(plan).ok).toBe(true);
    plan.weeks[0].days[0].date = "2027-02-29";
    expect(errors(plan).map((issue) => issue.code)).toContain("invalid_date");
  });

  it("validates week transitions and permits partial first/last weeks", () => {
    const plan = copy();
    plan.calendar.startDate = "2026-11-15";
    plan.weeks.unshift({
      id: "partial-first",
      number: 1,
      startDate: "2026-11-15",
      endDate: "2026-11-15",
      coachText: [],
      days: [
        {
          id: "first-day",
          date: "2026-11-15",
          kind: "rest",
          sessions: [],
          coachText: [],
        },
      ],
    });
    plan.weeks[1].number = 2;
    expect(validateTrainingPlan(plan).ok).toBe(true);
    plan.weeks[1].startDate = "2026-11-17";
    expect(errors(plan).map((issue) => issue.code)).toContain("calendar_gap");
  });

  it("preserves synthetic workbook lineage, formula, values and date system", () => {
    const plan = copy();
    plan.sources = [
      {
        id: "synthetic-source",
        kind: "workbook",
        fileName: "SYNTHETIC-NOT-A-REAL-WORKBOOK.xlsx",
        sha256: "0".repeat(64),
        dateSystem: "1904",
      },
    ];
    plan.provenance = [
      {
        path: "",
        sourceId: "synthetic-source",
        location: { kind: "cell", sheet: "Synthetic", cell: "A1" },
        rawValue: 0,
        formattedText: "0.00",
        formula: "=0",
      },
    ];
    expect(parseTrainingPlan(serializeTrainingPlan(plan))).toMatchObject({
      ok: true,
      plan,
    });
    plan.provenance[0].location = {
      kind: "cell",
      sheet: "Synthetic",
      cell: "XFE1",
    };
    expect(errors(plan).map((issue) => issue.code)).toContain("invalid_cell");
  });

  it("does not let a single partial week cross its declared week boundary", () => {
    const plan = copy();
    Object.assign(plan.calendar, {
      startDate: "2026-11-15",
      endDate: "2026-11-16",
    });
    Object.assign(plan.weeks[0], {
      startDate: "2026-11-15",
      endDate: "2026-11-16",
    });
    plan.weeks[0].days[0].date = "2026-11-15";
    plan.weeks[0].days[1].date = "2026-11-16";
    expect(errors(plan).map((issue) => issue.code)).toContain(
      "invalid_week_span",
    );
  });

  it("does not resolve progression parameters into workout changes", () => {
    const plan = copy(workout);
    const before = JSON.stringify(plan);
    expect(validateTrainingPlan(plan).ok).toBe(true);
    expect(JSON.stringify(plan)).toBe(before);
    expect(work(plan).sets[0].repetitions[1].targets).toBeUndefined();
  });

  it("preserves conflicting within-workout rules and reports review warnings", () => {
    const plan = copy(workout);
    plan.progressions.push({
      ...plan.progressions[1],
      id: "progression-conflict",
      parameters: { paceIncrement: { value: -10, unit: "s/mi" } },
      coachText: ["Conflicting synthetic instruction retained."],
    });
    const result = validateTrainingPlan(plan);
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "progression_conflict",
        severity: "warning",
        path: "/progressions/2/parameters/paceIncrement",
      }),
    );
    expect(plan.progressions).toHaveLength(3);
  });

  it("preserves JSON Pointer escaping and treats unknown fields as data", () => {
    const plan = copy();
    plan["a/b~c"] = { text: "retained" };
    plan.reviewNotes.push({
      path: "/a~1b~0c/text",
      code: "ambiguous",
      message: "Synthetic source annotation.",
    });
    expect(validateTrainingPlan(plan).ok).toBe(true);
    const result = parseTrainingPlan(
      JSON.stringify(plan).slice(0, -1) +
        ',"__proto__":{"polluted":true},"constructor":{"note":"data"}}',
    );
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "unknown_optional_field",
          path: "/__proto__",
        }),
        expect.objectContaining({
          code: "unknown_optional_field",
          path: "/constructor",
        }),
      ]),
    );
    if (result.ok) {
      const restored = JSON.parse(serializeTrainingPlan(result.plan));
      expect(
        Object.getOwnPropertyDescriptor(restored, "__proto__")?.value,
      ).toEqual({ polluted: true });
      expect(Object.getPrototypeOf(restored)).toBe(Object.prototype);
    }
    expect({}).not.toHaveProperty("polluted");
  });

  it.each(["1.0", "1.2", "2.0"])(
    "rejects unsupported version %s explicitly",
    (schemaVersion) => {
      expect(errors({ ...independent, schemaVersion })[0]).toMatchObject({
        code: "unsupported_version",
        path: "/schemaVersion",
      });
    },
  );

  it.each([
    NaN,
    Infinity,
    -Infinity,
    undefined,
    () => undefined,
    1n,
    new Date(),
  ])("rejects non-JSON input %s", (value) => {
    expect(errors(value)[0].code).toBe("not_json");
  });

  it("rejects cycles, getters, sparse arrays, and excessive nesting", () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(errors(cycle)[0].code).toBe("not_json");
    const getter = Object.defineProperty({}, "value", {
      enumerable: true,
      get() {
        throw new Error("Must not invoke getter");
      },
    });
    expect(errors(getter)[0].code).toBe("not_json");
    expect(errors(new Array(2))[0].code).toBe("not_json");
    let nested: unknown = {};
    for (let index = 0; index < 66; index++) nested = { nested };
    expect(errors(nested)[0].code).toBe("input_limit");
  });

  it("returns stable parse diagnostics and rejects duplicate JSON keys", () => {
    expect(parseTrainingPlan("{")).toMatchObject({
      ok: false,
      diagnostics: [{ code: "invalid_json", path: "" }],
    });
    expect(
      parseTrainingPlan('{"schemaVersion":"1.0","schemaVersion":"1.1"}'),
    ).toMatchObject({
      ok: false,
      diagnostics: [{ code: "duplicate_json_key" }],
    });
    expect(parseTrainingPlan('{"nested":{"a":1,"\\u0061":2}}')).toMatchObject({
      ok: false,
      diagnostics: [{ code: "duplicate_json_key" }],
    });
    expect(parseTrainingPlan(" ".repeat(10 * 1024 * 1024 + 1))).toMatchObject({
      ok: false,
      diagnostics: [{ code: "input_limit" }],
    });
  });

  it("refuses to serialize an invalid plan", () => {
    const plan = copy();
    plan.weeks = [];
    expect(() => serializeTrainingPlan(plan)).toThrow("Invalid training plan");
  });

  it("keeps generated literals and required fields checked by TypeScript", () => {
    expectTypeOf<TrainingPlan["schemaVersion"]>().toEqualTypeOf<"1.1">();
    expectTypeOf<Progression["scope"]>().toEqualTypeOf<"set" | "repetition">();
    expectTypeOf<Session["role"]>().toEqualTypeOf<
      "main" | "double" | "independent" | "unspecified"
    >();
    // @ts-expect-error Units are required by the authoritative schema.
    const noUnit: Quantity = { value: 5 };
    // @ts-expect-error Required session identity cannot disappear from generation.
    const noSessionId: Session = {
      title: "Synthetic",
      runType: "easy",
      role: "independent",
      participation: "required",
      completionClass: "core",
      coachText: [],
    };
    expect(
      errors({ ...copy(), weeks: [{ ...copy().weeks[0], coreTarget: noUnit }] })
        .length,
    ).toBeGreaterThan(0);
    expect(noSessionId.title).toBe("Synthetic");
  });
});
