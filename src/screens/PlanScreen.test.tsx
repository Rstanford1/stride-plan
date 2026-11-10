import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppProvider, useAppData } from "../data/app-context";
import { createInitialData } from "../domain/seed";
import { PlanScreen } from "./PlanScreen";

function ReadyGate({ children }: { children: React.ReactNode }) {
  return useAppData().ready ? children : null;
}

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe("Week screen", () => {
  it("combines plan and outcomes in a table-first view", async () => {
    render(
      <AppProvider>
        <ReadyGate>
          <PlanScreen />
        </ReadyGate>
      </AppProvider>,
    );
    fireEvent.change(
      await screen.findByRole("combobox", { name: "Plan week" }),
      {
        target: { value: "2" },
      },
    );
    expect(
      screen.getByRole("columnheader", { name: "Planned" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Actual" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /Long run/ })).toHaveClass(
      "kind-long",
    );
  });

  it("swaps complete day groups while preserving identity and original dates", async () => {
    render(
      <AppProvider>
        <ReadyGate>
          <PlanScreen />
        </ReadyGate>
      </AppProvider>,
    );
    fireEvent.change(
      await screen.findByRole("combobox", { name: "Plan week" }),
      {
        target: { value: "2" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Rearrange week" }));
    fireEvent.click(screen.getByRole("button", { name: /Mon, Nov 9/ }));
    fireEvent.click(screen.getByRole("button", { name: /Tue, Nov 10/ }));

    await waitFor(() => {
      const stored = JSON.parse(
        window.localStorage.getItem("stride-plan:data:v1") ?? "{}",
      ) as ReturnType<typeof createInitialData>;
      const monday = stored.sessions.find(
        (session) => session.id === "plan-w2-d1",
      );
      const tuesday = stored.sessions.find(
        (session) => session.id === "plan-w2-d2",
      );
      expect(monday).toMatchObject({
        originalDate: "2026-11-09",
        scheduledDate: "2026-11-10",
      });
      expect(tuesday).toMatchObject({
        originalDate: "2026-11-10",
        scheduledDate: "2026-11-09",
      });
    });
  });
});
