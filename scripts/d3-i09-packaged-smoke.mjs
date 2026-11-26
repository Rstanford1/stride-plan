import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "@playwright/test";

if (
  process.env.CI !== "true" ||
  process.env.RUNNER_ENVIRONMENT !== "github-hosted"
)
  throw new Error("This test runs only on a disposable GitHub-hosted runner.");
const manifest = JSON.parse(
  await readFile(
    join(process.env.RUNNER_TEMP, "d3-package", "build-manifest.json"),
    "utf8",
  ),
);
if (
  manifest.sourceCommit !== process.env.D3_SOURCE_SHA ||
  manifest.identifier !== "com.strideplan.d3i09test" ||
  manifest.binaryName !== "stride-plan-d3-i09-acceptance"
)
  throw new Error("Unexpected test package identity.");

const executable = join(
  process.env.LOCALAPPDATA,
  "Stride Plan D3 I09 Acceptance",
  `${manifest.binaryName}.exe`,
);
const child = spawn(executable, [], {
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9228",
  },
  stdio: "ignore",
  windowsHide: true,
});
let browser;
try {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (child.exitCode !== null)
      throw new Error(`Test app exited: ${child.exitCode}`);
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9228");
      break;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  if (!browser)
    throw new Error(`Cannot connect to packaged WebView: ${lastError}`);
  const deadline = Date.now() + 20000;
  let page;
  while (!page && Date.now() < deadline) {
    page = browser.contexts().flatMap((context) => context.pages())[0];
    if (!page) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!page) throw new Error("Packaged app did not open a WebView.");
  await page.getByRole("navigation").first().waitFor({ timeout: 20000 });
  console.log("Packaged app opened with its isolated identity and WebView.");
} finally {
  if (browser) await browser.close();
  if (child.exitCode === null) child.kill();
}
