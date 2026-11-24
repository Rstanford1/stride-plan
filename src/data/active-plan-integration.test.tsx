import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import source from "../domain/__fixtures__/training-plan/valid-independent.json";
import { createInitialData } from "../domain/seed";
import type { AppData } from "../domain/types";
import { AppProvider } from "./app-context";
import type { AppRepository } from "./repository";
import { PlanActivationPanel } from "../components/PlanActivationPanel";
import { TodayDashboard } from "../screens/TodayDashboard";
import { activationCandidate } from "../domain/active-plan";
import { validateTrainingPlan } from "../domain/training-plan";
import { inspectLegacyRestore } from "./restore";
import type { FitSourceStore } from "./fit-source-store";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__;
});

it("rejects an incomplete version-5 JSON restore before changing stored data", async () => {
  const validation = validateTrainingPlan(source);
  if (!validation.ok) throw new Error("Synthetic fixture is invalid");
  const candidate = activationCandidate(
    validation.plan,
    createInitialData(),
    "restore-proof",
    "2026-11-16",
    "2026-11-16T12:00:00Z",
  );
  await expect(
    inspectLegacyRestore(JSON.stringify(candidate), {} as FitSourceStore),
  ).rejects.toThrow("immutable activation records");
});

it("confirms a validated plan, preserves past, and reopens D1 and Today after restart", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 16, 12));
  (globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  let saved: AppData = createInitialData();
  let active: {
    activationId: string;
    sourceBytes: Uint8Array;
    effectiveDate: string;
  } | null = null;
  const repository: AppRepository = {
    load: async () => structuredClone(saved),
    save: async (data) => {
      saved = structuredClone(data);
    },
    activate: async (input) => {
      expect(input.before.schemaVersion).toBe(4);
      saved = structuredClone(input.after);
      active = {
        activationId: input.activationId,
        sourceBytes: Uint8Array.from(input.bytes),
        effectiveDate: input.effectiveDate,
      };
    },
    inspectActive: async () => active,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(source));
  const selected = new File([bytes], "synthetic.json", {
    type: "application/json",
  });
  Object.defineProperty(selected, "arrayBuffer", {
    value: async () => bytes.buffer,
  });
  const view = render(
    <AppProvider repository={repository}>
      <PlanActivationPanel />
      <TodayDashboard openPlan={vi.fn()} openActivityReview={vi.fn()} />
    </AppProvider>,
  );
  await screen.findByText("No validated JSON plan is active.");
  fireEvent.change(screen.getByLabelText("Choose training plan JSON"), {
    target: { files: [selected] },
  });
  await screen.findByRole("button", { name: "Confirm activation from today" });
  expect(saved.schemaVersion).toBe(4);
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm activation from today" }),
  );
  await screen.findByText(
    "Plan activated and saved. Earlier sessions and results remain in history.",
  );
  expect(saved.schemaVersion).toBe(5);
  expect(saved.days?.map((day) => day.kind)).toEqual(["training", "rest"]);
  expect(
    saved.sessions.some(
      (session) => session.originalDate < "2026-11-16" && !session.retiredAt,
    ),
  ).toBe(true);
  view.unmount();
  render(
    <AppProvider repository={repository}>
      <TodayDashboard openPlan={vi.fn()} openActivityReview={vi.fn()} />
    </AppProvider>,
  );
  await waitFor(() =>
    expect(screen.getByText("Synthetic independent run")).toBeInTheDocument(),
  );
  fireEvent.click(
    screen.getByRole("button", { name: /Tuesday, November 17, 2026/ }),
  );
  expect(screen.getByRole("heading", { name: "Rest day" })).toBeInTheDocument();
  expect(
    within(
      screen.getByRole("heading", { name: "Rest day" }).parentElement!,
    ).getByText("Rest"),
  ).toBeInTheDocument();
});
