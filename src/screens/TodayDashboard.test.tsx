import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TodayDashboard, addDays, weekDates } from "./TodayDashboard";
import { createSeedSessions } from "../domain/seed";
const state = vi.hoisted(() => ({
  data: {
    sessions: [] as unknown[],
    journals: [],
    activities: [],
    settings: {},
  },
}));
vi.mock("../data/app-context", () => ({ useAppData: () => state }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 4, 12));
  state.data.sessions = createSeedSessions().filter(
    (s) => s.scheduledDate === "2026-11-04",
  );
});
describe("Today navigation", () => {
  it("browses weeks independently and resets both states", () => {
    render(<TodayDashboard openPlan={vi.fn()} openActivityReview={vi.fn()} />);
    const initial = screen.getByRole("heading", { level: 1 }).textContent;
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      initial!,
    );
    expect(
      screen.getByRole("navigation", { name: "Week dates" }),
    ).toHaveTextContent("11");
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Today",
    );
    expect(
      screen.getByRole("button", { name: /November 4, 2026, today/ }),
    ).toHaveAttribute("aria-current", "date");
  });
  it("selects an empty day and preserves literal date", () => {
    state.data.sessions = [];
    render(<TodayDashboard openPlan={vi.fn()} openActivityReview={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /November 5, 2026/ }));
    expect(
      screen.getByRole("heading", { name: "No planned session" }),
    ).toBeInTheDocument();
  });
  it("expands multiple sessions independently in source order", () => {
    const first = createSeedSessions().find((s) => s.kind === "easy")!;
    state.data.sessions = [
      { ...first, id: "a", title: "First", scheduledDate: "2026-11-04" },
      { ...first, id: "b", title: "Second", scheduledDate: "2026-11-04" },
    ];
    render(<TodayDashboard openPlan={vi.fn()} openActivityReview={vi.fn()} />);
    expect(
      screen.getAllByRole("heading", { level: 2 }).map((x) => x.textContent),
    ).toEqual(["First", "Second"]);
    fireEvent.click(screen.getByRole("button", { name: "Expand First" }));
    expect(
      screen.getByRole("button", { name: "Collapse First" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("button", { name: "Expand Second" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(
      within(
        screen
          .getByRole("button", { name: "Collapse First" })
          .closest("section")!,
      ).getByText(/Original prescription/),
    ).toBeInTheDocument();
  });
  it("handles calendar boundaries", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(weekDates("2027-01-01")[0]).toBe("2026-12-28");
  });
});

describe("Today states", () => {
  it("shows rest without failure and distinguishes missing dates", () => {
    const rest = createSeedSessions().find((s) => s.kind === "rest")!;
    state.data.sessions = [{ ...rest, scheduledDate: "2026-11-04" }];
    render(<TodayDashboard openPlan={vi.fn()} openActivityReview={vi.fn()} />);
    expect(
      screen.getByRole("heading", { name: "Rest day" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/skipped|failed/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /November 5, 2026/ }));
    expect(
      screen.getByRole("heading", { name: "No planned session" }),
    ).toBeInTheDocument();
  });
  it("shows a past missing result without marking a future session missed", () => {
    const easy = createSeedSessions().find((s) => s.kind === "easy")!;
    state.data.sessions = [
      { ...easy, id: "past", scheduledDate: "2026-11-03" },
      { ...easy, id: "future", scheduledDate: "2026-11-05" },
    ];
    render(<TodayDashboard openPlan={vi.fn()} openActivityReview={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /November 3, 2026/ }));
    expect(
      screen.getByText("No result recorded for this day."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /November 5, 2026/ }));
    expect(
      screen.queryByText("No result recorded for this day."),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/skipped/i)).not.toBeInTheDocument();
  });
});

it("browses the previous week without changing the selected session", () => {
  render(<TodayDashboard openPlan={vi.fn()} openActivityReview={vi.fn()} />);
  const title = screen.getByRole("heading", { level: 2 }).textContent;
  fireEvent.click(screen.getByRole("button", { name: "Previous week" }));
  expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(title!);
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Today");
  expect(
    screen.getByRole("button", { name: /October 28, 2026/ }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Today" }));
  expect(
    screen.getByRole("button", { name: /November 4, 2026, today/ }),
  ).toHaveAttribute("aria-current", "date");
});

it("preserves original instructions when a session was revised", () => {
  const easy = createSeedSessions().find((session) => session.kind === "easy")!;
  state.data.sessions = [
    {
      ...easy,
      scheduledDate: "2026-11-04",
      instructions: "Revised instructions",
      revisions: [
        {
          id: "revision-1",
          changedAt: "2026-11-04T12:00:00Z",
          field: "instructions",
          from: "Original coach instructions",
          to: "Revised instructions",
          reason: "Edit",
        },
      ],
    },
  ];
  render(<TodayDashboard openPlan={vi.fn()} openActivityReview={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /^Expand / }));
  expect(
    screen.getByText("Original instructions: Original coach instructions"),
  ).toBeInTheDocument();
  expect(
    screen.getByText("Revised instructions: Revised instructions"),
  ).toBeInTheDocument();
});

it("uses local calendar dates across daylight-saving and year boundaries", () => {
  expect(addDays("2026-03-07", 1)).toBe("2026-03-08");
  expect(addDays("2026-03-08", -1)).toBe("2026-03-07");
  expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
  expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
  expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
});
