import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppProvider, useAppData } from "../data/app-context";
import { createSeedSessions } from "../domain/seed";
import { RunEntryWorkflow } from "./RunEntryWorkflow";

const session = createSeedSessions().find((item) => item.kind === "easy")!;

function ReadyGate({ children }: { children: React.ReactNode }) {
  return useAppData().ready ? children : null;
}

function renderWorkflow(onSaved = vi.fn()) {
  render(
    <AppProvider>
      <ReadyGate>
        <RunEntryWorkflow
          session={session}
          onSaved={onSaved}
          onCancel={vi.fn()}
        />
      </ReadyGate>
    </AppProvider>,
  );
  return onSaved;
}

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe("manual run entry workflow", () => {
  it("opens on FIT import and supports the manual review-and-save flow", async () => {
    const onSaved = renderWorkflow();
    expect(
      await screen.findByRole("tab", { name: "Import FIT files" }),
    ).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("tab", { name: "Enter manually" }));
    fireEvent.change(
      screen.getByRole("spinbutton", { name: /Actual distance/ }),
      {
        target: { value: "4.5" },
      },
    );
    fireEvent.change(screen.getByRole("textbox", { name: /^Duration/ }), {
      target: { value: "42:21" },
    });
    const interpretation = screen.getByRole("combobox", {
      name: "Duration interpretation",
    });
    expect(interpretation).toBeEnabled();
    expect(interpretation).toHaveValue("minutes-seconds");

    fireEvent.click(screen.getByRole("button", { name: "Review entry" }));
    expect(
      screen.getByRole("heading", { name: "Confirm the run result" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm and save" }));
    expect(onSaved).toHaveBeenCalledOnce();

    await waitFor(() => {
      const stored = JSON.parse(
        window.localStorage.getItem("stride-plan:data:v1") ?? "{}",
      ) as {
        journals?: Array<{
          sessionId?: string;
          actualDistanceMiles?: number;
        }>;
      };
      expect(
        stored.journals?.find((journal) => journal.sessionId === session.id)
          ?.actualDistanceMiles,
      ).toBe(4.5);
    });
  });

  it("locks unambiguous duration interpretation and keeps location geometry", async () => {
    renderWorkflow();
    fireEvent.click(await screen.findByRole("tab", { name: "Enter manually" }));
    const duration = screen.getByRole("textbox", { name: /^Duration/ });
    fireEvent.change(duration, { target: { value: "1:35:20" } });
    const interpretation = screen.getByRole("combobox", {
      name: "Duration interpretation",
    });
    expect(interpretation).toBeDisabled();
    expect(document.querySelector(".interpretation-select svg")).toBeNull();

    const location = screen.getByPlaceholderText("Right hamstring");
    const locationField = location.closest(".form-field");
    expect(location).toBeDisabled();
    expect(locationField).toHaveClass("concealed-field");
    fireEvent.change(screen.getByRole("combobox", { name: /^Severity/ }), {
      target: { value: "mild" },
    });
    expect(location).toBeEnabled();
    expect(locationField).not.toHaveClass("concealed-field");
  });

  it("requires a description for modified entries", async () => {
    renderWorkflow();
    fireEvent.click(await screen.findByRole("tab", { name: "Enter manually" }));
    fireEvent.click(screen.getByRole("button", { name: "Modified" }));
    fireEvent.click(screen.getByRole("button", { name: "Review entry" }));
    expect(
      screen.getByText("Describe what changed from the original plan."),
    ).toBeInTheDocument();
  });
});
