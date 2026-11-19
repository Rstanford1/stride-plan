import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  fileURLToPath(import.meta.resolve("@wdio/tauri-service")),
  "utf8",
);
const expression = source.match(
  /const match = versionOutput\.match\((\/[^\n]+\/)\);/,
);
assert.ok(expression, "WebdriverIO driver-version parser was not found");
const parser = new RegExp(expression[1].slice(1, -1));
for (const output of [
  "MSEdgeDriver 156.0.4314.58",
  "Microsoft Edge WebDriver 156.0.4314.58 (synthetic)",
]) {
  assert.equal(output.match(parser)?.[1], "156.0.4314.58");
}
assert.equal("unexpected driver output".match(parser), null);
console.log(
  "WebdriverIO driver-version parser accepts both Microsoft formats.",
);
