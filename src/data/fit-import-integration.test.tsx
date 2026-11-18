import { StrictMode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppProvider, useAppData } from "./app-context";
import {
  BrowserRepository,
  STORAGE_KEY,
  type AppRepository,
} from "./repository";
import {
  runFitImportBatch,
  type FitImportInput,
} from "./fit-import-controller";
import { FitFileParserDecoder } from "../domain/fit-decoder";
import { createInitialData } from "../domain/seed";
import type { AppData, FitImportBatch } from "../domain/types";
import { createFitFixture } from "../test/fit-fixture";
import { DataScreen } from "../screens/DataScreen";
import * as sourceStores from "./fit-source-store";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function mount(showScreen = false, delaySaves = false) {
  const initial = createInitialData();
  initial.activities = [
    {
      id: "existing-activity",
      sourceHash: "a".repeat(64),
      fileName: "synthetic-existing.fit",
      occurredAt: "2026-11-16T12:00:00Z",
      distanceMiles: 2,
      role: "warm-up",
      isPrimary: false,
      importedAt: "2026-11-16T12:00:00Z",
      laps: [],
    },
  ];
  const values = new Map([[STORAGE_KEY, JSON.stringify(initial)]]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  const sources = new sourceStores.MemoryFitSourceStore();
  vi.spyOn(sourceStores, "createFitSourceStore").mockReturnValue(sources);
  const browser = new BrowserRepository(storage, sources);
  const saveStarted = deferred<void>();
  const saveRelease = deferred<void>();
  const inner: AppRepository = {
    load: () => browser.load(),
    save: async (data) => {
      saveStarted.resolve();
      if (delaySaves) await saveRelease.promise;
      await browser.save(data);
    },
    restore: (raw) => browser.restore(raw),
  };
  // AppProvider also serializes supplied repositories, as in production.
  const repository = inner;
  let app!: ReturnType<typeof useAppData>;
  function Capture() {
    app = useAppData();
    return showScreen && app.ready ? <DataScreen /> : null;
  }
  const view = render(
    <StrictMode>
      <AppProvider repository={repository}>
        <Capture />
      </AppProvider>
    </StrictMode>,
  );
  await waitFor(() => expect(app.ready).toBe(true));

  function start(files?: FitImportInput[], controller?: AbortController) {
    const bytes = deferred<Uint8Array>();
    const pending = app.beginFitImportBatch();
    const completion = runFitImportBatch({
      files: files ?? [
        { name: "synthetic.fit", loadBytes: () => bytes.promise },
      ],
      existingSources: pending.existingSources,
      decoder: new FitFileParserDecoder(),
      sourceStore: sources,
      createdAt: "2026-11-17T12:00:00Z",
      signal: controller?.signal,
    }).then((result) => pending.commitFitImportBatch(result));
    return { bytes, completion };
  }
  async function finish(
    pending: ReturnType<typeof start>,
    bytes = createFitFixture(),
  ): Promise<FitImportBatch | null> {
    let batch: FitImportBatch | null = null;
    await act(async () => {
      pending.bytes.resolve(bytes);
      batch = await pending.completion;
    });
    return batch;
  }
  async function reload() {
    await waitFor(() =>
      expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toEqual(
        JSON.parse(JSON.stringify(app.data)),
      ),
    );
    return new BrowserRepository(storage, sources).load();
  }
  return {
    get app() {
      return app;
    },
    initial,
    storage,
    values,
    sources,
    start,
    finish,
    reload,
    view,
    saveStarted,
    saveRelease,
  };
}

function assertRelationships(data: AppData, sources: number, batches: number) {
  expect(data.fitSources).toHaveLength(sources);
  expect(new Set(data.fitSources.map((s) => s.sourceHash)).size).toBe(sources);
  expect(data.fitSourceActivities).toHaveLength(sources);
  expect(new Set(data.fitSourceActivities.map((a) => a.id)).size).toBe(sources);
  expect(data.fitImportBatches).toHaveLength(batches);
  for (const activity of data.fitSourceActivities) {
    expect(data.fitSources.some((s) => s.id === activity.sourceId)).toBe(true);
  }
  for (const batch of data.fitImportBatches) {
    for (const result of batch.sourceResults) {
      if (result.status === "decoded") {
        expect(result.activityIds).toEqual(
          data.fitSourceActivities
            .filter((a) => a.sourceId === result.sourceId)
            .map((a) => a.id),
        );
      } else expect(result.activityIds).toEqual([]);
      if (result.status === "decoded" || result.status === "exact-duplicate") {
        expect(data.fitSources.some((s) => s.id === result.sourceId)).toBe(
          true,
        );
      }
    }
  }
}

describe("FIT context/controller/persistence races (synthetic storage only)", () => {
  it("preserves a training-session edit made after import starts, including after reload", async () => {
    const h = await mount();
    const pending = h.start();
    act(() =>
      h.app.saveSession(
        h.initial.sessions[0].id,
        { title: "Edited while decoding" },
        "Synthetic edit",
      ),
    );
    const edited = h.app.data.sessions;
    await h.finish(pending);
    expect(h.app.data.sessions).toEqual(edited);
    assertRelationships(h.app.data, 1, 1);
    expect(await h.sources.read(h.app.data.fitSources[0].sourceHash)).toEqual(
      createFitFixture(),
    );
    expect(await h.reload()).toEqual(h.app.data);
  });

  it("preserves journal, shoe mileage, settings, activity and unrelated records, even in the same React batch", async () => {
    const h = await mount();
    const pending = h.start();
    let edited!: AppData;
    await act(async () => {
      h.app.addShoe({
        id: "test-shoe",
        name: "Synthetic",
        mileageMiles: 0,
        isDefault: false,
      });
      h.app.saveRunEntry(
        h.initial.sessions[0].id,
        { status: "completed" },
        {
          id: "test-journal",
          date: "2026-11-17",
          actualDistanceMiles: 3,
          shoeId: "test-shoe",
          note: "Concurrent note",
          updatedAt: "2026-11-17T12:00:00Z",
        },
      );
      h.app.saveJournal({
        id: "other-journal",
        date: "2026-11-16",
        note: "Other note",
        updatedAt: "2026-11-17T12:00:00Z",
      });
      h.app.updateSettings({ easyHrHigh: 171 });
      h.app.updateActivity(h.initial.activities[0].id, { role: "unrelated" });
      // No intervening React render before commit.
      pending.bytes.resolve(createFitFixture());
      await pending.completion;
    });
    edited = h.app.data;
    expect(edited.journals.find((j) => j.id === "test-journal")?.note).toBe(
      "Concurrent note",
    );
    expect(edited.journals.some((j) => j.id === "other-journal")).toBe(true);
    expect(edited.shoes.find((s) => s.id === "test-shoe")?.mileageMiles).toBe(
      3,
    );
    expect(edited.settings.easyHrHigh).toBe(171);
    expect(edited.activities[0].role).toBe("unrelated");
    expect(edited.importFingerprints).toEqual(h.initial.importFingerprints);
    expect(edited.sessions[0].originalDistanceMiles).toBe(
      h.initial.sessions[0].originalDistanceMiles,
    );
    assertRelationships(edited, 1, 1);
    expect(await h.reload()).toEqual(edited);
  });

  it("rechecks same-file overlapping imports at commit and reports the second as a duplicate", async () => {
    const h = await mount();
    const first = h.start(),
      second = h.start();
    const [one, two] = await act(async () => {
      first.bytes.resolve(createFitFixture());
      second.bytes.resolve(createFitFixture());
      return Promise.all([first.completion, second.completion]);
    });
    expect(
      [one, two].flatMap((b) => b!.sourceResults.map((r) => r.status)).sort(),
    ).toEqual(["decoded", "exact-duplicate"]);
    assertRelationships(h.app.data, 1, 2);
    expect(await h.reload()).toEqual(h.app.data);
  });

  it("keeps different-file overlapping imports when they finish in reverse order", async () => {
    const h = await mount();
    const first = h.start(),
      second = h.start();
    expect(
      (await h.finish(second, createFitFixture({ distanceMeters: 6000 })))!
        .sourceResults[0].status,
    ).toBe("decoded");
    expect((await h.finish(first))!.sourceResults[0].status).toBe("decoded");
    assertRelationships(h.app.data, 2, 2);
    expect(await h.reload()).toEqual(h.app.data);
  });

  it("keeps successful files and concurrent imports when one file fails", async () => {
    const h = await mount();
    const first = h.start();
    const second = h.start([
      { name: "broken.fit", loadBytes: async () => new Uint8Array([1, 2, 3]) },
      {
        name: "good.fit",
        loadBytes: async () => createFitFixture({ distanceMeters: 6000 }),
      },
    ]);
    let report: FitImportBatch | null = null;
    await act(async () => {
      report = await second.completion;
    });
    expect(report!.sourceResults.map((r) => r.status)).toEqual([
      "failed",
      "decoded",
    ]);
    expect(report!.sourceResults[0].errorCode).toBeDefined();
    await h.finish(first);
    assertRelationships(h.app.data, 2, 2);
    expect(h.app.data.sessions).toEqual(h.initial.sessions);
    expect(await h.reload()).toEqual(h.app.data);
  });

  it("stop-after-current-file preserves the completed file and reports unstarted files cancelled", async () => {
    const h = await mount();
    const bytes = deferred<Uint8Array>();
    const controller = new AbortController();
    const pending = h.start(
      [
        { name: "current.fit", loadBytes: () => bytes.promise },
        {
          name: "unstarted.fit",
          loadBytes: vi.fn(async () => {
            throw new Error("Must not read");
          }),
        },
      ],
      controller,
    );
    controller.abort();
    let report: FitImportBatch | null = null;
    await act(async () => {
      bytes.resolve(createFitFixture());
      report = await pending.completion;
    });
    expect(report!.sourceResults.map((r) => r.status)).toEqual([
      "decoded",
      "cancelled",
    ]);
    assertRelationships(h.app.data, 1, 1);
    expect(await h.reload()).toEqual(h.app.data);
  });

  it.each(["reset", "restore", "replace"])(
    "rejects an import started before %s, including after replacement finishes",
    async (mode) => {
      const h = await mount();
      const pending = h.start();
      const replacement = createInitialData();
      replacement.settings.easyHrHigh = 199;
      await act(async () => {
        if (mode === "reset") await h.app.resetDemo();
        else if (mode === "restore")
          await h.app.restoreBackup(JSON.stringify(replacement));
        else h.app.replaceData(replacement);
      });
      expect(await h.finish(pending)).toBeNull();
      expect(h.app.data).toEqual(
        mode === "reset" ? createInitialData() : replacement,
      );
      assertRelationships(h.app.data, 0, 0);
      expect(await h.reload()).toEqual(h.app.data);
    },
  );

  it("flushes same-turn edits before restore and never queues an old render behind replacement", async () => {
    const h = await mount(false, true);
    const pending = h.start();
    const replacement = createInitialData();
    replacement.sessions = [];
    let restoring!: Promise<void>;
    act(() => {
      h.app.updateSettings({ easyHrHigh: 177 });
      restoring = h.app.restoreBackup(JSON.stringify(replacement));
    });
    await h.saveStarted.promise;
    expect(await h.finish(pending)).toBeNull();
    await act(async () => {
      h.saveRelease.resolve();
      await restoring;
    });
    const safety = [...h.values.entries()].find(([key]) =>
      key.includes(":before-restore:"),
    );
    expect(JSON.parse(safety![1]).settings.easyHrHigh).toBe(177);
    expect(h.app.data).toEqual(replacement);
    expect(await h.reload()).toEqual(replacement);
  });

  it("a rejected restore conservatively invalidates old imports while allowing a fresh import", async () => {
    const h = await mount();
    const pending = h.start();
    await act(async () => {
      await expect(h.app.restoreBackup("{invalid")).rejects.toThrow();
    });
    expect(h.app.ready).toBe(true);
    expect(await h.finish(pending)).toBeNull();
    expect(h.app.data).toEqual(h.initial);
    await h.finish(h.start());
    assertRelationships(h.app.data, 1, 1);
    expect(await h.reload()).toEqual(h.app.data);
  });

  it("a slow persistence write cannot overwrite a later import or edit", async () => {
    const h = await mount(false, true);
    const pending = h.start();
    act(() => h.app.updateSettings({ easyHrHigh: 173 }));
    await h.saveStarted.promise;
    await h.finish(pending);
    act(() =>
      h.app.saveJournal({
        id: "late",
        date: "2026-11-17",
        note: "Keep",
        updatedAt: "2026-11-17T12:00:00Z",
      }),
    );
    await act(async () => h.saveRelease.resolve());
    const reloaded = await h.reload();
    expect(reloaded).toEqual(h.app.data);
    expect(reloaded.settings.easyHrHigh).toBe(173);
    expect(reloaded.journals.some((j) => j.id === "late")).toBe(true);
    assertRelationships(reloaded, 1, 1);
  });

  it("committing a completed batch twice is idempotent under StrictMode", async () => {
    const h = await mount();
    const pending = h.app.beginFitImportBatch();
    const result = await runFitImportBatch({
      files: [
        { name: "synthetic.fit", loadBytes: async () => createFitFixture() },
      ],
      existingSources: [],
      decoder: new FitFileParserDecoder(),
      sourceStore: h.sources,
      createdAt: "2026-11-17T12:00:00Z",
    });
    act(() => {
      pending.commitFitImportBatch(result);
      pending.commitFitImportBatch(result);
    });
    assertRelationships(h.app.data, 1, 1);
    expect(await h.reload()).toEqual(h.app.data);
  });

  it("DataScreen reports commit-time duplicates and preserves concurrent settings", async () => {
    const h = await mount(true);
    const first = h.start();
    const bytes = deferred<ArrayBuffer>();
    fireEvent.change(screen.getByLabelText(/Choose FIT files/), {
      target: {
        files: [{ name: "synthetic.fit", arrayBuffer: () => bytes.promise }],
      },
    });
    act(() => h.app.updateSettings({ easyHrHigh: 181 }));
    await h.finish(first);
    await act(async () =>
      bytes.resolve(Uint8Array.from(createFitFixture()).buffer),
    );
    expect(
      await screen.findByText("1 exact duplicate(s) skipped"),
    ).toBeVisible();
    expect(h.app.data.settings.easyHrHigh).toBe(181);
    assertRelationships(h.app.data, 1, 2);
    expect(await h.reload()).toEqual(h.app.data);
  });

  it("DataScreen reports invalidated imports without claiming success", async () => {
    const h = await mount(true);
    const bytes = deferred<ArrayBuffer>();
    fireEvent.change(screen.getByLabelText(/Choose FIT files/), {
      target: {
        files: [{ name: "synthetic.fit", arrayBuffer: () => bytes.promise }],
      },
    });
    await act(async () => h.app.resetDemo());
    await act(async () =>
      bytes.resolve(Uint8Array.from(createFitFixture()).buffer),
    );
    expect(await screen.findByText(/FIT import was not added/)).toBeVisible();
    expect(screen.queryByText(/ready to review/)).not.toBeInTheDocument();
    assertRelationships(h.app.data, 0, 0);
    expect(await h.reload()).toEqual(h.app.data);
  });
});
