import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  linkSync,
  symlinkSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  captureProfile,
  compareSnapshots,
  compareRecovery,
  verifyRecovery,
  requireSafePath,
  run,
  sha256,
  identity,
} from "./t081-profile-check.mjs";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    assert.ok(root.startsWith(join(tmpdir(), "stride-t081-tools-")));
    rmSync(root, { recursive: true, force: true });
  }
});
const source = resolve(process.env.T081_TEST_SOURCE_DIRECTORY || ".");
const sourceBytes = readFileSync(
  join(source, "src/domain/__fixtures__/training-plan/valid-partial.json"),
);
const pre16 =
    "316c146e89591f77fe0abd43f4df1ed74d845f09dd305d4078acf49ef0d028e9",
  current11 =
    "d4355feb48bc3b2df0443c9314011ef5ac05826fc3aaa7b53dc78c2bf79303ba";
function fixture(fp = current11) {
  const root = mkdtempSync(join(tmpdir(), "stride-t081-tools-"));
  roots.push(root);
  const environment = {
    APPDATA: join(root, "roaming"),
    LOCALAPPDATA: join(root, "local"),
  };
  const config = join(environment.APPDATA, identity),
    local = join(environment.LOCALAPPDATA, identity),
    hash = sha256(sourceBytes),
    kit = join(root, "kit");
  mkdirSync(config, { recursive: true });
  mkdirSync(join(local, "plan-sources", hash.slice(0, 2)), { recursive: true });
  mkdirSync(kit);
  const dbFile = join(config, "stride-plan.db");
  const db = new DatabaseSync(dbFile);
  db.exec(
    "PRAGMA foreign_keys=ON; CREATE TABLE app_state(id INTEGER PRIMARY KEY,payload TEXT); INSERT INTO app_state VALUES(1,'synthetic snapshot');",
  );
  db.exec(
    readFileSync(
      join(source, "src-tauri/migrations/0003_plan_draft.sql"),
      "utf8",
    ),
  );
  db.exec("PRAGMA user_version=3");
  const stamp = "2026-11-17T00:00:00.000Z";
  db.prepare("INSERT INTO plan_draft_sources VALUES(?,?,?,?,?)").run(
    `plan-source:${hash}`,
    hash,
    sourceBytes.length,
    "synthetic.json",
    stamp,
  );
  db.prepare("INSERT INTO plan_drafts VALUES(1,?,?,?,?,?,1,'draft',?)").run(
    `plan-draft:${hash}`,
    `plan-source:${hash}`,
    "synthetic-plan",
    "synthetic-version-1",
    null,
    stamp,
  );
  const report = JSON.stringify([
    {
      severity: "warning",
      code: "synthetic",
      path: "",
      message: "Exact synthetic evidence",
    },
  ]);
  db.prepare("INSERT INTO plan_draft_validation VALUES(?,?,?,?,?,?)").run(
    `plan-draft:${hash}`,
    "1.1",
    "t01-1",
    fp,
    report,
    sha256(report),
  );
  db.close();
  writeFileSync(
    join(local, "plan-sources", hash.slice(0, 2), hash + ".json"),
    sourceBytes,
  );
  const manifest = {
    format: "stride-plan-t081-acceptance-kit",
    identifier: identity,
    baselineSourceCommit: "fb7ff13ce64378e7b63a7c39b6df634971029da4",
    upgradeSourceCommit: "ff18ad0f7d9875ae0253d2623a292ae0e465abc9",
    syntheticSourceHashes: [hash],
    validatorFingerprints: { 1.1: [pre16, current11], 1.2: ["b".repeat(64)] },
  };
  writeFileSync(
    join(kit, "acceptance-manifest.json"),
    JSON.stringify(manifest),
  );
  return { root, config, local, dbFile, manifest, environment, kit, hash };
}
function migrate(f) {
  const db = new DatabaseSync(f.dbFile);
  try {
    mkdirSync(join(f.config, "t081-safety"));
    db.prepare("VACUUM INTO ?").run(
      join(f.config, "t081-safety/before-v4-aaaaaaaa-1111.sqlite"),
    );
    db.exec("BEGIN IMMEDIATE");
    db.exec(
      readFileSync(
        join(source, "src-tauri/migrations/0004_plan_draft_versions.sql"),
        "utf8",
      ),
    );
    db.exec("PRAGMA user_version=4; COMMIT");
  } finally {
    db.close();
  }
}
function recovery(f, fp = current11) {
  const stamp = "2026-11-17T00:00:00.000Z";
  const record = {
    sourceId: `plan-source:${f.hash}`,
    sourceHash: f.hash,
    byteLength: sourceBytes.length,
    originalFileName: "synthetic.json",
    importedAt: stamp,
    draftId: `plan-draft:${f.hash}`,
    planId: "synthetic-plan",
    versionId: "synthetic-version-1",
    parentVersionId: null,
    revision: 1,
    state: "draft",
    createdAt: stamp,
    schemaVersion: "1.1",
    validatorVersion: "t01-1",
    validatorFingerprint: fp,
    diagnosticsJson: "[]",
    diagnosticsHash: sha256("[]"),
  };
  return Buffer.from(
    JSON.stringify({
      contractVersion: 1,
      kind: "stride-plan-draft-recovery",
      record,
      recordHash: sha256(JSON.stringify(record)),
      sourceBase64: sourceBytes.toString("base64"),
    }),
  );
}
for (const fp of [pre16, current11])
  test(`captures and compares unchanged source/report/fingerprint ${fp.slice(0, 8)} using readonly SQLite`, () => {
    const f = fixture(fp),
      hash = sha256(readFileSync(f.dbFile));
    const before = captureProfile(f.manifest, f.environment);
    assert.equal(sha256(readFileSync(f.dbFile)), hash);
    migrate(f);
    const after = captureProfile(f.manifest, f.environment);
    assert.equal(compareSnapshots(before, after).verified, true);
    assert.equal(after.record.validation.validator_fingerprint, fp);
    assert.equal(
      compareRecovery(recovery(f, fp), recovery(f, fp), f.manifest)
        .byteIdenticalRecoveryFiles,
      true,
    );
  });
test("detects changed validation evidence, source hash, fingerprint, missing safety copy and wrong storage version", () => {
  const f = fixture(),
    before = captureProfile(f.manifest, f.environment);
  migrate(f);
  const after = captureProfile(f.manifest, f.environment);
  for (const mutate of [
    (v) => (v.record.validation.diagnostics_json = "[]"),
    (v) => (v.originalSourceSha256 = "a".repeat(64)),
    (v) => (v.record.validation.validator_fingerprint = pre16),
    (v) => (v.backups = []),
    (v) => (v.databaseVersion = 3),
  ]) {
    const altered = structuredClone(after);
    mutate(altered);
    assert.throws(() => compareSnapshots(before, altered));
  }
});
test("rejects unknown fingerprints and future recovery versions, even with recomputed envelope checksums", () => {
  const f = fixture();
  assert.throws(() => verifyRecovery(recovery(f, "a".repeat(64)), f.manifest));
  const envelope = JSON.parse(recovery(f));
  envelope.record.schemaVersion = "1.3";
  envelope.recordHash = sha256(JSON.stringify(envelope.record));
  assert.throws(() =>
    verifyRecovery(Buffer.from(JSON.stringify(envelope)), f.manifest),
  );
});
test("refuses private/noncatalogued source bytes and modified recovery output", () => {
  const f = fixture();
  const envelope = JSON.parse(recovery(f));
  envelope.record.originalFileName = "renamed.json";
  envelope.recordHash = sha256(JSON.stringify(envelope.record));
  assert.throws(() =>
    compareRecovery(
      recovery(f),
      Buffer.from(JSON.stringify(envelope)),
      f.manifest,
    ),
  );
  f.manifest.syntheticSourceHashes = [];
  assert.throws(() => captureProfile(f.manifest, f.environment));
});
test("writes captures exclusively under the kit and refuses overwriting or path overrides", () => {
  const f = fixture(),
    before = sha256(readFileSync(f.dbFile));
  assert.equal(
    run(["capture-before"], f.kit, f.environment).databaseVersion,
    3,
  );
  assert.equal(sha256(readFileSync(f.dbFile)), before);
  assert.throws(() => run(["capture-before"], f.kit, f.environment));
  assert.throws(() => run(["capture-before", f.dbFile], f.kit, f.environment));
  assert.throws(() =>
    run(
      ["compare-recovery", "../foreign.json", "after.json"],
      f.kit,
      f.environment,
    ),
  );
});
test("rejects normal application path components before file access", () => {
  const f = fixture();
  assert.throws(
    () =>
      requireSafePath(join(f.root, "com.strideplan.desktop/stride-plan.db")),
    /forbidden/,
  );
  assert.throws(() =>
    captureProfile(f.manifest, {
      ...f.environment,
      APPDATA: join(f.root, "com.strideplan.desktop"),
    }),
  );
});
test("rejects a shared hardlinked database and a junction in a test path", () => {
  const f = fixture();
  linkSync(f.dbFile, join(f.root, "db-link.sqlite"));
  assert.throws(() => captureProfile(f.manifest, f.environment), /shared/);
  const target = join(f.root, "foreign");
  mkdirSync(target);
  const linked = join(f.root, "junction");
  symlinkSync(
    target,
    linked,
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.throws(() => requireSafePath(join(linked, "file")), /Linked/);
});
