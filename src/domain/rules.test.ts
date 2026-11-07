import { describe, expect, it } from "vitest";
import { createSeedSessions } from "./seed";
import { reviseSession, validateSessionUpdate } from "./rules";

describe("session transitions", () => {
  it("moves a session without changing its identity or original date", () => {
    const session = createSeedSessions().find((item) => item.kind === "easy")!;
    const moved = reviseSession(
      session,
      { scheduledDate: "2026-10-30" },
      "Weather",
      "2026-10-27T10:00:00Z",
    );
    expect(moved.id).toBe(session.id);
    expect(moved.originalDate).toBe(session.originalDate);
    expect(moved.scheduledDate).toBe("2026-10-30");
    expect(moved.status).toBe("moved");
    expect(moved.revisions).toHaveLength(1);
  });

  it("requires an explanation for modified outcomes", () => {
    const session = createSeedSessions().find((item) => item.kind === "easy")!;
    expect(validateSessionUpdate(session, { status: "modified" })).toContain(
      "Describe what changed for a modified session.",
    );
  });

  it("does not treat rest days as completed runs", () => {
    const rest = createSeedSessions().find((item) => item.kind === "rest")!;
    expect(validateSessionUpdate(rest, { status: "completed" })).toContain(
      "Rest days are not completed runs.",
    );
  });
});
