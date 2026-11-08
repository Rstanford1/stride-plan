import { describe, expect, it } from "vitest";
import { createSeedSessions } from "./seed";
import {
  durationFromPace,
  formatDuration,
  parseDurationInput,
  parsePaceInput,
  proposeDurationInterpretation,
  validateRunEntry,
  type RunEntryDraft,
} from "./run-entry";

const session = createSeedSessions().find((item) => item.kind === "easy")!;

function validDraft(): RunEntryDraft {
  return {
    status: "completed",
    modification: "",
    distanceMiles: 4,
    averageHr: 145,
    timeEntryMode: "duration",
    durationSeconds: 2400,
    paceUnit: "min-mi",
    rpe: 4,
    soreness: "none",
    sorenessLocation: "",
    sleepEntryMode: "subjective",
    sleep: "adequate",
    note: "",
  };
}

describe("duration parsing", () => {
  it("offers minutes and seconds for a single amount", () => {
    expect(parseDurationInput("42")).toEqual([
      { id: "minutes", label: "42 min", seconds: 2520 },
      { id: "seconds", label: "42 sec", seconds: 42 },
    ]);
  });

  it("offers both interpretations for two amounts", () => {
    expect(parseDurationInput("1:35").map((item) => item.seconds)).toEqual([
      5700, 95,
    ]);
  });

  it("treats three amounts as unambiguous", () => {
    expect(parseDurationInput("1:35:20")).toEqual([
      {
        id: "hours-minutes-seconds",
        label: "1 hr 35 min 20 sec",
        seconds: 5720,
      },
    ]);
  });

  it("rejects malformed clock values", () => {
    expect(parseDurationInput("1:72")).toEqual([]);
    expect(parseDurationInput("abc")).toEqual([]);
  });

  it("uses plausible pace to propose an ambiguous interpretation", () => {
    const options = parseDurationInput("42:21");
    expect(proposeDurationInterpretation(options, 4.5)?.id).toBe(
      "minutes-seconds",
    );
  });
});

describe("pace parsing", () => {
  it("parses pace and derives duration for miles and kilometres", () => {
    expect(parsePaceInput("9:21")).toBe(561);
    expect(durationFromPace(10, 561, "min-mi")).toBe(5610);
    expect(durationFromPace(10, 348, "min-km")).toBe(5601);
    expect(formatDuration(5610)).toBe("1:33:30");
  });
});

describe("run entry validation", () => {
  it("accepts a complete entry", () => {
    expect(validateRunEntry(session, validDraft())).toEqual({});
  });

  it("allows skipped entries without distance or time", () => {
    const draft = validDraft();
    draft.status = "skipped";
    draft.distanceMiles = undefined;
    draft.durationSeconds = undefined;
    expect(validateRunEntry(session, draft)).toEqual({});
  });

  it("requires an explanation for modified entries", () => {
    const draft = validDraft();
    draft.status = "modified";
    expect(validateRunEntry(session, draft).modification).toBeDefined();
  });

  it("preserves zero as a value and rejects missing time", () => {
    const draft = validDraft();
    draft.distanceMiles = 0;
    draft.durationSeconds = undefined;
    const errors = validateRunEntry(session, draft);
    expect(errors.distanceMiles).toBeUndefined();
    expect(errors.time).toBeDefined();
  });
});
