import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppProvider, useAppData } from "./app-context";
import { BrowserRepository, STORAGE_KEY } from "./repository";
import { createInitialData } from "../domain/seed";
import type { ConfirmationCommand } from "../domain/logical-activity";

const command: ConfirmationCommand = {
  commandId: "command",
  activityId: "activity",
  eventId: "event",
  expectedRevision: null,
  assignedDate: "2026-11-24",
  plannedSessionId: null,
  sources: [
    {
      kind: "manual",
      sourceId: "manual",
      occurredAt: null,
      localDate: null,
      timezone: null,
    },
  ],
  recorded: {
    distanceMiles: 4,
    durationSeconds: 2400,
    averageHr: null,
    outcome: "unplanned",
    note: null,
    shoeAllocations: [],
  },
  duplicateDecisions: [],
};
describe("confirmation and concurrent app changes", () => {
  it("publishes only after persistence and retains a concurrent settings edit", async () => {
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
      commitLogical: (before: string, after: string) => Promise<null>;
    };
    const actual = target.commitLogical.bind(repository);
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const began = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.spyOn(target, "commitLogical").mockImplementation(
      async (before, after) => {
        started();
        await gate;
        return actual(before, after);
      },
    );
    let app!: ReturnType<typeof useAppData>;
    function Capture() {
      app = useAppData();
      return null;
    }
    render(
      <AppProvider repository={repository}>
        <Capture />
      </AppProvider>,
    );
    await waitFor(() => expect(app.ready).toBe(true));
    let pending!: ReturnType<typeof app.confirmLogicalActivity>;
    act(() => {
      pending = app.confirmLogicalActivity(command);
    });
    await began;
    expect(app.data.logicalActivities).toBeUndefined();
    act(() => {
      app.updateSettings({ easyHrHigh: 146 });
    });
    await act(async () => {
      release();
      expect((await pending).status).toBe("confirmed");
    });
    await waitFor(() =>
      expect(JSON.parse(values.get(STORAGE_KEY)!).settings.easyHrHigh).toBe(
        146,
      ),
    );
    expect(app.data.settings.easyHrHigh).toBe(146);
    expect(app.data.logicalActivities?.activities).toHaveLength(1);
    const stored = JSON.parse(values.get(STORAGE_KEY)!);
    expect(stored.logicalActivities.commands).toHaveLength(1);
  });
});
