import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";

function processIds() {
  return execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      "Get-Process -Name 'stride-plan-qa-i13' -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }",
    ],
    { encoding: "utf8" },
  )
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(Number);
}

describe("isolated native QA", () => {
  it("opens the QA window and navigates", async () => {
    assert.equal(await browser.getTitle(), "Stride Plan QA I13");
    const settings = await $('[aria-label="Settings, Alt+6"]');
    await settings.waitForDisplayed();
    await settings.click();
    await $("h1=Settings").waitForDisplayed();
    await $(
      "*=Garmin is disabled in this isolated QA build.",
    ).waitForDisplayed();
    await $('[aria-label="Training, Alt+2"]').click();
    await $("h1=Training").waitForDisplayed();
  });

  it("persists a synthetic value after an application restart", async () => {
    await $('[aria-label="Settings, Alt+6"]').click();
    const field = await $("label=Easy HR low").$("input");
    await field.waitForDisplayed();
    await field.setValue("131");
    await browser.waitUntil(async () => (await field.getValue()) === "131");
    const database = path.join(
      process.env.STRIDE_QA_CONFIG_BASE,
      "com.strideplan.qa.i13",
      "stride-plan.db",
    );
    await browser.waitUntil(() => existsSync(database), { timeout: 15000 });
    await browser.waitUntil(
      () => {
        try {
          const db = new DatabaseSync(database, { readOnly: true });
          try {
            return (
              JSON.parse(
                db.prepare("SELECT payload FROM app_state WHERE id=1").get()
                  .payload,
              ).settings.easyHrLow === 131
            );
          } finally {
            db.close();
          }
        } catch {
          return false;
        }
      },
      { timeout: 15000 },
    );
    const before = processIds();
    assert.equal(before.length, 1, "expected exactly one QA process");
    await browser.reloadSession();
    await browser.waitUntil(
      () => {
        const after = processIds();
        return after.length === 1 && after[0] !== before[0];
      },
      { timeout: 15000, timeoutMsg: "QA application process did not restart" },
    );
    await $('[aria-label="Settings, Alt+6"]').waitForDisplayed();
    await $('[aria-label="Settings, Alt+6"]').click();
    const reloaded = await $("label=Easy HR low").$("input");
    await browser.waitUntil(async () => (await reloaded.getValue()) === "131");
  });

  it("does not expose Garmin credential commands", async () => {
    const result = await browser.executeAsync((done) => {
      window.__TAURI_INTERNALS__.invoke("garmin_status").then(
        () => done("unexpected success"),
        () => done("rejected"),
      );
    });
    assert.equal(result, "rejected");
  });
});
