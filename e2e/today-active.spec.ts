import { test, expect } from "@playwright/test";

test("renders the active structured plan with keyboard and narrow-window support", async ({
  page,
  context,
}, testInfo) => {
  await context.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin !== "http://127.0.0.1:41739")
      return route.abort();
    await route.continue();
  });
  await context.routeWebSocket("**/*", (socket) => {
    const url = new URL(socket.url());
    if (url.protocol === "ws:" && url.host === "127.0.0.1:41739")
      socket.connectToServer();
    else socket.close({ code: 1008, reason: "External network blocked" });
  });
  await page.addInitScript(() => {
    if (
      location.origin !== "http://127.0.0.1:41739" ||
      "__TAURI_INTERNALS__" in window ||
      localStorage.length
    )
      throw new Error("Isolated browser environment unavailable");
  });
  await page.clock.setFixedTime(new Date(2026, 10, 16, 12));
  await page.goto("/e2e/today-fixture.html");
  await expect(
    page.getByRole("heading", { name: "Synthetic workout" }),
  ).toBeVisible();
  await expect(page.getByLabel("Prescribed workout summary")).toContainText(
    "400 m",
  );
  const expand = page.getByRole("button", { name: "Expand Synthetic workout" });
  await expand.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Collapse Synthetic workout" }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.getByText(/Recovery after set: 30 s walk then 200 m jog/).first(),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("today-active-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 680, height: 900 });
  await page.emulateMedia({ colorScheme: "dark" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("today-active-narrow-dark.png"),
    fullPage: true,
  });
});
