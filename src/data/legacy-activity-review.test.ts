import { expect, it } from "vitest";
import { createInitialData } from "../domain/seed";
import type { ConfirmationCommand } from "../domain/logical-activity";
import { manualEvidence } from "./logical-activity-evidence";
import { reviewLegacyCandidates } from "./legacy-activity-review";

it("requires an explicit decision for possible older manual records", () => {
  const data = createInitialData();
  const old = {
    id: "old",
    date: "2026-11-24",
    actualDistanceMiles: 4,
    updatedAt: "2026-11-24T12:00:00Z",
  };
  const incoming = {
    id: "new",
    date: "2026-11-24",
    actualDistanceMiles: 4,
    updatedAt: "2026-11-24T13:00:00Z",
  };
  data.journals = [old];
  const command: ConfirmationCommand = {
    commandId: "cmd",
    activityId: "run",
    eventId: "event",
    expectedRevision: null,
    assignedDate: incoming.date,
    plannedSessionId: null,
    sources: [manualEvidence(incoming)],
    recorded: {
      distanceMiles: 4,
      durationSeconds: null,
      averageHr: null,
      outcome: "unplanned",
      note: null,
      shoeAllocations: [],
    },
    duplicateDecisions: [],
  };
  expect(reviewLegacyCandidates(data, command)).toEqual({
    status: "review-required",
    candidates: ["legacy:journal:old"],
  });
  const later = {
    ...command,
    legacyDuplicateDecisions: [
      { candidateId: "journal:old", decision: "review-later" as const },
    ],
  };
  expect(reviewLegacyCandidates(data, later)).toEqual({
    status: "review-later",
  });
  const both = {
    ...command,
    legacyDuplicateDecisions: [
      { candidateId: "journal:old", decision: "keep-both" as const },
    ],
  };
  expect(reviewLegacyCandidates(data, both)).toEqual({ status: "ready" });
  const merge = {
    ...command,
    legacyDuplicateDecisions: [
      { candidateId: "journal:old", decision: "merge" as const },
    ],
  };
  expect(() => reviewLegacyCandidates(data, merge)).toThrow(/preserved source/);
  expect(
    reviewLegacyCandidates(data, {
      ...merge,
      sources: [...command.sources, manualEvidence(old)],
    }),
  ).toEqual({ status: "ready" });
});
