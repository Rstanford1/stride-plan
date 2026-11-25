import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppProvider, useAppData } from "../data/app-context";
import { createInitialData, createSeedSessions } from "../domain/seed";
import { RunEntryWorkflow } from "./RunEntryWorkflow";
import {
  BrowserRepository,
  STORAGE_KEY,
  type AppRepository,
} from "../data/repository";

const session = createSeedSessions().find((item) => item.kind === "easy")!;

function ReadyGate({ children }: { children: React.ReactNode }) {
  return useAppData().ready ? children : null;
}

function renderWorkflow(onSaved = vi.fn(), repository?: AppRepository) {
  render(
    <AppProvider repository={repository}>
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
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());

    await waitFor(() => {
      const stored = JSON.parse(
        window.localStorage.getItem("stride-plan:data:v1") ?? "{}",
      ) as {
        logicalActivities?: {
          activities: Array<{
            versions: Array<{
              plannedSessionId: string;
              recorded: {
                distanceMiles: number;
                manualEntry: { sessionId: string };
              };
            }>;
          }>;
        };
      };
      expect(
        stored.logicalActivities?.activities[0].versions[0].recorded
          .distanceMiles,
      ).toBe(4.5);
      expect(
        stored.logicalActivities?.activities[0].versions[0].recorded.manualEntry
          .sessionId,
      ).toBe(session.id);
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
  it("requires an explicit decision before associating an older manual record", async () => {
    const data = createInitialData();
    data.shoes[0].mileageMiles = 100;
    data.journals.push({
      id: "legacy-manual",
      sessionId: session.id,
      date: session.scheduledDate,
      actualDistanceMiles: 4,
      durationSeconds: 2400,
      shoeId: data.shoes[0].id,
      updatedAt: "2026-11-24T12:00:00Z",
    });
    window.localStorage.setItem("stride-plan:data:v1", JSON.stringify(data));
    const onSaved = renderWorkflow();
    fireEvent.click(await screen.findByRole("tab", { name: "Enter manually" }));
    fireEvent.click(screen.getByRole("button", { name: "Review entry" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm and save" }));
    const select = await screen.findByRole("combobox", {
      name: /Manual journal/,
    });
    expect(onSaved).not.toHaveBeenCalled();
    fireEvent.change(select, { target: { value: "keep-both" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm and save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/same source/);
    fireEvent.change(select, { target: { value: "merge" } });
    const attribution = screen.getByRole("combobox", {
      name: /already included in its shoe mileage/i,
    });
    fireEvent.change(attribution, { target: { value: "included" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm and save" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    const stored = JSON.parse(
      window.localStorage.getItem("stride-plan:data:v1")!,
    );
    expect(stored.journals).toHaveLength(1);
    expect(
      stored.logicalActivities.activities[0].versions[0].sources[0].original.id,
    ).toBe("legacy-manual");
    expect(
      stored.logicalActivities.activities[0].versions[0].sources[0]
        .legacyShoeCredit,
    ).toEqual({ shoeId: data.shoes[0].id, distanceMiles: 4 });
  });
  it("reopens a confirmed manual run and retains its confirmation time through a note correction", async () => {
    const firstSaved = renderWorkflow();
    fireEvent.click(await screen.findByRole("tab", { name: "Enter manually" }));
    fireEvent.change(
      screen.getByRole("spinbutton", { name: /Actual distance/ }),
      { target: { value: "4" } },
    );
    fireEvent.change(screen.getByRole("textbox", { name: /^Duration/ }), {
      target: { value: "40:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review entry" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm and save" }));
    await waitFor(() => expect(firstSaved).toHaveBeenCalledOnce());
    const first = JSON.parse(
      window.localStorage.getItem("stride-plan:data:v1")!,
    ).logicalActivities.activities[0];
    cleanup();
    const correctionSaved = renderWorkflow();
    fireEvent.click(await screen.findByRole("tab", { name: "Enter manually" }));
    fireEvent.change(screen.getByRole("textbox", { name: /^Note/ }), {
      target: { value: "Synthetic correction" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review entry" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm and save" }));
    await waitFor(() => expect(correctionSaved).toHaveBeenCalledOnce());
    const after = JSON.parse(
      window.localStorage.getItem("stride-plan:data:v1")!,
    ).logicalActivities.activities[0];
    expect(after.confirmed.confirmedAt).toBe(first.confirmed.confirmedAt);
    expect(after.versions).toHaveLength(2);
    expect(after.versions[0].recorded.manualEntry.note).toBeUndefined();
    expect(after.versions[1].recorded.manualEntry.note).toBe(
      "Synthetic correction",
    );
  });
  it("does not acknowledge a failed write and retries the same confirmation", async () => {
    const values = new Map([
      [STORAGE_KEY, JSON.stringify(createInitialData())],
    ]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    };
    const repository = new BrowserRepository(storage);
    const target = repository as unknown as {
      commitLogical: () => Promise<null>;
    };
    vi.spyOn(target, "commitLogical").mockRejectedValueOnce(
      new Error("Synthetic write failure"),
    );
    const saved = renderWorkflow(vi.fn(), repository);
    fireEvent.click(await screen.findByRole("tab", { name: "Enter manually" }));
    fireEvent.change(
      screen.getByRole("spinbutton", { name: /Actual distance/ }),
      { target: { value: "4" } },
    );
    fireEvent.change(screen.getByRole("textbox", { name: /^Duration/ }), {
      target: { value: "40:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review entry" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm and save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Synthetic write failure",
    );
    expect(saved).not.toHaveBeenCalled();
    expect(JSON.parse(values.get(STORAGE_KEY)!).schemaVersion).toBe(4);
    fireEvent.click(screen.getByRole("button", { name: "Retry confirmation" }));
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(
      JSON.parse(values.get(STORAGE_KEY)!).logicalActivities.activities,
    ).toHaveLength(1);
  });
});
