/** Assemble public synthetic acceptance inputs from the pinned reviewed source. */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const workflowRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(process.argv[2]);
const output = join(process.env.RUNNER_TEMP, "t081-acceptance-kit");
const baseline = "fb7ff13ce64378e7b63a7c39b6df634971029da4",
  upgrade = "ff18ad0f7d9875ae0253d2623a292ae0e465abc9";
const git = (root, ...args) =>
  execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
if (
  git(source, "rev-parse", "HEAD") !== upgrade ||
  git(workflowRoot, "rev-parse", "HEAD") !== process.env.GITHUB_SHA
)
  throw Error("Unreviewed source/workflow revision");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const read = (path) => readFileSync(join(source, path));
const fingerprint = (version, file) =>
  hash(
    Buffer.concat([
      read(`schemas/training-plan/${version}.schema.json`),
      Buffer.from("\n---\n"),
      read(`src/domain/${file}`),
    ]),
  );
const catalog = JSON.parse(read("src/test/historical-plan-validators.json"));
const pre16 = fingerprint("1.1", "training-plan-validation-pre16.ts"),
  current11 = fingerprint("1.1", "training-plan-validation.ts"),
  current12 = fingerprint("1.2", "training-plan-validation-1.2.ts");
if (
  pre16 !== catalog[0].validatorFingerprint ||
  current11 !== catalog[1].validatorFingerprint
)
  throw Error("Historical fingerprint drift");
mkdirSync(output);
mkdirSync(join(output, "fixtures"));
const files = {},
  syntheticSourceHashes = [];
function emit(name, bytes) {
  if (!/^(?:fixtures\/)?[A-Za-z0-9._-]+$/.test(name))
    throw Error("Unsafe kit filename");
  writeFileSync(join(output, name), bytes, { flag: "wx" });
  files[name] = hash(bytes);
}
const requireFromSource = createRequire(join(source, "package.json"));
const { createServer } = await import(
  pathToFileURL(
    join(
      dirname(requireFromSource.resolve("vite/package.json")),
      "dist/node/index.js",
    ),
  )
);
const server = await createServer({
  root: source,
  configFile: false,
  optimizeDeps: { noDiscovery: true, include: [], entries: [] },
  server: { middlewareMode: true, watch: null, hmr: false },
  appType: "custom",
});
try {
  const legacy = await server.ssrLoadModule(
    "/src/domain/training-plan-validation-pre16.ts",
  );
  const intake = await server.ssrLoadModule("/src/domain/training-plan.ts");
  const names = [
    "valid-independent.json",
    "valid-partial.json",
    "valid-workout.json",
    "valid-1.2-40.json",
    "valid-1.2-55.json",
    "valid-1.2-65.json",
    "valid-1.2-75plus.json",
  ];
  for (const name of names) {
    const bytes = read(`src/domain/__fixtures__/training-plan/${name}`),
      plan = JSON.parse(bytes);
    if (
      plan.manifest.planId !== "synthetic-plan" ||
      !plan.sources.every(
        (s) => s.kind === "authored" && s.id === "synthetic-source",
      )
    )
      throw Error("Non-synthetic fixture rejected");
    const result = intake.parseTrainingPlan(new TextDecoder().decode(bytes));
    if (!result.ok) throw Error(`Invalid synthetic fixture: ${name}`);
    emit(`fixtures/${name}`, bytes);
    syntheticSourceHashes.push(hash(bytes));
  }
  const original = Buffer.from(
    "\ufeff" +
      read("src/domain/__fixtures__/training-plan/valid-partial.json")
        .toString("utf8")
        .replace(/\r?\n/g, "\r\n") +
      "\r\n ",
  );
  const parsed = legacy.parseTrainingPlan(
    new TextDecoder("utf-8", { fatal: true }).decode(original),
  );
  if (!parsed.ok)
    throw Error("Synthetic historical input failed its original validator");
  emit("fixtures/synthetic-1.1-bom-crlf.json", original);
  syntheticSourceHashes.push(hash(original));
  const sourceHash = hash(original),
    report = JSON.stringify(parsed.diagnostics),
    stamp = "2026-11-17T00:00:00.000Z";
  const record = {
    sourceId: `plan-source:${sourceHash}`,
    sourceHash,
    byteLength: original.length,
    originalFileName: "synthetic-1.1-bom-crlf.json",
    importedAt: stamp,
    draftId: `plan-draft:${sourceHash}`,
    planId: parsed.plan.manifest.planId,
    versionId: parsed.plan.manifest.versionId,
    parentVersionId: parsed.plan.manifest.parentVersionId ?? null,
    revision: 1,
    state: "draft",
    createdAt: stamp,
    schemaVersion: "1.1",
    validatorVersion: "t01-1",
    validatorFingerprint: pre16,
    diagnosticsJson: report,
    diagnosticsHash: hash(report),
  };
  const recovery = {
    contractVersion: 1,
    kind: "stride-plan-draft-recovery",
    record,
    recordHash: hash(JSON.stringify(record)),
    sourceBase64: original.toString("base64"),
  };
  // Validate the historical wire record through the real current frontend reader.
  // The adapter is synthetic: no Tauri command, file store or app profile is used.
  const { NativeDraftStore } = await server.ssrLoadModule(
    "/src/data/plan-draft-store.ts",
  );
  const readBack = await new NativeDraftStore(async (command) => {
    if (command !== "read_plan_draft")
      throw Error("Unexpected acceptance fixture operation");
    return { contractVersion: 1, record, bytes: Array.from(original) };
  }).read();
  if (
    JSON.stringify(readBack.record) !== JSON.stringify(record) ||
    !Buffer.from(readBack.preview.bytes).equals(original)
  )
    throw Error("Current reader changed historical evidence");
  emit(
    "fixtures/synthetic-pre16-recovery.json",
    Buffer.from(JSON.stringify(recovery)),
  );
  emit(
    "profile-check.mjs",
    readFileSync(join(workflowRoot, "scripts/t081-profile-check.mjs")),
  );
  emit(
    "README.md",
    readFileSync(join(workflowRoot, "docs/T081_PACKAGED_ACCEPTANCE.md")),
  );
  const manifest = {
    format: "stride-plan-t081-acceptance-kit",
    identifier: "com.strideplan.t081test",
    productName: "Stride Plan T08.1 Test",
    baselineSourceCommit: baseline,
    upgradeSourceCommit: upgrade,
    workflowCommit: process.env.GITHUB_SHA,
    runId: process.env.GITHUB_RUN_ID,
    baselineVersion: "0.1.810",
    upgradeVersion: "0.1.811",
    validatorFingerprints: { 1.1: [pre16, current11], 1.2: [current12] },
    syntheticSourceHashes,
    files,
    profileAccess:
      "Read-only; fixed test identity only; no credential access; no upload; close test app before capture",
  };
  writeFileSync(
    join(output, "acceptance-manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    { flag: "wx" },
  );
  // Exercise the shipped checker against the generated historical envelope itself.
  const checker = await import(
    pathToFileURL(join(workflowRoot, "scripts/t081-profile-check.mjs"))
  );
  checker.verifyRecovery(
    readFileSync(join(output, "fixtures/synthetic-pre16-recovery.json")),
    manifest,
  );
  if (
    readdirSync(output).sort().join(",") !==
    "README.md,acceptance-manifest.json,fixtures,profile-check.mjs"
  )
    throw Error("Unexpected kit artifact entry");
  console.log(
    JSON.stringify(
      {
        output,
        manifestSha256: hash(
          readFileSync(join(output, "acceptance-manifest.json")),
        ),
        sourcePins: [baseline, upgrade],
        files: Object.keys(files),
        syntheticInputsOnly: true,
      },
      null,
      2,
    ),
  );
} finally {
  await server.close();
}
