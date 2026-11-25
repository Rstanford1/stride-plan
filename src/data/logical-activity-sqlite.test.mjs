import { afterEach, expect, it } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LogicalActivityService } from "./logical-activity-service";
import { validateLogicalActivityState } from "../domain/logical-activity-validation";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
const directories = [];
function makeFixture() {
  const directory = mkdtempSync(join(tmpdir(), "stride-d3-synthetic-"));
  directories.push(directory);
  const path = join(directory, "synthetic.sqlite");
  const db = new DatabaseSync(path);
  db.exec(
    "PRAGMA synchronous=FULL; CREATE TABLE app_state (id INTEGER PRIMARY KEY, payload TEXT NOT NULL)",
  );
  db.prepare("INSERT INTO app_state VALUES(1, ?)").run(
    JSON.stringify({
      other: "synthetic history",
      logical: { activities: [], commands: [] },
    }),
  );
  const store = {
    async read() {
      return JSON.parse(
        db.prepare("SELECT payload FROM app_state WHERE id=1").get().payload,
      );
    },
    activities(snapshot) {
      return snapshot.logical;
    },
    withActivities(snapshot, logical) {
      return { ...snapshot, logical };
    },
    async compareAndCommit(before, after) {
      validateLogicalActivityState(after.logical);
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = db
          .prepare("UPDATE app_state SET payload=? WHERE id=1 AND payload=?")
          .run(JSON.stringify(after), JSON.stringify(before));
        db.exec("COMMIT");
        return result.changes === 1;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { db, path, directory, store };
}
afterEach(() => {
  for (const directory of directories.splice(0)) {
    if (!directory.startsWith(join(tmpdir(), "stride-d3-synthetic-")))
      throw new Error("Unexpected fixture path");
    rmSync(directory, { recursive: true });
  }
});
const request = {
  commandId: "command-1",
  activityId: "activity-1",
  eventId: "event-1",
  expectedRevision: null,
  assignedDate: "2026-11-24",
  plannedSessionId: null,
  sources: [
    {
      kind: "manual",
      sourceId: "manual-1",
      occurredAt: null,
      localDate: null,
      timezone: null,
    },
  ],
  recorded: {
    distanceMiles: 4,
    durationSeconds: 2400,
    averageHr: null,
    outcome: "unplanned",
    note: null,
    shoeAllocations: [],
  },
  duplicateDecisions: [],
};
it("persists a synthetic confirmation and receipt through SQLite reopen and backup", async () => {
  const f = makeFixture();
  const service = new LogicalActivityService(
    f.store,
    () => "2026-11-24T12:00:00Z",
  );
  const result = await service.confirm(request);
  expect(result.status).toBe("confirmed");
  const backup = join(f.directory, "synthetic-backup.sqlite");
  f.db.prepare("VACUUM INTO ?").run(backup);
  f.db.close();
  for (const path of [f.path, backup]) {
    const recovered = new DatabaseSync(path, { readOnly: true });
    expect(
      recovered.prepare("PRAGMA integrity_check").get().integrity_check,
    ).toBe("ok");
    const snapshot = JSON.parse(
      recovered.prepare("SELECT payload FROM app_state WHERE id=1").get()
        .payload,
    );
    expect(snapshot.other).toBe("synthetic history");
    expect(snapshot.logical.activities[0].confirmed).toEqual(result.receipt);
    expect(() => validateLogicalActivityState(snapshot.logical)).not.toThrow();
    recovered.close();
  }
});
