import { describe, expect, it } from "vitest";
import {
  originalConversionPrompt,
  conversionPrompt,
} from "./plan-conversion-prompt";
import { validationFeedback } from "./plan-conversion";
import { validateTrainingPlan } from "./training-plan-validation";
import type { PlanDiagnostic, TrainingPlan } from "./training-plan-contract";
import independent from "./__fixtures__/training-plan/valid-independent.json";

describe("T07 conversion instructions", () => {
  it("retains the full original prompt and adds the specific approved preservation rules", () => {
    expect(conversionPrompt.startsWith(originalConversionPrompt)).toBe(true);
    expect(originalConversionPrompt.split("\n").length).toBeGreaterThan(100);
    for (const phrase of [
      "every relevant page, worksheet, date, training week, phase, legend, footnote, and coach instruction",
      "Never silently omit a session or instruction.",
      "meaningful wording, numbers, punctuation, line breaks, units, and qualifications",
      "If a required field cannot be established truthfully",
      "actually calculated it from the original file",
      "Do not mislabel a PDF as an Excel workbook",
      "Number of weeks and sessions converted.",
      "Do not change my training plan, provide coaching advice, or invent workouts.",
    ])
      expect(originalConversionPrompt).toContain(phrase);
    for (const phrase of [
      "example is synthetic",
      "leading/trailing spaces",
      "Missing values are not zero",
      "Same-day runs are not automatically doubles",
      "Optional must be flexible",
      "Extra/flexible mileage cannot complete missed core work",
      "recoveryAfter",
      "hammerRepetitionIndices",
      "workoutSessionId",
      "Do not execute progressions",
      "RFC 6901",
      "requiredFeatures is []",
      "real fileName and calculated lowercase SHA-256",
      "missing-source-text is blocking",
      "downloadable UTF-8",
    ])
      expect(conversionPrompt).toContain(phrase);
  });

  it("constructs safe feedback while omitting source note paths, text and identifiers", () => {
    const plan = structuredClone(independent) as TrainingPlan;
    plan.reviewNotes.push({
      code: "missing-source-text",
      path: "/weeks/0/days/0/coachText",
      message: "Private coach words C:\\private\\coach.pdf",
    });
    plan.weeks[0].days[0].sessions[0].primarySessionId = "private-id";
    const result = validateTrainingPlan(plan);
    expect(result.ok).toBe(false);
    const feedback = validationFeedback(result.diagnostics);
    expect(feedback).toContain(
      "ERROR [source_missing-source-text] location withheld",
    );
    expect(feedback).toContain(
      "Only a double may have a primary-session link.",
    );
    expect(feedback).not.toContain("Private coach words");
    expect(feedback).not.toContain("C:\\private");
    expect(feedback).not.toContain("private-id");
    expect(feedback).toContain("Do not invent values");
    expect(feedback).toContain("modify unrelated workouts");
    expect(feedback).toContain("corrected downloadable UTF-8");
  });

  it("redacts arbitrary pointer keys and quoted references using actual diagnostics", () => {
    const plan = structuredClone(independent) as typeof independent &
      Record<string, unknown>;
    plan["C:\\private\\source"] = "private coach words";
    plan.provenance[0].sourceId = "private-source-reference";
    const feedback = validationFeedback(validateTrainingPlan(plan).diagnostics);
    expect(feedback).toContain("invalid_reference");
    expect(feedback).toContain("location withheld");
    expect(feedback).not.toContain("C:\\private");
    expect(feedback).not.toContain("private-source-reference");
    expect(feedback).not.toContain("private coach words");
  });

  it.each([
    "C:\\Users\\SYNTHETIC_PRIVATE\\coach.pdf",
    "\\\\server\\SYNTHETIC_PRIVATE\\coach.pdf",
    "/home/SYNTHETIC_PRIVATE/coach.pdf",
    "C:/Users/SYNTHETIC_PRIVATE\\coach.pdf",
    "weeks/0/SYNTHETIC_PRIVATE",
    "/weeks//SYNTHETIC_PRIVATE",
    "/weeks/0/days/0/~2SYNTHETIC_PRIVATE",
    "/manifest/title/../SYNTHETIC_PRIVATE",
  ])(
    "never copies source-provided paths from actual validation: %s",
    (path) => {
      const plan = structuredClone(independent) as TrainingPlan;
      plan.reviewNotes.push({
        path,
        code: "ambiguous",
        message: "SYNTHETIC_SECRET coach wording and credentials",
      });
      const result = validateTrainingPlan(plan);
      expect(result.ok).toBe(false);
      expect(
        result.diagnostics.some((issue) => issue.code === "source_ambiguous"),
      ).toBe(true);
      const feedback = validationFeedback(result.diagnostics);
      expect(feedback).toContain("ERROR [invalid_pointer] /reviewNotes/0/path");
      expect(feedback).toContain(
        "WARNING [source_ambiguous] location withheld",
      );
      expect(feedback).not.toContain(path);
      expect(feedback).not.toContain("SYNTHETIC_PRIVATE");
      expect(feedback).not.toContain("SYNTHETIC_SECRET");
    },
  );

  it.each([
    "C:\\Users\\SYNTHETIC_PRIVATE\\coach.pdf",
    "/home/SYNTHETIC_PRIVATE/coach.pdf",
    "C:/Users\\SYNTHETIC_PRIVATE/coach.pdf",
    "manifest/title",
    "/manifest//title",
    "/manifest/~2title",
    "/weeks/01/days",
    "/manifest/123456",
    "/extensions/manifest/title",
  ])(
    "omits unsafe locations even for a known structural diagnostic: %s",
    (path) => {
      const feedback = validationFeedback([
        {
          severity: "error",
          code: "schema.required",
          path,
          message: "SYNTHETIC_SECRET raw validator message",
        },
      ]);
      expect(feedback).toContain("ERROR [schema.required] location withheld");
      expect(feedback).toContain("A required field is missing.");
      expect(feedback).not.toContain(path);
      expect(feedback).not.toContain("SYNTHETIC_SECRET");
    },
  );

  it.each([
    "schema.required",
    "invalid_reference",
    "duplicate_id",
    "unsupported_version",
    "unsupported_feature",
    "source_ambiguous",
    "source_conflict",
    "source_unsupported",
    "source_missing-source-text",
    "SYNTHETIC_SECRET unknown diagnostic code",
  ])(
    "copies only allowlisted descriptions, never arbitrary messages or codes: %s",
    (code) => {
      const feedback = validationFeedback([
        {
          severity: "error",
          code,
          path: "/manifest/title",
          message:
            'SYNTHETIC_SECRET C:\\private\\coach.pdf /home/private/token {"coachText":["private workout"]}',
        },
      ]);
      expect(feedback).not.toContain("SYNTHETIC_SECRET");
      expect(feedback).not.toContain("coach.pdf");
      expect(feedback).not.toContain("/home/private");
      expect(feedback).not.toContain("private workout");
      expect(feedback).not.toContain('"coachText"');
      if (code.startsWith("source_"))
        expect(feedback).not.toContain("/manifest/title");
      if (code.startsWith("SYNTHETIC_SECRET"))
        expect(feedback).toContain("[unrecognized_diagnostic]");
    },
  );

  it("retains useful structural diagnostics and leaves original diagnostics intact", () => {
    const diagnostics: PlanDiagnostic[] = [
      {
        severity: "error",
        code: "schema.required",
        path: "/manifest",
        message: "private message",
      },
      {
        severity: "error",
        code: "wrong_dimension",
        path: "/weeks/0/days/1/sessions/0/distance/unit",
        message: "private message",
      },
      {
        severity: "error",
        code: "invalid_json",
        path: "",
        message: "private message",
      },
    ];
    const before = JSON.stringify(diagnostics);
    const feedback = validationFeedback(diagnostics);
    expect(feedback).toContain(
      "ERROR [schema.required] /manifest: A required field is missing.",
    );
    expect(feedback).toContain(
      "ERROR [wrong_dimension] /weeks/0/days/1/sessions/0/distance/unit",
    );
    expect(feedback).toContain("ERROR [invalid_json] document root");
    expect(feedback).not.toContain("private message");
    expect(JSON.stringify(diagnostics)).toBe(before);
  });

  it("demonstrates current PDF provenance constraints without changing the contract or inventing a workaround", () => {
    const plan = structuredClone(independent) as Record<string, any>;
    plan.sources = [
      {
        id: "source-pdf",
        kind: "pdf",
        fileName: "synthetic.pdf",
        sha256: "a".repeat(64),
      },
    ];
    plan.provenance = [
      { path: "", sourceId: "source-pdf", location: { kind: "pdf", page: 1 } },
    ];
    const result = validateTrainingPlan(plan);
    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some(
        (issue) =>
          issue.path === "/sources/0/kind" && issue.code.startsWith("schema."),
      ),
    ).toBe(true);
    expect(
      result.diagnostics.some(
        (issue) =>
          issue.path === "/provenance/0/location/kind" &&
          issue.code.startsWith("schema."),
      ),
    ).toBe(true);
    plan.sources = [];
    plan.provenance = [];
    expect(
      validateTrainingPlan(plan).diagnostics.some(
        (issue) => issue.code === "schema.minItems",
      ),
    ).toBe(true);
    plan.sources = [
      { id: "source-authored", kind: "authored", fileName: "synthetic.pdf" },
    ];
    plan.provenance = [
      { path: "", sourceId: "source-authored", location: { kind: "authored" } },
    ];
    expect(
      validateTrainingPlan(plan).diagnostics.some(
        (issue) => issue.code === "source_kind_conflict",
      ),
    ).toBe(true);
  });
});
