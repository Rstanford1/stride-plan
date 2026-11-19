import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

describe("isolated native launch", () => {
  before(() =>
    writeFileSync(
      "native-qa-results/session-established.txt",
      "WebDriver session established\n",
    ),
  );
  it("opens the QA window and displays navigation", async () => {
    await browser.waitUntil(
      () => {
        const title = execFileSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-Command",
            "(Get-Process -Name 'stride-plan-qa-i13' -ErrorAction SilentlyContinue).MainWindowTitle",
          ],
          { encoding: "utf8" },
        ).trim();
        return title === "Stride Plan QA I13";
      },
      { timeout: 15000, timeoutMsg: "QA window title was not observed" },
    );
    const navigation = await $("nav[aria-label='Main navigation']");
    await navigation.waitForDisplayed();
    assert.equal(await navigation.isDisplayed(), true);
  });
});
