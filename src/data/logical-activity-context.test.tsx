import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppProvider, useAppData } from "./app-context";
import { BrowserRepository, STORAGE_KEY } from "./repository";
import { createInitialData } from "../domain/seed";
import type { ConfirmationCommand } from "../domain/logical-activity";
import { runFitImportBatch } from "./fit-import-controller";
import { FitFileParserDecoder } from "../domain/fit-decoder";
import { MemoryFitSourceStore } from "./fit-source-store";
import { createFitFixture } from "../test/fit-fixture";
import {
  fitConfirmation,
  garminConfirmation,
} from "./logical-activity-evidence";
import { confirmedDistance } from "../domain/logical-activity";
import type { GarminRetrieval } from "./garmin";

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
      original: {
        id: "manual",
        date: "2026-11-24",
        updatedAt: "2026-11-24T12:00:00Z",
      },
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
  it("confirms a preserved FIT and explicitly associates Garmin evidence once", async () => {
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
    const sources = new MemoryFitSourceStore();
    const repository = new BrowserRepository(storage, sources);
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
    const importing = app.beginFitImportBatch();
    const bytes = createFitFixture();
    const batch = await runFitImportBatch({
      files: [{ name: "synthetic.fit", loadBytes: async () => bytes }],
      existingSources: importing.existingSources,
      decoder: new FitFileParserDecoder(),
      sourceStore: sources,
      createdAt: "2026-11-24T12:00:00Z",
    });
    act(() => {
      expect(importing.commitFitImportBatch(batch)).not.toBeNull();
    });
    await waitFor(() => expect(app.data.fitSourceActivities).toHaveLength(1));
    const recording = app.data.fitSourceActivities[0];
    const source = app.data.fitSources[0];
    const details = {
      commandId: "fit-command",
      logicalActivityId: "fit-logical",
      confirmationEventId: "fit-event",
      assignedDate: "2026-11-24",
      plannedSessionId: null,
      recorded: {
        distanceMiles: 3.1,
        durationSeconds: 1800,
        averageHr: null,
        outcome: "unplanned" as const,
        note: null,
        shoeAllocations: [],
      },
    };
    await act(async () => {
      expect(
        (
          await app.confirmLogicalActivity(
            fitConfirmation(app.data, recording.id, details),
          )
        ).status,
      ).toBe("confirmed");
    });
    const garmin = {
      provider: "garmin",
      activityId: "123",
      source: { sourceHash: source.sourceHash },
      relatedSourceHashes: [source.sourceHash],
    } as GarminRetrieval;
    const next = garminConfirmation(garmin, {
      ...details,
      commandId: "garmin-command",
      logicalActivityId: "new-logical",
      confirmationEventId: "new-event",
    });
    let initial;
    await act(async () => {
      initial = await app.confirmLogicalActivity(next);
    });
    expect(initial).toEqual({
      status: "review-required",
      candidates: ["fit-logical"],
    });
    next.duplicateDecisions = [
      { activityId: "fit-logical", decision: "merge" },
    ];
    next.expectedRevision = 1;
    await act(async () => {
      expect((await app.confirmLogicalActivity(next)).status).toBe("confirmed");
    });
    expect(app.data.logicalActivities?.activities).toHaveLength(1);
    expect(
      app.data.logicalActivities?.activities[0].versions[1].sources,
    ).toHaveLength(2);
    expect(confirmedDistance(app.data.logicalActivities!)).toBe(3.1);
    expect(await sources.read(source.sourceHash)).toEqual(bytes);
    const reopened = await new BrowserRepository(storage, sources).load();
    expect(
      reopened.logicalActivities?.activities[0].versions[1].sources,
    ).toHaveLength(2);
  });
  it("recovers a lost acknowledgement without losing a concurrent import or settings edit", async () => {
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
        await actual(before, after);
        throw new Error("Synthetic acknowledgement loss");
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
    const importing = app.beginFitImportBatch();
    const batch = await runFitImportBatch({
      files: [
        { name: "synthetic.fit", loadBytes: async () => createFitFixture() },
      ],
      existingSources: importing.existingSources,
      decoder: new FitFileParserDecoder(),
      sourceStore: new MemoryFitSourceStore(),
      createdAt: "2026-11-24T12:00:00Z",
    });
    let pending!: ReturnType<typeof app.confirmLogicalActivity>;
    act(() => {
      pending = app.confirmLogicalActivity(command);
    });
    await began;
    expect(app.data.logicalActivities).toBeUndefined();
    act(() => {
      app.updateSettings({ easyHrHigh: 146 });
      expect(importing.commitFitImportBatch(batch)).not.toBeNull();
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
    expect(stored.fitSources).toHaveLength(1);
    expect(stored.fitSourceActivities).toHaveLength(1);
  });
});
