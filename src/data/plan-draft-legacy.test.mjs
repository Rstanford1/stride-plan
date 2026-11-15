import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { invoke } from "@tauri-apps/api/core";
import { SqliteRepository, RestoreInputError } from "./repository";
import { createInitialData } from "../domain/seed";
import { MemoryFitSourceStore } from "./fit-source-store";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const profiles = [];
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
  for (const { db, root } of profiles.splice(0)) {
    db.close();
    if (!root.startsWith(join(tmpdir(), "stride-t05-legacy-")))
      throw new Error("Unexpected fixture path");
    rmSync(root, { recursive: true });
  }
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "stride-t05-legacy-"));
  const db = new DatabaseSync(join(root, "synthetic.sqlite"));
  profiles.push({ root, db });
  db.exec(
    "CREATE TABLE app_state (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL, updated_at TEXT NOT NULL)",
  );
  const raw = JSON.stringify(createInitialData());
  db.prepare("INSERT INTO app_state VALUES(1,?,'original')").run(raw);
  const adapter = {
    select: async (sql, values = []) =>
      db
        .prepare(sql)
        .all(Object.fromEntries(values.map((v, i) => [`$${i + 1}`, v]))),
    execute: async (sql, values = []) => ({
      rowsAffected: Number(
        db
          .prepare(sql)
          .run(Object.fromEntries(values.map((v, i) => [`$${i + 1}`, v])))
          .changes,
      ),
    }),
  };
  return {
    db,
    raw,
    adapter,
    repository: new SqliteRepository(
      async () => adapter,
      new MemoryFitSourceStore(),
    ),
  };
}
describe("native draft coexistence with T02 legacy persistence", () => {
  it("permits ordinary active-snapshot saves but blocks legacy restore before copying or writing", async () => {
    const f = fixture();
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    let present = false;
    vi.mocked(invoke).mockImplementation(async () => ({
      contractVersion: 1,
      snapshot: f.raw,
      draft: present ? {} : null,
    }));
    const active = await f.repository.load();
    f.db.exec(
      readFileSync(
        join(process.cwd(), "src-tauri/migrations/0003_plan_draft.sql"),
        "utf8",
      ),
    );
    f.db.exec("PRAGMA user_version=3");
    present = true;
    active.settings.easyHrHigh = 157;
    await f.repository.save(active);
    expect(
      JSON.parse(f.db.prepare("SELECT payload FROM app_state").get().payload)
        .settings.easyHrHigh,
    ).toBe(157);
    await expect(f.repository.restore(f.raw)).rejects.toBeInstanceOf(
      RestoreInputError,
    );
    expect(f.repository.state).toBe("valid");
    expect(
      f.db
        .prepare(
          "SELECT count(*) AS n FROM sqlite_master WHERE name='snapshot_recovery'",
        )
        .get().n,
    ).toBe(0);
  });
  it("handles the native atomic guard rejecting a first-draft/restore race without locking good data", async () => {
    const f = fixture();
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "inspect_plan_draft")
        return { contractVersion: 1, snapshot: f.raw, draft: null };
      if (command === "replace_legacy_snapshot")
        throw { contractVersion: 1, code: "legacy_blocked" };
      throw new Error("Unexpected command");
    });
    await f.repository.load();
    const replacement = createInitialData();
    replacement.sessions = [];
    await expect(
      f.repository.restore(JSON.stringify(replacement)),
    ).rejects.toBeInstanceOf(RestoreInputError);
    expect(f.repository.state).toBe("valid");
    expect(f.db.prepare("SELECT payload FROM app_state").get().payload).toBe(
      f.raw,
    );
  });
  it("rejects unknown native versions before opening the SQL-plugin repository", async () => {
    const open = vi.fn();
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    vi.mocked(invoke).mockRejectedValue({
      contractVersion: 1,
      code: "unsupported",
    });
    await expect(new SqliteRepository(open).load()).rejects.toThrow();
    expect(open).not.toHaveBeenCalled();
  });
});
