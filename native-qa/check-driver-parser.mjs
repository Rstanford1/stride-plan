import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execFileSync, execSync } from "node:child_process";
import path from "node:path";

const source = readFileSync(
  fileURLToPath(import.meta.resolve("@wdio/tauri-service")),
  "utf8",
);
const expression = source.match(
  /const match = versionOutput\.match\((\/[^\n]+\/)\);/,
);
assert.ok(expression, "WebdriverIO driver-version parser was not found");
assert.ok(
  source.includes("pathResult.trim().split(/\\r?\\n/)[0].trim()"),
  "Windows driver path parser is not patched",
);
const firstPath = (output) => output.trim().split(/\r?\n/)[0].trim();
assert.equal(
  firstPath("C:\\qa\\msedgedriver.exe\r\nC:\\other\\msedgedriver.exe\r\n"),
  "C:\\qa\\msedgedriver.exe",
);
const parser = new RegExp(expression[1].slice(1, -1));
for (const output of [
  "MSEdgeDriver 156.0.4314.58",
  "Microsoft Edge WebDriver 156.0.4314.58 (synthetic)",
]) {
  assert.equal(output.match(parser)?.[1], "156.0.4314.58");
}
assert.equal("unexpected driver output".match(parser), null);
if (process.argv.includes("--verify-discovery")) {
  assert.equal(process.platform, "win32");
  const output = execSync("where msedgedriver.exe 2>nul", { encoding: "utf8" });
  const driver = firstPath(output);
  const expected = path.join(
    process.env.RUNNER_TEMP,
    "i13-microsoft-edgedriver",
    "msedgedriver.exe",
  );
  assert.equal(
    realpathSync(driver).toLowerCase(),
    realpathSync(expected).toLowerCase(),
    "The verified QA driver is not first on PATH",
  );
  const version = execFileSync(driver, ["--version"], {
    encoding: "utf8",
  }).match(parser)?.[1];
  assert.equal(
    version,
    process.env.STRIDE_QA_DRIVER_VERSION,
    "WebdriverIO cannot identify the verified driver version",
  );
  console.log(
    `Verified WebdriverIO can discover Microsoft Edge WebDriver ${version}.`,
  );
}
console.log(
  "WebdriverIO driver-version parser accepts both Microsoft formats.",
);
