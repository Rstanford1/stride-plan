import { afterEach, expect, it, vi } from "vitest";
import { garmin } from "./garmin";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("keeps native Garmin available in production while disabling it for QA", () => {
  vi.stubGlobal("__TAURI_INTERNALS__", {});
  vi.stubEnv("VITE_STRIDE_QA", "");
  expect(garmin.available()).toBe(true);
  vi.stubEnv("VITE_STRIDE_QA", "1");
  expect(garmin.available()).toBe(false);
});
