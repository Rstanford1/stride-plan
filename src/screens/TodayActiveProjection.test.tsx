import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppData } from "../domain/types";
import type { ActivePlanProjection } from "../domain/active-plan-projection";
import { projectActivePlan } from "../domain/active-plan-projection";
import { activationCandidate } from "../domain/active-plan";
import { createInitialData } from "../domain/seed";
import { validateTrainingPlan } from "../domain/training-plan";
import fixture from "../domain/__fixtures__/training-plan/valid-1.2-40.json";
import { TodayDashboard } from "./TodayDashboard";

const state = vi.hoisted(() => ({
  data: null as unknown as AppData,
  activeProjection: null as ActivePlanProjection | null,
  moveSession: vi.fn(),
}));
vi.mock("../data/app-context", () => ({ useAppData: () => state }));
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 17, 12));
  const result = validateTrainingPlan(fixture);
  if (!result.ok) throw new Error("Invalid synthetic fixture");
  state.data = activationCandidate(
    result.plan,
    createInitialData(),
    "test",
    "2026-11-16",
    "2026-11-16T12:00:00Z",
  );
  state.activeProjection = projectActivePlan(
    state.data,
    result.plan,
    "2026-11-16",
    "test",
  );
  state.moveSession.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("renders the authoritative linked sessions and supplied duration, and delegates moves", () => {
  state.moveSession.mockReturnValue(
    "The source fixes Synthetic threshold session to 2026-11-17.",
  );
  render(<TodayDashboard openPlan={vi.fn()} openActivityReview={vi.fn()} />);
  const headings = screen
    .getAllByRole("heading", { level: 2 })
    .map((x) => x.textContent);
  expect(headings.slice(0, 2)).toEqual([
    "Synthetic threshold session",
    "Synthetic optional double",
  ]);
  const main = screen
    .getByRole("heading", { name: "Synthetic threshold session" })
    .closest("section")!;
  expect(within(main).getByText(/30 min duration/)).toBeInTheDocument();
  expect(screen.getByText(/Linked double/)).toHaveTextContent(
    "Supporting · Optional",
  );
  expect(within(main).getByText(/Priority/)).toBeInTheDocument();
  fireEvent.click(within(main).getByRole("button", { name: /Expand/ }));
  fireEvent.change(
    within(main).getByLabelText("Move Synthetic threshold session"),
    { target: { value: "2026-11-18" } },
  );
  fireEvent.click(within(main).getByRole("button", { name: "Move session" }));
  expect(state.moveSession).toHaveBeenCalledWith(
    expect.stringContaining("session:session-2"),
    "2026-11-18",
  );
  expect(within(main).getByRole("status")).toHaveTextContent("source fixes");
  expect(
    within(main).getByText(/Source plan: synthetic-plan/),
  ).toBeInTheDocument();
});

it("uses projected source days, preserves history separately, and does not expose retired records as active", () => {
  fireEventRender();
  fireEvent.click(screen.getByRole("button", { name: /November 20, 2026/ }));
  expect(screen.getByRole("heading", { name: "Rest day" })).toBeInTheDocument();
  expect(
    screen.getByRole("region", { name: "Historical sessions" }),
  ).toBeInTheDocument();
  expect(
    within(
      screen.getByRole("region", { name: "Historical sessions" }),
    ).queryByRole("button", { name: /Log this run/ }),
  ).not.toBeInTheDocument();
});
function fireEventRender() {
  render(<TodayDashboard openPlan={vi.fn()} openActivityReview={vi.fn()} />);
}

it("keeps ranged and unknown distance distinct from duration and preserves moved original dates", () => {
  const original = state.data.sessions.find(
    (item) => item.sourceSessionId === "session-2",
  )!;
  original.plannedDistance = { kind: "range", min: 4, max: 6, unit: "mi" };
  original.originalDistance = { kind: "range", min: 4, max: 6, unit: "mi" };
  original.scheduledDate = "2026-11-18";
  const result = validateTrainingPlan(fixture);
  if (!result.ok) throw new Error("Invalid synthetic fixture");
  state.activeProjection = projectActivePlan(
    state.data,
    result.plan,
    "2026-11-16",
    "test",
  );
  render(<TodayDashboard openPlan={vi.fn()} openActivityReview={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /November 18, 2026/ }));
  const card = screen
    .getByRole("heading", { name: "Synthetic threshold session" })
    .closest("section")!;
  expect(within(card).getByText(/4–6 mi planned/)).toBeInTheDocument();
  fireEvent.click(within(card).getByRole("button", { name: /Expand/ }));
  expect(
    within(card).getByText(/Scheduled: Nov 18 · Original date: Nov 17/),
  ).toBeInTheDocument();
});

it("distinguishes an unspecified source day from Rest", () => {
  const day = state.activeProjection!.days.find(
    (item) => item.originalDate === "2026-11-20",
  )!;
  day.kind = "unspecified";
  render(<TodayDashboard openPlan={vi.fn()} openActivityReview={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /November 20, 2026/ }));
  expect(
    screen.getByRole("heading", { name: "Unspecified day" }),
  ).toBeInTheDocument();
});

it("shows source coach instructions even if the editable snapshot differs", () => {
  const item = state.data.sessions.find(
    (session) => session.sourceSessionId === "session-2",
  )!;
  item.instructions = "Editable snapshot differs";
  render(<TodayDashboard openPlan={vi.fn()} openActivityReview={vi.fn()} />);
  const card = screen
    .getByRole("heading", { name: "Synthetic threshold session" })
    .closest("section")!;
  fireEvent.click(within(card).getByRole("button", { name: /Expand/ }));
  expect(
    within(card).getByText(
      /Original instructions: Synthetic source instruction for Synthetic threshold session/,
    ),
  ).toBeInTheDocument();
});
