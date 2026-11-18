import { test, expect } from "@playwright/test";

const origin = "http://127.0.0.1:41739";

test.beforeEach(async ({ page, context }) => {
  // A fresh Playwright context owns its storage. Never attach to an existing profile.
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    await route.continue();
  });
  await context.routeWebSocket("**/*", (socket) => {
    const url = new URL(socket.url());
    if (url.protocol === "ws:" && url.host === "127.0.0.1:41739") {
      socket.connectToServer();
    } else {
      socket.close({ code: 1008, reason: "External network blocked" });
    }
  });
  await page.addInitScript(() => {
    if (
      location.origin !== "http://127.0.0.1:41739" ||
      "__TAURI_INTERNALS__" in window ||
      (!sessionStorage.getItem("i13-isolated") && localStorage.length !== 0)
    ) {
      throw new Error("Isolated browser environment unavailable");
    }
    sessionStorage.setItem("i13-isolated", "yes");
  });
  await page.goto("/");
  expect(
    await page.evaluate(() => sessionStorage.getItem("i13-isolated")),
  ).toBe("yes");
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeVisible();
});

test("blocks external HTTP and WebSocket traffic and service workers", async ({
  page,
  context,
}) => {
  const failedRequest = page.waitForEvent("requestfailed", {
    predicate: (request) =>
      request.url() === "https://example.invalid/i13-network-probe",
  });
  const result = await page.evaluate(async () => {
    const http = await fetch("https://example.invalid/i13-network-probe").then(
      () => "allowed",
      () => "blocked",
    );
    const websocket = await new Promise<{ code: number; reason: string }>(
      (resolve) => {
        const socket = new WebSocket("wss://example.invalid/i13-network-probe");
        socket.addEventListener("close", (event) =>
          resolve({ code: event.code, reason: event.reason }),
        );
      },
    );
    await navigator.serviceWorker.register("/i13-nonexistent-worker.js");
    const serviceWorker = (await navigator.serviceWorker.getRegistrations())
      .length;
    return { http, websocket, serviceWorker };
  });
  expect(result).toEqual({
    http: "blocked",
    websocket: { code: 1008, reason: "External network blocked" },
    serviceWorker: 0,
  });
  expect((await failedRequest).failure()?.errorText).toBe("net::ERR_FAILED");
  expect(context.serviceWorkers()).toHaveLength(0);
});

test("launches without runtime errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", () => errors.push("runtime error (details omitted)"));
  await page.reload();
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("navigates all six destinations", async ({ page }) => {
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  for (const name of [
    "Today",
    "Training",
    "Activities",
    "Analytics",
    "Shoes",
    "Settings",
  ]) {
    const button = nav.getByRole("button", { name: new RegExp(`^${name},`) });
    await button.click();
    await expect(button).toHaveAttribute("aria-current", "page");
    await expect(page.locator("main")).toBeVisible();
  }
});

for (const scheme of ["light", "dark"] as const) {
  test(`renders system ${scheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await expect(page.locator("html")).toHaveCSS("color-scheme", scheme);
    await expect(page.locator("html")).toHaveCSS(
      "background-color",
      scheme === "light" ? "rgb(244, 245, 242)" : "rgb(17, 23, 21)",
    );
  });
}

test("follows changes to system theme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveCSS("color-scheme", "light");
});

test("keyboard shortcut moves focus to content", async ({ page }) => {
  await page.keyboard.press("Alt+6");
  await expect(page.locator("#main-content")).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Settings, Alt+6" }),
  ).toHaveAttribute("aria-current", "page");
  const start = page.getByRole("tab", { name: "Start" });
  await start.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Get files" })).toBeFocused();
  await expect(page.getByRole("tab", { name: "Get files" })).toHaveCSS(
    "outline-style",
    "solid",
  );
});

for (const fixture of ["valid-1.2-40.json", "valid-workout.json"]) {
  test(`validates and previews synthetic ${fixture}`, async ({ page }) => {
    await page.getByRole("button", { name: "Settings, Alt+6" }).click();
    await page.getByRole("tab", { name: "Import", exact: true }).click();
    await page
      .getByLabel("JSON training-plan file")
      .setInputFiles(`src/domain/__fixtures__/training-plan/${fixture}`);
    await expect(page.getByText("Validation preview")).toBeVisible();
    await expect(
      page.getByText("Plan validated. Review the preview before saving."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save as draft" }),
    ).toBeDisabled();
  });
}

test("rejects invalid plan with feedback", async ({ page }) => {
  await page.getByRole("button", { name: "Settings, Alt+6" }).click();
  await page.getByRole("tab", { name: "Import", exact: true }).click();
  await page
    .getByLabel("JSON training-plan file")
    .setInputFiles(
      "src/domain/__fixtures__/training-plan/invalid-missing-unit.json",
    );
  await expect(page.getByRole("alert")).toContainText("No draft was saved");
});

test("reports invalid FIT and browser preservation limitation", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Settings, Alt+6" }).click();
  await expect(
    page.getByText(
      /browser development cannot provide durable source-file preservation/,
    ),
  ).toBeVisible();
  await page.locator('input[type="file"][accept=".fit"]').setInputFiles({
    name: "synthetic.fit",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("invalid synthetic FIT"),
  });
  await expect(
    page.getByRole("status").filter({ hasText: "1 failed" }),
  ).toBeVisible();
});

test("navigation remains usable at a constrained width", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 700 });
  const button = page.getByRole("button", { name: "Settings, Alt+6" });
  await button.click();
  await expect(button).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeInViewport();
});
