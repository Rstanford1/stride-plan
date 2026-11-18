import assert from "node:assert/strict";
import {
  readFileSync,
  realpathSync,
  existsSync,
  lstatSync,
  readdirSync,
} from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

// This harness may only launch on a disposable GitHub-hosted runner.
assert.equal(process.platform, "win32");
assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");
const temp = realpathSync(process.env.RUNNER_TEMP);
const root = realpathSync(process.env.STRIDE_QA_ROOT);
assert.equal(path.dirname(root).toLowerCase(), temp.toLowerCase());
assert.match(path.basename(root), /^stride-i13-[0-9]+-[0-9]+$/);
for (const [variable, folder] of [
  ["STRIDE_QA_CONFIG_BASE", "ApplicationData"],
  ["STRIDE_QA_LOCAL_BASE", "LocalApplicationData"],
]) {
  const dir = realpathSync(process.env[variable]);
  const known = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-Command", `[Environment]::GetFolderPath('${folder}')`],
    { encoding: "utf8" },
  ).trim();
  assert.equal(dir.toLowerCase(), realpathSync(known).toLowerCase());
  assert.equal(lstatSync(dir).isSymbolicLink(), false);
  const profile = path.join(dir, "com.strideplan.qa.i13");
  if (existsSync(profile)) {
    assert.equal(process.env.STRIDE_QA_REPEAT, "1", "QA profile must be fresh");
    assert.equal(lstatSync(profile).isSymbolicLink(), false);
    assert.equal(realpathSync(profile).toLowerCase(), profile.toLowerCase());
  }
}
const config = JSON.parse(readFileSync("src-tauri/tauri.qa.conf.json", "utf8"));
assert.equal(config.identifier, "com.strideplan.qa.i13");
assert.equal(config.mainBinaryName, "stride-plan-qa-i13");
assert.equal(config.app.windows[0].title, "Stride Plan QA I13");
assert.equal(config.bundle.active, false);
const permissions = config.app.security.capabilities.flatMap(
  (c) => c.permissions,
);
assert.equal(
  permissions.some((p) => String(p).includes("garmin")),
  false,
);
const binary = readFileSync("src-tauri/target/release/stride-plan-qa-i13.exe");
assert.equal(
  readdirSync("dist/assets").some(
    (name) =>
      name.endsWith(".js") &&
      readFileSync(path.join("dist/assets", name), "utf8").includes(
        "Garmin is disabled in this isolated QA build.",
      ),
  ),
  true,
  "QA frontend marker missing",
);
const forbidden = "com.strideplan.desktop/garmin-personal-api/v1";
assert.equal(
  binary.includes(Buffer.from("com.strideplan.desktop")),
  false,
  "production identity present",
);
assert.equal(
  binary.includes(Buffer.from(forbidden)),
  false,
  "production credential target present",
);
assert.equal(
  binary.includes(Buffer.from(forbidden, "utf16le")),
  false,
  "production credential target present",
);
for (const api of ["CredReadW", "CredWriteW", "CredDeleteW"]) {
  assert.equal(
    binary.includes(Buffer.from(api)),
    false,
    `credential API ${api} present`,
  );
}
assert.equal(
  binary.includes(Buffer.from("com.strideplan.qa.i13")),
  true,
  "QA identity absent from binary",
);
console.log(
  `Prelaunch QA binary SHA256: ${createHash("sha256").update(binary).digest("hex")}`,
);
console.log(
  "Fresh isolated roaming and local roots verified; production credential target absent.",
);
