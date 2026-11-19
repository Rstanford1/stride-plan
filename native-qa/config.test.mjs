import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

process.env.STRIDE_QA_STAGE = "launch";
const { config } = await import("./wdio.conf.mjs");
test("launch stage discovers exactly the launch-only spec", () => {
  assert.deepEqual(config.specs, [
    fileURLToPath(new URL("./launch.spec.mjs", import.meta.url)),
  ]);
  assert.equal(existsSync(config.specs[0]), true);
  assert.equal(config.services[0][1].driverProvider, "official");
  assert.equal(config.services[0][1].autoDownloadEdgeDriver, false);
});
