import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const appState = vi.hoisted(() => ({
  ready: true,
  recoveryError: null as null | { kind: string; message: string },
  retryLoading: vi.fn(),
  data: {
    shoes: [] as {
      id: string;
      name: string;
      mileageMiles: number;
      isDefault: boolean;
      retired?: boolean;
    }[],
  },
}));

vi.mock("./data/app-context", () => ({ useAppData: () => appState }));
vi.mock("./screens/TodayDashboard", () => ({
  TodayDashboard: ({ openPlan }: { openPlan: () => void }) => (
    <button onClick={openPlan}>Open plan</button>
  ),
}));
vi.mock("./screens/PlanScreen", () => ({
  PlanScreen: () => <p>Plan content</p>,
}));
vi.mock("./screens/WeeklyReviewScreen", () => ({
  WeeklyReviewScreen: () => <p>Weekly review content</p>,
}));
vi.mock("./screens/ActivityReviewScreen", () => ({
  ActivityReviewScreen: () => <p>Activity content</p>,
}));
vi.mock("./screens/TrendsScreen", () => ({
  TrendsScreen: () => <p>Trend content</p>,
}));
vi.mock("./screens/DataScreen", () => ({
  DataScreen: () => <p>Settings content</p>,
}));

beforeEach(() => {
  appState.ready = true;
  appState.recoveryError = null;
  appState.data.shoes = [];
});
afterEach(cleanup);

describe("F1 shell", () => {
  it("exposes six destinations and groups the existing training views", () => {
    render(<App />);
    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    expect(within(nav).getAllByRole("button")).toHaveLength(6);
    fireEvent.click(within(nav).getByRole("button", { name: /Training/ }));
    expect(screen.getByText("Plan content")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Weekly Review" }));
    expect(screen.getByText("Weekly review content")).toBeInTheDocument();
    expect(
      within(nav).getByRole("button", { name: /Training/ }),
    ).toHaveAttribute("aria-current", "page");
    fireEvent.click(within(nav).getByRole("button", { name: /Analytics/ }));
    expect(screen.getByText("Trend content")).toBeInTheDocument();
  });

  it("preserves shortcuts, Today to Plan, and accessible collapse", () => {
    render(<App />);
    fireEvent.keyDown(window, { altKey: true, key: "6" });
    expect(screen.getByText("Settings content")).toBeInTheDocument();
    fireEvent.keyDown(window, { altKey: true, key: "1" });
    fireEvent.click(screen.getByRole("button", { name: "Open plan" }));
    expect(screen.getByText("Plan content")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(
      screen.getByRole("button", { name: "Expand sidebar" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps the recovery path independent of navigation", () => {
    appState.recoveryError = {
      kind: "corrupted",
      message: "Invalid saved snapshot",
    };
    render(<App />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Invalid saved snapshot",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry loading" }));
    expect(appState.retryLoading).toHaveBeenCalled();
  });

  it("shows existing shoe records without management actions", () => {
    appState.data.shoes = [
      { id: "a", name: "Daily trainer", mileageMiles: 123.4, isDefault: true },
      {
        id: "b",
        name: "Old pair",
        mileageMiles: 430,
        isDefault: false,
        retired: true,
      },
    ];
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Shoes, Alt/ }));
    expect(screen.getAllByText("123.4 mi")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: /Old pair/ }));
    expect(
      screen.getByRole("heading", { name: "Old pair" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Add Shoe|Edit Shoe|Retire Shoe/ }),
    ).not.toBeInTheDocument();
  });
});
