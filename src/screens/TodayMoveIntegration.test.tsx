import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AppProvider } from "../data/app-context";
import type { AppRepository } from "../data/repository";
import { createInitialData } from "../domain/seed";
import { activationCandidate } from "../domain/active-plan";
import { validateTrainingPlan } from "../domain/training-plan";
import source from "../domain/__fixtures__/training-plan/valid-1.2-40.json";
import { TodayDashboard } from "./TodayDashboard";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it("enforces fixed-date restrictions and moves a permitted session through the real app context", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 17, 12));
  const plan = validateTrainingPlan(source);
  if (!plan.ok) throw new Error("Invalid synthetic plan");
  let data = activationCandidate(
    plan.plan,
    createInitialData(),
    "integration",
    "2026-11-16",
    "2026-11-16T12:00:00Z",
  );
  const repository: AppRepository = {
    load: async () => structuredClone(data),
    save: async (next) => {
      data = structuredClone(next);
    },
    inspectActive: async () => ({
      activationId: "integration",
      effectiveDate: "2026-11-16",
      sourceBytes: new TextEncoder().encode(JSON.stringify(source)),
    }),
  };
  render(
    <AppProvider repository={repository}>
      <TodayDashboard openPlan={vi.fn()} openActivityReview={vi.fn()} />
    </AppProvider>,
  );
  const title = await screen.findByRole("heading", {
    name: "Synthetic threshold session",
  });
  const card = title.closest("section")!;
  fireEvent.click(within(card).getByRole("button", { name: /Expand/ }));
  fireEvent.change(
    within(card).getByLabelText("Move Synthetic threshold session"),
    { target: { value: "2026-11-18" } },
  );
  fireEvent.click(within(card).getByRole("button", { name: "Move session" }));
  expect(within(card).getByRole("status")).toHaveTextContent("source fixes");
  fireEvent.click(screen.getByRole("button", { name: /November 18, 2026/ }));
  const easy = screen
    .getByRole("heading", { name: "Prescribed easy mileage" })
    .closest("section")!;
  fireEvent.click(within(easy).getByRole("button", { name: /Expand/ }));
  fireEvent.change(
    within(easy).getByLabelText("Move Prescribed easy mileage"),
    { target: { value: "2026-11-19" } },
  );
  fireEvent.click(within(easy).getByRole("button", { name: "Move session" }));
  fireEvent.click(screen.getByRole("button", { name: /November 19, 2026/ }));
  expect(
    screen.getByRole("heading", { name: "Prescribed easy mileage" }),
  ).toBeInTheDocument();
  await waitFor(() =>
    expect(
      data.sessions.find((item) => item.sourceSessionId === "session-3")
        ?.scheduledDate,
    ).toBe("2026-11-19"),
  );
});
