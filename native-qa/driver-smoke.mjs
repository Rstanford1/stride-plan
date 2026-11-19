import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import net from "node:net";

assert.equal(process.platform, "win32");
assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");
try {
  for (const port of [49301, 49302]) {
    await new Promise((resolve, reject) => {
      const probe = net.createServer();
      probe.once("error", reject);
      probe.listen(port, "127.0.0.1", () => probe.close(resolve));
    });
  }
} catch (error) {
  writeFileSync(
    "native-qa-results/driver-smoke.log",
    "status: unavailable\nDriver-only test ports were unavailable.\n",
  );
  throw error;
}
const driver = path.join(process.env.CARGO_HOME, "bin", "tauri-driver.exe");
const native = path.join(
  process.env.RUNNER_TEMP,
  "i13-microsoft-edgedriver",
  "msedgedriver.exe",
);
const child = spawn(
  driver,
  ["--port", "49301", "--native-port", "49302", "--native-driver", native],
  { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
);
let output = "";
let spawnError;
child.on("error", (error) => {
  spawnError = error;
});
for (const stream of [child.stdout, child.stderr]) {
  stream.on("data", (chunk) => {
    output = (output + chunk.toString()).slice(-65536);
  });
}
let status = "unavailable";
try {
  for (let i = 0; i < 20; i++) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null)
      throw new Error(`tauri-driver exited: ${child.exitCode}`);
    try {
      const response = await fetch("http://127.0.0.1:49301/status", {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) {
        const body = await response.json();
        status = `HTTP ${response.status} ready=${body?.value?.ready === true}`;
        if (body?.value?.ready === true) break;
      } else {
        status = `HTTP ${response.status}`;
      }
    } catch {
      /* bounded readiness polling */
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert.equal(
    status,
    "HTTP 200 ready=true",
    "Driver status endpoint was not ready",
  );
  console.log(
    "Driver-only status check passed without launching the application.",
  );
} finally {
  if (child.exitCode === null) child.kill();
  const home = process.env.USERPROFILE || "";
  const sanitized = home ? output.split(home).join("<runner-profile>") : output;
  writeFileSync(
    "native-qa-results/driver-smoke.log",
    `status: ${status}\ndriver PID: ${child.pid ?? "unavailable"}; exit code: ${child.exitCode ?? "not observed"}\n${sanitized}`,
  );
}
