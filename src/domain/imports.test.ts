import { describe, expect, it } from "vitest";
import { isDuplicateActivity, validatePlanRows } from "./imports";

describe("plan import", () => {
  it("preserves a valid zero-mile rest day", () => {
    const result = validatePlanRows([
      {
        date: "2026-11-09",
        title: "Rest",
        planned_miles: 0,
        session_type: "rest",
        flexible: false,
      },
    ]);
    expect(result.errors).toHaveLength(0);
    expect(result.validRows[0].planned_miles).toBe(0);
  });

  it("reports invalid dates, distance, and duplicate dates", () => {
    const result = validatePlanRows([
      {
        date: "11/09/26",
        title: "Easy",
        planned_miles: -1,
        session_type: "easy",
        flexible: false,
      },
      {
        date: "2026-11-10",
        title: "Easy",
        planned_miles: 3,
        session_type: "easy",
        flexible: false,
      },
      {
        date: "2026-11-10",
        title: "Recovery",
        planned_miles: 2,
        session_type: "recovery",
        flexible: true,
      },
    ]);
    expect(result.errors).toHaveLength(1);
    expect(result.duplicateDates).toEqual(["2026-11-10"]);
  });

  it("detects repeat activity fingerprints", () => {
    expect(isDuplicateActivity("abc", ["abc", "def"])).toBe(true);
    expect(isDuplicateActivity("xyz", ["abc", "def"])).toBe(false);
  });
});
