// Executes shipped migration SQL using real SQLite. Native orchestration is tested separately in Rust.
import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  copyFileSync,
  writeFileSync,
  openSync,
  fsyncSync,
  closeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
const ddl = readFileSync(
  join(process.cwd(), "src-tauri/migrations/0003_plan_draft.sql"),
  "utf8",
);
const migration = readFileSync(
  join(process.cwd(), "src-tauri/migrations/0004_plan_draft_versions.sql"),
  "utf8",
);
const identities = JSON.parse(
  readFileSync(
    join(process.cwd(), "src/test/historical-plan-validators.json"),
    "utf8",
  ),
);
const source = readFileSync(
  join(
    process.cwd(),
    "src/domain/__fixtures__/training-plan/valid-independent.json",
  ),
);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const roots = [];
const handles = [];
afterEach(() => {
  for (const db of handles.splice(0)) {
    try {
      db.close();
    } catch {}
  }
  for (const root of roots.splice(0)) {
    if (!root.startsWith(join(tmpdir(), "stride-t081-synthetic-")))
      throw Error("Unexpected fixture");
    rmSync(root, { recursive: true, force: true });
  }
});
function connect(file, readOnly = false) {
  const db = new DatabaseSync(file, { readOnly });
  handles.push(db);
  db.exec("PRAGMA foreign_keys=ON");
  return db;
}
function fixture(identity = identities[0]) {
  const root = mkdtempSync(join(tmpdir(), "stride-t081-synthetic-"));
  roots.push(root);
  const file = join(root, "synthetic.sqlite");
  const db = connect(file);
  db.exec(
    "CREATE TABLE app_state (id INTEGER PRIMARY KEY, payload TEXT NOT NULL); INSERT INTO app_state VALUES(1,'synthetic original snapshot');",
  );
  db.exec(ddl);
  db.exec("PRAGMA user_version=3");
  const h = hash(source);
  db.prepare("INSERT INTO plan_draft_sources VALUES(?,?,?,?,?)").run(
    `plan-source:${h}`,
    h,
    source.length,
    "synthetic.json",
    "2026-11-17T00:00:00.000Z",
  );
  db.prepare("INSERT INTO plan_drafts VALUES(1,?,?,?,?,?,1,'draft',?)").run(
    `plan-draft:${h}`,
    `plan-source:${h}`,
    "synthetic-plan",
    "synthetic-version-1",
    null,
    "2026-11-17T00:00:00.000Z",
  );
  db.prepare("INSERT INTO plan_draft_validation VALUES(?,?,?,?,?,?)").run(
    `plan-draft:${h}`,
    identity.schemaVersion,
    identity.validatorVersion,
    identity.validatorFingerprint,
    "[]",
    hash("[]"),
  );
  writeFileSync(join(root, "original-source.json"), source);
  return { root, file, db };
}
function inventory(db) {
  return Object.fromEntries(
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}"`).all()]),
  );
}
function verifiedBackup(f) {
  const file = join(f.root, "before-v4.sqlite");
  f.db.prepare("VACUUM INTO ?").run(file);
  const fd = openSync(file, "r+");
  fsyncSync(fd);
  closeSync(fd);
  const copy = connect(file, true);
  expect(copy.prepare("PRAGMA integrity_check").get().integrity_check).toBe(
    "ok",
  );
  expect(copy.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(inventory(copy)).toEqual(inventory(f.db));
  return file;
}
function migrate(db) {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(migration);
    db.exec("PRAGMA user_version=4");
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
describe("shipped 1.2 draft SQL and pre-migration recovery", () => {
  it.each(identities)(
    "preserves every historical $sourceCommit row and source byte and rejects incompatible validator pairs",
    (identity) => {
      const f = fixture(identity);
      verifiedBackup(f);
      const before = inventory(f.db);
      migrate(f.db);
      expect(inventory(f.db)).toEqual(before);
      expect(readFileSync(join(f.root, "original-source.json"))).toEqual(
        source,
      );
      expect(f.db.prepare("PRAGMA user_version").get().user_version).toBe(4);
      expect(f.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      for (const sql of [
        "UPDATE plan_draft_validation SET schema_version='1.3'",
        "UPDATE plan_draft_validation SET validator_version='future'",
        "UPDATE plan_draft_validation SET schema_version='1.2'",
        "UPDATE plan_draft_validation SET validator_version='t081-1'",
      ])
        expect(() => f.db.exec(sql)).toThrow();
      f.db.exec(
        "UPDATE plan_draft_validation SET schema_version='1.2', validator_version='t081-1'",
      );
      expect(
        f.db.prepare("SELECT schema_version FROM plan_draft_validation").get()
          .schema_version,
      ).toBe("1.2");
    },
  );
  it("rolls back failure at each migration statement and allows a clean retry", () => {
    const statements = migration
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    for (let stop = 1; stop <= statements.length; stop++) {
      const f = fixture();
      verifiedBackup(f);
      const before = inventory(f.db);
      const schema = f.db
        .prepare("SELECT name,sql FROM sqlite_master ORDER BY name")
        .all();
      f.db.exec("BEGIN IMMEDIATE");
      for (const sql of statements.slice(0, stop)) f.db.exec(sql);
      f.db.exec("ROLLBACK");
      expect(inventory(f.db)).toEqual(before);
      expect(
        f.db.prepare("SELECT name,sql FROM sqlite_master ORDER BY name").all(),
      ).toEqual(schema);
      expect(f.db.prepare("PRAGMA user_version").get().user_version).toBe(3);
      migrate(f.db);
      expect(inventory(f.db)).toEqual(before);
    }
  });
  it("recovers after a process is killed with the entire migration uncommitted", async () => {
    const f = fixture();
    verifiedBackup(f);
    const before = inventory(f.db);
    f.db.close();
    const child = spawn(
      process.execPath,
      [join(process.cwd(), "src/test/plan-migration-worker.mjs"), f.root],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(Error("Migration worker did not become ready")),
          4000,
        );
        timer.unref();
        child.stdout.on("data", (data) => {
          if (data.toString().includes("uncommitted")) {
            clearTimeout(timer);
            resolve();
          }
        });
        child.once("error", reject);
        child.once("exit", (code) => reject(Error(`worker exited ${code}`)));
      });
      const exited = once(child, "exit");
      child.kill();
      await exited;
    } finally {
      if (child.exitCode === null) child.kill();
    }
    const reopened = connect(f.file);
    expect(
      reopened.prepare("PRAGMA integrity_check").get().integrity_check,
    ).toBe("ok");
    expect(reopened.prepare("PRAGMA user_version").get().user_version).toBe(3);
    expect(inventory(reopened)).toEqual(before);
    migrate(reopened);
    expect(inventory(reopened)).toEqual(before);
  });
  it("restores the verified backup with old DDL while retaining newer data separately; post-backup changes are absent", () => {
    const f = fixture();
    const before = inventory(f.db);
    const oldSchema = f.db
      .prepare("SELECT name,sql FROM sqlite_master ORDER BY name")
      .all();
    const backup = verifiedBackup(f);
    migrate(f.db);
    f.db.exec("UPDATE app_state SET payload='synthetic later change'");
    f.db.close();
    const retained = join(f.root, "retained-migrated.sqlite");
    copyFileSync(f.file, retained);
    copyFileSync(backup, f.file);
    const restored = connect(f.file);
    expect(restored.prepare("PRAGMA user_version").get().user_version).toBe(3);
    expect(inventory(restored)).toEqual(before);
    expect(
      restored
        .prepare("SELECT name,sql FROM sqlite_master ORDER BY name")
        .all(),
    ).toEqual(oldSchema);
    const newer = connect(retained, true);
    expect(newer.prepare("SELECT payload FROM app_state").get().payload).toBe(
      "synthetic later change",
    );
    expect(
      restored.prepare("SELECT payload FROM app_state").get().payload,
    ).toBe("synthetic original snapshot");
  });
});
