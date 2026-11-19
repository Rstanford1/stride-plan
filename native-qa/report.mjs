import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { classify } from "./report-classify.mjs";

const read = (name) =>
  existsSync(`native-qa-results/${name}`)
    ? readFileSync(`native-qa-results/${name}`, "utf8").slice(-65536)
    : "";
const smoke = read("driver-smoke.log");
const processes = read("processes-launch.log");
const startup = read("startup-launch.log");
const session = read("session-established.txt");
const environment = read("environment.txt");
const observed =
  /stride-plan-qa-i13\.exe:\d+/.test(processes) ||
  startup.includes("process-started");
const stage = classify({ smoke, processes, startup, session });
const exitLines = processes
  .split(/\r?\n/)
  .filter((line) => line.includes("qa-exit:"))
  .slice(-10);
const url = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;
let commit = "unavailable";
try {
  commit = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
} catch {
  /* checkout did not complete */
}
const report = [
  "# I13 native startup diagnostics",
  "",
  `Tested commit: ${commit}`,
  `Run: ${url}`,
  `Stage: ${stage}`,
  `Driver: ${smoke ? smoke.split(/\r?\n/)[0] : "not recorded"}`,
  `QA process: ${observed ? "observed" : "not observed"}`,
  `WebDriver session: ${session ? "established" : "not established or not reached"}`,
  "",
  "Runtime versions:",
  environment || "Not recorded.",
  "Observed QA exits (sampling may miss short-lived processes):",
  ...(exitLines.length ? exitLines : ["None recorded; exit code unavailable."]),
  "",
].join("\n");
mkdirSync("native-qa-results", { recursive: true });
writeFileSync("native-qa-results/diagnostic-report.txt", report);
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
console.log(report);
