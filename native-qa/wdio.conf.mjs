import path from "node:path";

const binary = path.resolve("src-tauri/target/release/stride-plan-qa-i13.exe");
export const config = {
  runner: "local",
  specs: ["./native-qa/native.spec.mjs"],
  maxInstances: 1,
  capabilities: [
    { browserName: "tauri", "tauri:options": { application: binary } },
  ],
  services: [
    [
      "@wdio/tauri-service",
      {
        driverProvider: "official",
        appBinaryPath: binary,
        autoInstallTauriDriver: false,
        autoDownloadEdgeDriver: true,
      },
    ],
  ],
  framework: "mocha",
  reporters: ["spec"],
  logLevel: "warn",
  waitforTimeout: 15000,
  connectionRetryTimeout: 60000,
  connectionRetryCount: 0,
  mochaOpts: { timeout: 120000 },
  afterTest: async (_test, _context, result) => {
    if (result.error)
      await browser.saveScreenshot(
        path.resolve("native-qa-results/failure.png"),
      );
  },
};
