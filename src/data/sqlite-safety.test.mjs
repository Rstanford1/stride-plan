import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteRepository } from "./repository";
import { StrictMode, createElement } from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { AppProvider, useAppData } from "./app-context";
import { runFitImportBatch } from "./fit-import-controller";
import { FitFileParserDecoder } from "../domain/fit-decoder";
import { MemoryFitSourceStore } from "./fit-source-store";
import { createFitFixture } from "../test/fit-fixture";
import { createInitialData } from "../domain/seed";
const fixtures = [];
function fixture(raw) {
  const directory = mkdtempSync(join(tmpdir(), "stride-t02-synthetic-"));
  const path = join(directory, "synthetic.sqlite");
  const db = new DatabaseSync(path);
  fixtures.push({ db, directory });
  db.exec(
    "CREATE TABLE app_state (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL, updated_at TEXT NOT NULL)",
  );
  if (raw !== undefined)
    db.prepare("INSERT INTO app_state VALUES(1,?,?)").run(raw, "test");
  const adapter = {
    select: async (sql, values = []) =>
      db
        .prepare(sql)
        .all(
          Object.fromEntries(
            values.map((value, index) => [`$${index + 1}`, value]),
          ),
        ),
    execute: async (sql, values = []) => {
      const result = db
        .prepare(sql)
        .run(
          Object.fromEntries(
            values.map((value, index) => [`$${index + 1}`, value]),
          ),
        );
      return {
        rowsAffected: Number(result.changes),
        lastInsertId: Number(result.lastInsertRowid),
      };
    },
  };
  const repository = new SqliteRepository(async () => adapter);
  const stored = () =>
    db.prepare("SELECT payload FROM app_state WHERE id=1").get()?.payload;
  return { db, path, adapter, repository, stored };
}
afterEach(() => {
  cleanup();
  for (const { db, directory } of fixtures.splice(0)) {
    db.close();
    // Only fixture-owned mkdtemp children, never an application profile.
    if (!directory.startsWith(join(tmpdir(), "stride-t02-synthetic-")))
      throw new Error("Unexpected fixture path");
    rmSync(directory, { recursive: true });
  }
});

it.each([true, false])(
  "A3: overlapping imports preserve edits and reload through real SQLite (same bytes: %s)",
  async (sameBytes) => {
    const f = fixture(raw());
    let app;
    function Capture() {
      app = useAppData();
      return null;
    }
    render(
      createElement(
        StrictMode,
        null,
        createElement(
          AppProvider,
          { repository: f.repository },
          createElement(Capture),
        ),
      ),
    );
    await waitFor(() => expect(app.ready).toBe(true));
    const sources = new MemoryFitSourceStore();
    const decoder = new FitFileParserDecoder();
    function start() {
      const pending = app.beginFitImportBatch();
      let release;
      const bytes = new Promise((resolve) => {
        release = resolve;
      });
      const completion = runFitImportBatch({
        files: [{ name: "synthetic.fit", loadBytes: () => bytes }],
        existingSources: pending.existingSources,
        decoder,
        sourceStore: sources,
        createdAt: "2026-11-17T12:00:00Z",
      }).then(pending.commitFitImportBatch);
      return { release, completion };
    }
    const first = start(),
      second = start();
    let edited;
    act(() => {
      app.saveSession(
        app.data.sessions[0].id,
        { title: "Concurrent synthetic edit" },
        "Test",
      );
      app.saveJournal({
        id: "synthetic-journal",
        date: "2026-11-17",
        note: "Keep",
        updatedAt: "2026-11-17T12:00:00Z",
      });
      app.addShoe({
        id: "synthetic-shoe",
        name: "Keep",
        mileageMiles: 7,
        isDefault: false,
      });
      app.updateSettings({ easyHrHigh: 179 });
    });
    edited = app.data;
    // Both imports started with no sources; finish the second first.
    await act(async () => {
      second.release(
        createFitFixture({ distanceMeters: sameBytes ? 5000 : 6000 }),
      );
      await second.completion;
    });
    await act(async () => {
      first.release(createFitFixture());
      await first.completion;
    });
    const expected = app.data;
    expect(expected.sessions).toEqual(edited.sessions);
    expect(expected.journals).toEqual(edited.journals);
    expect(expected.shoes).toEqual(edited.shoes);
    expect(expected.settings).toEqual(edited.settings);
    const count = sameBytes ? 1 : 2;
    expect(expected.fitSources).toHaveLength(count);
    expect(new Set(expected.fitSources.map((s) => s.sourceHash)).size).toBe(
      count,
    );
    expect(expected.fitSourceActivities).toHaveLength(count);
    expect(
      expected.fitImportBatches.flatMap((b) =>
        b.sourceResults.map((r) => r.status),
      ),
    ).toEqual(["decoded", sameBytes ? "exact-duplicate" : "decoded"]);
    for (const batch of expected.fitImportBatches) {
      for (const result of batch.sourceResults) {
        expect(expected.fitSources.some((s) => s.id === result.sourceId)).toBe(
          true,
        );
        expect(result.activityIds).toEqual(
          result.status === "decoded"
            ? expected.fitSourceActivities
                .filter((a) => a.sourceId === result.sourceId)
                .map((a) => a.id)
            : [],
        );
      }
    }
    await waitFor(() =>
      expect(JSON.parse(f.stored())).toEqual(
        JSON.parse(JSON.stringify(expected)),
      ),
    );
    // A separate SQLite connection reads the durable committed row.
    const secondConnection = new DatabaseSync(f.path, { readOnly: true });
    try {
      expect(
        JSON.parse(
          secondConnection
            .prepare("SELECT payload FROM app_state WHERE id=1")
            .get().payload,
        ),
      ).toEqual(expected);
    } finally {
      secondConnection.close();
    }
    expect(
      await new SqliteRepository(async () => f.adapter, sources).load(),
    ).toEqual(expected);
  },
);
const raw = () => JSON.stringify(createInitialData(), null, 2);
const incoming = () => {
  const data = createInitialData();
  data.sessions = [];
  return JSON.stringify(data);
};
describe("real SQLite in isolated synthetic files", () => {
  it("initializes an empty database then reloads without reseeding", async () => {
    const f = fixture();
    f.db.exec("DROP TABLE app_state");
    const loaded = await f.repository.load();
    expect(await new SqliteRepository(async () => f.adapter).load()).toEqual(
      loaded,
    );
  });
  it.each([
    "",
    "{bad",
    JSON.stringify({ ...createInitialData(), schemaVersion: 6 }),
  ])(
    "leaves unreadable/incompatible data byte-for-byte intact",
    async (payload) => {
      const f = fixture(payload);
      await expect(f.repository.load()).rejects.toThrow();
      await expect(f.repository.save(createInitialData())).rejects.toThrow(
        "disabled",
      );
      expect(f.stored()).toBe(payload);
      expect(
        f.db
          .prepare(
            "SELECT name FROM sqlite_master WHERE name='snapshot_recovery'",
          )
          .all(),
      ).toEqual([]);
    },
  );
  it("commits restore durably and retains a verified pre-restore copy", async () => {
    const f = fixture(raw());
    await f.repository.load();
    const restored = await f.repository.restore(incoming());
    const second = new DatabaseSync(f.path, { readOnly: true });
    try {
      expect(
        JSON.parse(
          second.prepare("SELECT payload FROM app_state").get().payload,
        ),
      ).toEqual(restored);
      expect(
        second
          .prepare(
            "SELECT payload FROM snapshot_recovery WHERE purpose='before-restore'",
          )
          .get().payload,
      ).toBe(raw());
    } finally {
      second.close();
    }
    expect(await new SqliteRepository(async () => f.adapter).load()).toEqual(
      restored,
    );
  });
  it.each(["safety", "stage", "commit"])(
    "preserves old records after actual SQL abort at %s",
    async (phase) => {
      const f = fixture(raw());
      await f.repository.load();
      f.db.exec(
        "CREATE TABLE snapshot_recovery (id TEXT PRIMARY KEY, purpose TEXT NOT NULL, payload TEXT NOT NULL)",
      );
      if (phase === "commit")
        f.db.exec(
          "CREATE TRIGGER deny_commit BEFORE UPDATE ON app_state BEGIN SELECT RAISE(ABORT,'disk full'); END",
        );
      else
        f.db.exec(
          `CREATE TRIGGER deny_copy BEFORE INSERT ON snapshot_recovery WHEN NEW.purpose='${phase === "safety" ? "before-restore" : "restore-stage"}' BEGIN SELECT RAISE(ABORT,'disk full'); END`,
        );
      await expect(f.repository.restore(incoming())).rejects.toMatchObject({
        kind: "inaccessible",
      });
      expect(f.stored()).toBe(raw());
      expect(await new SqliteRepository(async () => f.adapter).load()).toEqual(
        createInitialData(),
      );
    },
  );
  it("fails closed on a real read-only SQLite connection", async () => {
    const f = fixture(raw());
    await f.repository.load();
    f.db.exec("PRAGMA query_only=ON");
    await expect(f.repository.restore(incoming())).rejects.toMatchObject({
      kind: "inaccessible",
    });
    expect(f.stored()).toBe(raw());
  });
  it("retains v3 raw bytes before upgrading in SQLite", async () => {
    const old = JSON.stringify(
        { ...createInitialData(), schemaVersion: 3 },
        null,
        2,
      ),
      f = fixture(old);
    expect((await f.repository.load()).schemaVersion).toBe(4);
    expect(
      f.db
        .prepare(
          "SELECT payload FROM snapshot_recovery WHERE purpose='before-migration'",
        )
        .get().payload,
    ).toBe(old);
  });
  it("rejects newer native tables, migration versions and populated normalized records", async () => {
    const f = fixture(raw());
    await f.repository.load();
    f.db.exec("CREATE TABLE plan_drafts (id TEXT)");
    await expect(f.repository.restore(incoming())).rejects.toMatchObject({
      kind: "unsupported",
    });
    expect(f.stored()).toBe(raw());
    f.db.exec(
      "DROP TABLE plan_drafts; CREATE TABLE shoes (id TEXT); INSERT INTO shoes VALUES ('native-shoe')",
    );
    await expect(f.repository.load()).rejects.toMatchObject({
      kind: "unsupported",
    });
    f.db.exec(
      "DROP TABLE shoes; CREATE TABLE _sqlx_migrations (version INTEGER); INSERT INTO _sqlx_migrations VALUES(3)",
    );
    await expect(f.repository.load()).rejects.toMatchObject({
      kind: "unsupported",
    });
    expect(f.stored()).toBe(raw());
  });
  it("does not overwrite another writer between staging and commit", async () => {
    const f = fixture(raw());
    await f.repository.load();
    const execute = f.adapter.execute;
    f.adapter.execute = async (sql, values) => {
      if (sql.startsWith("UPDATE app_state"))
        f.db
          .prepare("UPDATE app_state SET payload=?")
          .run("newer concurrent bytes");
      return execute(sql, values);
    };
    await expect(f.repository.restore(incoming())).rejects.toThrow();
    expect(f.stored()).toBe("newer concurrent bytes");
  });
  it("survives interruption after staging without publishing staged data", async () => {
    const f = fixture(raw());
    await f.repository.load();
    f.db.exec(
      "CREATE TABLE snapshot_recovery (id TEXT PRIMARY KEY, purpose TEXT NOT NULL, payload TEXT NOT NULL)",
    );
    f.db
      .prepare(
        "INSERT INTO snapshot_recovery VALUES ('stage', 'restore-stage', ?)",
      )
      .run(incoming());
    expect(await new SqliteRepository(async () => f.adapter).load()).toEqual(
      createInitialData(),
    );
    expect(f.stored()).toBe(raw());
  });
  it("surfaces opening/permission failures without any fallback", async () => {
    const repository = new SqliteRepository(async () => {
      throw new Error("Permission denied");
    });
    await expect(repository.load()).rejects.toMatchObject({
      kind: "inaccessible",
    });
    await expect(repository.save(createInitialData())).rejects.toThrow(
      "disabled",
    );
  });
});

it("never seeds over an orphaned SQLite safety copy", async () => {
  const f = fixture(raw());
  await f.repository.load();
  await f.repository.restore(incoming());
  f.db.exec("DELETE FROM app_state");
  await expect(
    new SqliteRepository(async () => f.adapter).load(),
  ).rejects.toMatchObject({ kind: "corrupted" });
  expect(f.stored()).toBeUndefined();
  expect(
    f.db
      .prepare(
        "SELECT payload FROM snapshot_recovery WHERE purpose='before-restore'",
      )
      .get().payload,
  ).toBe(raw());
});

it("initializes only app_state in a genuinely empty native database", async () => {
  const f = fixture();
  f.db.exec("DROP TABLE app_state");
  expect((await f.repository.load()).schemaVersion).toBe(4);
  expect(
    f.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((row) => row.name),
  ).toEqual(["app_state"]);
});

it("does not initialize a missing snapshot table in an existing native database", async () => {
  const f = fixture();
  f.db.exec("DROP TABLE app_state; CREATE TABLE shoes (id TEXT)");
  await expect(f.repository.load()).rejects.toMatchObject({
    kind: "corrupted",
  });
  expect(
    f.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((row) => row.name),
  ).toEqual(["shoes"]);
});

it.each([false, true])(
  "never reseeds a deleted active snapshot without recovery copies (empty recovery table: %s)",
  async (hasRecoveryTable) => {
    const f = fixture(raw());
    await f.repository.load();
    f.db.exec(
      "DELETE FROM app_state; CREATE TABLE _sqlx_migrations (version INTEGER); INSERT INTO _sqlx_migrations VALUES (2)",
    );
    if (hasRecoveryTable)
      f.db.exec(
        "CREATE TABLE snapshot_recovery (id TEXT PRIMARY KEY, purpose TEXT NOT NULL, payload TEXT NOT NULL)",
      );
    const before = readFileSync(f.path);
    const restarted = new SqliteRepository(async () => f.adapter);
    await expect(restarted.load()).rejects.toMatchObject({ kind: "corrupted" });
    await expect(restarted.save(createInitialData())).rejects.toThrow(
      "disabled",
    );
    await expect(f.repository.save(createInitialData())).rejects.toMatchObject({
      kind: "corrupted",
    });
    expect(f.stored()).toBeUndefined();
    expect(f.db.prepare("SELECT version FROM _sqlx_migrations").all()).toEqual([
      { version: 2 },
    ]);
    expect(readFileSync(f.path)).toEqual(before);
  },
);
