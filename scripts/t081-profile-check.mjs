/** Read-only acceptance checks. No application launch, migration, credential access or upload. */
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
export const identity = "com.strideplan.t081test";
export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function requireSafePath(input) {
  if (!isAbsolute(input)) throw Error("An absolute test path is required");
  const path = resolve(input);
  if (
    path
      .split(/[\\/]/)
      .some((p) =>
        ["com.strideplan.desktop", "stride plan"].includes(p.toLowerCase()),
      )
  )
    throw Error("Normal Stride Plan profile/installation paths are forbidden");
  let current = parse(path).root;
  for (const part of path.slice(current.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    if (!existsSync(current)) {
      // lstat catches dangling links that existsSync intentionally follows.
      try {
        if (lstatSync(current).isSymbolicLink())
          throw Error("Linked test paths are forbidden");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      continue;
    }
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && stat.nlink !== 1))
      throw Error("Linked or shared test files are forbidden");
  }
  return path;
}
export function requireManifest(manifest) {
  if (
    manifest.format !== "stride-plan-t081-acceptance-kit" ||
    manifest.identifier !== identity ||
    manifest.baselineSourceCommit !==
      "fb7ff13ce64378e7b63a7c39b6df634971029da4" ||
    manifest.upgradeSourceCommit !== "ff18ad0f7d9875ae0253d2623a292ae0e465abc9"
  )
    throw Error("Unrecognized acceptance kit identity/source pins");
  if (
    !Array.isArray(manifest.syntheticSourceHashes) ||
    !manifest.syntheticSourceHashes.length ||
    !manifest.validatorFingerprints
  )
    throw Error("Synthetic source and validator catalog missing");
}
function validateIdentity(version, validator, fingerprint, manifest) {
  const expected =
    version === "1.1" ? "t01-1" : version === "1.2" ? "t081-1" : undefined;
  if (
    !expected ||
    validator !== expected ||
    !manifest.validatorFingerprints[version]?.includes(fingerprint)
  )
    throw Error("Unsupported schema/validator/fingerprint");
}
function validateSource(bytes, hash, manifest) {
  if (sha256(bytes) !== hash || !manifest.syntheticSourceHashes.includes(hash))
    throw Error("Only exact synthetic kit source bytes are accepted");
  const plan = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  if (
    plan.manifest?.planId !== "synthetic-plan" ||
    !plan.sources?.every(
      (s) => s.id === "synthetic-source" && s.kind === "authored",
    )
  )
    throw Error("Unexpected synthetic source identity");
  return plan;
}
function readDatabase(file) {
  requireSafePath(file);
  for (const suffix of ["-wal", "-shm", "-journal"])
    requireSafePath(file + suffix);
  if (!existsSync(file))
    throw Error("Isolated test database does not exist; nothing was created");
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    if (
      db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok" ||
      db.prepare("PRAGMA foreign_key_check").all().length
    )
      throw Error("Test database failed integrity verification");
    const version = db.prepare("PRAGMA user_version").get().user_version;
    const snapshot = db
      .prepare("SELECT payload FROM app_state WHERE id=1")
      .get();
    if (!snapshot) throw Error("Test app snapshot is missing");
    if (version === 0)
      return {
        databaseVersion: 0,
        activeSnapshotSha256: sha256(snapshot.payload),
        record: null,
      };
    if (![3, 4].includes(version))
      throw Error("Unsupported test database version");
    const record = {};
    for (const [key, table] of [
      ["source", "plan_draft_sources"],
      ["draft", "plan_drafts"],
      ["validation", "plan_draft_validation"],
    ]) {
      const rows = db.prepare(`SELECT * FROM ${table}`).all();
      if (rows.length !== 1)
        throw Error("Expected exactly one synthetic draft in the test slot");
      record[key] = rows[0];
    }
    return {
      databaseVersion: version,
      activeSnapshotSha256: sha256(snapshot.payload),
      record,
    };
  } finally {
    db.close();
  }
}
export function captureProfile(manifest, environment = process.env) {
  requireManifest(manifest);
  if (
    !environment.APPDATA ||
    !environment.LOCALAPPDATA ||
    !isAbsolute(environment.APPDATA) ||
    !isAbsolute(environment.LOCALAPPDATA)
  )
    throw Error("Windows test application directories are unavailable");
  const configRoot = requireSafePath(join(environment.APPDATA, identity));
  const localRoot = requireSafePath(join(environment.LOCALAPPDATA, identity));
  const snapshot = readDatabase(join(configRoot, "stride-plan.db"));
  if (!snapshot.record) throw Error("No saved synthetic draft");
  const { source, draft, validation } = snapshot.record;
  if (!/^[0-9a-f]{64}$/.test(source.source_hash))
    throw Error("Invalid synthetic source hash");
  validateIdentity(
    validation.schema_version,
    validation.validator_version,
    validation.validator_fingerprint,
    manifest,
  );
  const sourceFile = requireSafePath(
    join(
      localRoot,
      "plan-sources",
      source.source_hash.slice(0, 2),
      source.source_hash + ".json",
    ),
  );
  const bytes = readFileSync(sourceFile);
  const plan = validateSource(bytes, source.source_hash, manifest);
  if (
    bytes.length !== source.byte_length ||
    source.source_id !== `plan-source:${source.source_hash}` ||
    draft.source_id !== source.source_id ||
    draft.draft_id !== `plan-draft:${source.source_hash}` ||
    draft.plan_id !== plan.manifest.planId ||
    draft.version_id !== plan.manifest.versionId ||
    validation.draft_id !== draft.draft_id ||
    validation.schema_version !== plan.schemaVersion ||
    sha256(validation.diagnostics_json) !== validation.diagnostics_hash
  )
    throw Error("Synthetic source/draft/validation evidence differs");
  if (!Array.isArray(JSON.parse(validation.diagnostics_json)))
    throw Error("Invalid recorded report");
  const backups = [];
  const safety = requireSafePath(join(configRoot, "t081-safety"));
  if (existsSync(safety))
    for (const name of readdirSync(safety)) {
      if (!/^before-v4-[0-9a-f-]+\.sqlite$/i.test(name))
        throw Error("Unexpected test safety-copy entry");
      const file = requireSafePath(join(safety, name));
      backups.push({ name, ...readDatabase(file) });
    }
  return {
    format: "stride-plan-t081-profile-snapshot",
    identifier: identity,
    ...snapshot,
    originalByteLength: bytes.length,
    originalSourceSha256: sha256(bytes),
    backups,
  };
}
export function compareSnapshots(before, after) {
  if (
    before.identifier !== identity ||
    after.identifier !== identity ||
    before.databaseVersion !== 3 ||
    after.databaseVersion !== 4
  )
    throw Error(
      "Expected the same test identity with a v3-to-v4 storage upgrade",
    );
  if (
    !same(before.record, after.record) ||
    before.originalSourceSha256 !== after.originalSourceSha256 ||
    before.originalByteLength !== after.originalByteLength ||
    before.activeSnapshotSha256 !== after.activeSnapshotSha256
  )
    throw Error(
      "Original source, validation evidence or existing app snapshot changed",
    );
  if (
    !after.backups?.some(
      (copy) =>
        copy.databaseVersion === 3 &&
        same(copy.record, before.record) &&
        copy.activeSnapshotSha256 === before.activeSnapshotSha256,
    )
  )
    throw Error("Matching pre-migration safety copy was not verified");
  return {
    verified: true,
    identifier: identity,
    databaseVersionBefore: 3,
    databaseVersionAfter: 4,
    sourceBytesUnchanged: true,
    validationRecordUnchanged: true,
    matchingSafetyCopy: true,
    sourceSha256: after.originalSourceSha256,
    validatorFingerprint: after.record.validation.validator_fingerprint,
  };
}
export function verifyRecovery(bytes, manifest) {
  requireManifest(manifest);
  const envelope = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  if (
    envelope.contractVersion !== 1 ||
    envelope.kind !== "stride-plan-draft-recovery"
  )
    throw Error("Unsupported recovery envelope");
  const r = envelope.record;
  if (sha256(JSON.stringify(r)) !== envelope.recordHash)
    throw Error("Recovery record checksum mismatch");
  validateIdentity(
    r.schemaVersion,
    r.validatorVersion,
    r.validatorFingerprint,
    manifest,
  );
  const original = Buffer.from(envelope.sourceBase64, "base64");
  const plan = validateSource(original, r.sourceHash, manifest);
  if (
    r.schemaVersion !== plan.schemaVersion ||
    r.byteLength !== original.length ||
    r.planId !== plan.manifest.planId ||
    r.versionId !== plan.manifest.versionId ||
    sha256(r.diagnosticsJson) !== r.diagnosticsHash
  )
    throw Error("Recovery source/report differs");
  return {
    sourceSha256: r.sourceHash,
    validatorFingerprint: r.validatorFingerprint,
    envelopeSha256: sha256(bytes),
  };
}
export function compareRecovery(before, after, manifest) {
  const left = verifyRecovery(before, manifest);
  verifyRecovery(after, manifest);
  if (!Buffer.from(before).equals(Buffer.from(after)))
    throw Error(
      "Recovery files differ; original evidence was not preserved exactly",
    );
  return { verified: true, byteIdenticalRecoveryFiles: true, ...left };
}
export function run(
  args,
  kitRoot = dirname(fileURLToPath(import.meta.url)),
  environment = process.env,
) {
  requireSafePath(kitRoot);
  const manifest = JSON.parse(
    readFileSync(
      requireSafePath(join(kitRoot, "acceptance-manifest.json")),
      "utf8",
    ),
  );
  requireManifest(manifest);
  const reports = requireSafePath(join(kitRoot, "reports"));
  const reportFile = (name) => {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/.test(name) ||
      basename(name) !== name
    )
      throw Error("Use a JSON filename inside the kit reports folder");
    return requireSafePath(join(reports, name));
  };
  const command = args[0];
  if (["capture-before", "capture-after", "capture-new"].includes(command)) {
    if (args.length !== 1)
      throw Error("Capture accepts no profile path overrides");
    const snapshot = captureProfile(manifest, environment);
    const expected = command === "capture-before" ? 3 : 4;
    if (
      snapshot.databaseVersion !== expected ||
      (command === "capture-new" &&
        snapshot.record.validation.schema_version !== "1.2")
    )
      throw Error("Unexpected test phase; no report saved");
    mkdirSync(reports, { recursive: true });
    const file = reportFile(command.replace("capture-", "") + ".json");
    writeFileSync(file, JSON.stringify(snapshot, null, 2) + "\n", {
      flag: "wx",
    });
    return {
      saved: file,
      databaseVersion: snapshot.databaseVersion,
      sourceSha256: snapshot.originalSourceSha256,
      validatorFingerprint: snapshot.record.validation.validator_fingerprint,
    };
  }
  if (command === "compare-upgrade" && args.length === 1)
    return compareSnapshots(
      JSON.parse(readFileSync(reportFile("before.json"))),
      JSON.parse(readFileSync(reportFile("after.json"))),
    );
  if (command === "compare-pre16" && args.length === 2)
    return compareRecovery(
      readFileSync(
        requireSafePath(
          join(kitRoot, "fixtures/synthetic-pre16-recovery.json"),
        ),
      ),
      readFileSync(reportFile(args[1])),
      manifest,
    );
  if (command === "compare-recovery" && args.length === 3)
    return compareRecovery(
      readFileSync(reportFile(args[1])),
      readFileSync(reportFile(args[2])),
      manifest,
    );
  throw Error(
    "Use capture-before, capture-after, capture-new, compare-upgrade, or compare-recovery before.json after.json. Close the test app first. No profile is modified.",
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    console.log(JSON.stringify(run(process.argv.slice(2)), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
