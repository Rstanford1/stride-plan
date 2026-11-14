import { describe, expect, it, vi } from "vitest";
import { createInitialData } from "../domain/seed";
import {
  BrowserRepository,
  SerializedRepository,
  STORAGE_KEY,
} from "./repository";
import { inspectLegacyRestore } from "./restore";
import { MemoryFitSourceStore } from "./fit-source-store";
import { sha256Hex } from "../domain/fit-hash";
import { upgradeAppData } from "../domain/app-data";

function fixture(raw?: string) {
  const values = new Map<string, string>(
    raw === undefined ? [] : [[STORAGE_KEY, raw]],
  );
  const storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
  };
  return { values, storage, repository: new BrowserRepository(storage) };
}
const original = () => JSON.stringify(createInitialData(), null, 2);
const replacement = () => {
  const data = createInitialData();
  data.sessions = [];
  data.settings.easyHrHigh = 170;
  return JSON.stringify(data);
};

describe("fail-closed loading", () => {
  it("seeds only absent storage and acknowledges persistence before opening", async () => {
    const f = fixture();
    expect((await f.repository.load()).sessions.length).toBeGreaterThan(0);
    expect(f.repository.state).toBe("empty");
    expect(f.values.has(STORAGE_KEY)).toBe(true);
  });
  it("reads valid data without rewriting original bytes", async () => {
    const f = fixture(original());
    expect(await f.repository.load()).toEqual(createInitialData());
    expect(f.repository.state).toBe("valid");
    expect(f.storage.setItem).not.toHaveBeenCalled();
  });
  it.each([
    "",
    "{broken",
    "null",
    '{"schemaVersion":4}',
    ...[0, 1, 5, 6, 99].map((schemaVersion) =>
      JSON.stringify({ ...createInitialData(), schemaVersion }),
    ),
  ])("rejects invalid or incompatible bytes: %s", async (raw) => {
    const f = fixture(raw);
    await expect(f.repository.load()).rejects.toThrow();
    await expect(f.repository.save(createInitialData())).rejects.toThrow(
      "disabled",
    );
    expect(f.values.get(STORAGE_KEY)).toBe(raw);
    expect(f.storage.setItem).not.toHaveBeenCalled();
  });
  it("rejects the actual v6 review collections without downgrading", async () => {
    const raw = JSON.stringify({
      ...createInitialData(),
      schemaVersion: 6,
      activityReviewDrafts: [{ id: "keep-draft" }],
      activityReviewConfirmations: [{ id: "keep-confirmation" }],
    });
    const f = fixture(raw);
    await expect(f.repository.load()).rejects.toMatchObject({
      kind: "unsupported",
    });
    expect(f.values.get(STORAGE_KEY)).toBe(raw);
    expect(f.storage.setItem).not.toHaveBeenCalled();
  });
  it("surfaces denied access including access to localStorage itself", async () => {
    const f = fixture(original());
    f.storage.getItem.mockImplementation(() => {
      throw new DOMException("Denied", "SecurityError");
    });
    await expect(f.repository.load()).rejects.toMatchObject({
      kind: "inaccessible",
    });
    expect(f.storage.setItem).not.toHaveBeenCalled();
    const repository = new BrowserRepository(() => {
      throw new Error("Permission denied");
    });
    await expect(repository.load()).rejects.toMatchObject({
      kind: "inaccessible",
    });
  });
  it("does not open demo data when the first durable seed write fails", async () => {
    const f = fixture();
    f.storage.setItem.mockImplementation(() => {
      throw new Error("disk full");
    });
    await expect(f.repository.load()).rejects.toMatchObject({
      kind: "inaccessible",
    });
    expect(f.values.size).toBe(0);
  });
  it.each([2, 3])(
    "copies exact v%s bytes before migration and preserves original/revision values",
    async (version) => {
      const data = createInitialData();
      const legacy = {
        ...data,
        schemaVersion: version,
        shoes: version === 2 ? undefined : data.shoes,
        fitSources: undefined,
        fitSourceActivities: undefined,
        fitImportBatches: undefined,
        journals: [
          {
            id: "history",
            date: "2026-11-03",
            sleep: version === 2 ? "a-little" : "limited",
            updatedAt: "2026-11-03T12:00:00Z",
          },
        ],
      };
      legacy.sessions[0].revisions = [
        {
          id: "r",
          changedAt: "2026-11-03T12:00:00Z",
          field: "plannedDistanceMiles",
          from: 3,
          to: 2,
          reason: "Preserve me",
        },
      ];
      const raw = JSON.stringify(legacy, null, 2),
        f = fixture(raw);
      const loaded = await f.repository.load();
      expect(loaded.sessions).toEqual(legacy.sessions);
      expect(loaded.journals[0].sleep).toBe("limited");
      expect(f.storage.setItem.mock.calls[0][0]).toContain("before-migration");
      expect(f.storage.setItem.mock.calls[0][1]).toBe(raw);
      expect(await new BrowserRepository(f.storage).load()).toEqual(loaded);
    },
  );
  it("does not migrate when safety-copy verification fails", async () => {
    const raw = JSON.stringify({ ...createInitialData(), schemaVersion: 3 }),
      f = fixture(raw);
    f.storage.setItem.mockImplementation(() => {});
    await expect(f.repository.load()).rejects.toMatchObject({
      kind: "inaccessible",
    });
    expect(f.values.get(STORAGE_KEY)).toBe(raw);
  });
});

describe("deep validation", () => {
  it.each([
    (d: ReturnType<typeof createInitialData>) => {
      d.sessions[0].plannedDistanceMiles = -1;
    },
    (d: ReturnType<typeof createInitialData>) => {
      d.sessions[0].revisions = [
        {
          id: "r",
          changedAt: "bad",
          field: "distance",
          from: 1,
          to: 2,
          reason: "x",
        },
      ];
    },
    (d: ReturnType<typeof createInitialData>) => {
      d.sessions[0].scheduledDate = "2026-02-31";
    },
    (d: ReturnType<typeof createInitialData>) => {
      d.sessions.push(d.sessions[0]);
    },
    (d: ReturnType<typeof createInitialData>) => {
      d.journals = [
        {
          id: "j",
          date: "2026-11-03",
          updatedAt: "2026-11-03T12:00:00Z",
          sessionId: "missing",
        },
      ];
    },
    (d: ReturnType<typeof createInitialData>) => {
      d.journals = [
        {
          id: "j",
          date: "2026-11-03",
          updatedAt: "2026-11-03T12:00:00Z",
          shoeId: "missing",
        },
      ];
    },
    (d: ReturnType<typeof createInitialData>) => {
      d.settings.easyHrHigh = Infinity;
    },
    (d: ReturnType<typeof createInitialData>) => {
      d.fitImportBatches = [
        {
          id: "b",
          createdAt: "2026-11-03T12:00:00Z",
          sourceResults: [
            { sourceId: "missing", status: "decoded", activityIds: [] },
          ],
        },
      ];
    },
  ])("rejects malformed nested records and references", (mutate) => {
    const data = createInitialData();
    mutate(data);
    expect(() => upgradeAppData(data)).toThrow();
  });
  it("never discards unrecognized collections or populated later-version fields", () => {
    expect(() =>
      upgradeAppData({
        ...createInitialData(),
        futureRecords: [{ id: "keep" }],
      }),
    ).toThrow();
    expect(() =>
      upgradeAppData({ ...createInitialData(), schemaVersion: 2 }),
    ).toThrow();
  });
});

describe("safe legacy replacement", () => {
  it("preview and cancellation do not change storage", async () => {
    const f = fixture(original());
    await f.repository.load();
    await inspectLegacyRestore(replacement(), new MemoryFitSourceStore());
    expect(f.storage.setItem).not.toHaveBeenCalled();
    expect(f.values.get(STORAGE_KEY)).toBe(original());
  });
  it("stages, retains exact prior bytes, commits, then survives restart", async () => {
    const f = fixture(original());
    const repository = new SerializedRepository(f.repository);
    await repository.load();
    const restored = await repository.restore(replacement());
    expect(restored.sessions).toEqual([]);
    expect(
      [...f.values.entries()].find(([key]) =>
        key.includes("before-restore"),
      )?.[1],
    ).toBe(original());
    expect(await new BrowserRepository(f.storage).load()).toEqual(restored);
  });
  it.each(["before-restore", "restore-input", "restore-stage", STORAGE_KEY])(
    "preserves the original when writing %s fails",
    async (failure) => {
      const f = fixture(original());
      await f.repository.load();
      f.storage.setItem.mockImplementation((key, value) => {
        if (
          failure === STORAGE_KEY ? key === STORAGE_KEY : key.includes(failure)
        )
          throw new Error("Disk full / permission denied");
        f.values.set(key, value);
      });
      await expect(f.repository.restore(replacement())).rejects.toMatchObject({
        kind: "inaccessible",
      });
      expect(f.values.get(STORAGE_KEY)).toBe(original());
      await expect(f.repository.save(createInitialData())).rejects.toThrow(
        "disabled",
      );
      expect(await new BrowserRepository(f.storage).load()).toEqual(
        createInitialData(),
      );
    },
  );
  it("rolls back a committed write whose acknowledgement was lost", async () => {
    const f = fixture(original());
    await f.repository.load();
    let interrupted = false;
    f.storage.setItem.mockImplementation((key, value) => {
      f.values.set(key, value);
      if (key === STORAGE_KEY && !interrupted) {
        interrupted = true;
        throw new Error("Lost response");
      }
    });
    await expect(f.repository.restore(replacement())).rejects.toThrow();
    expect(f.values.get(STORAGE_KEY)).toBe(original());
    expect(await new BrowserRepository(f.storage).load()).toEqual(
      createInitialData(),
    );
  });
  it("never overwrites a concurrent newer snapshot", async () => {
    const f = fixture(original());
    await f.repository.load();
    const newer = JSON.stringify({ ...createInitialData(), schemaVersion: 6 });
    f.values.set(STORAGE_KEY, newer);
    await expect(f.repository.restore(replacement())).rejects.toThrow();
    expect(f.values.get(STORAGE_KEY)).toBe(newer);
  });
  it("rejects invalid restore without writing a safety copy or replacement", async () => {
    const f = fixture(original());
    await f.repository.load();
    await expect(f.repository.restore("{broken")).rejects.toThrow();
    expect(f.storage.setItem).not.toHaveBeenCalled();
  });
  it("does not trust FIT verification flags or copied paths, rechecks at commit", async () => {
    const data = createInitialData(),
      bytes = new Uint8Array([1, 2, 3]),
      sourceHash = await sha256Hex(bytes);
    data.fitSources = [
      {
        id: "source",
        sourceHash,
        byteLength: 3,
        originalFileName: "synthetic.fit",
        importedAt: "2026-11-03T12:00:00Z",
        decoderId: "test",
        decoderVersion: "1",
        preservationStatus: "verified",
        storedRelativePath: "untrusted/path.fit",
      },
    ];
    const sources = new MemoryFitSourceStore();
    const raw = JSON.stringify(data);
    expect((await inspectLegacyRestore(raw, sources)).missingSources).toEqual([
      "synthetic.fit",
    ]);
    const f = fixture(original()),
      repository = new BrowserRepository(f.storage, sources);
    await repository.load();
    await expect(repository.restore(raw)).rejects.toThrow("FIT files");
    expect(f.values.get(STORAGE_KEY)).toBe(original());
    await sources.preserve(sourceHash, bytes);
    const preview = await inspectLegacyRestore(raw, sources);
    expect(preview.missingSources).toEqual([]);
    expect(preview.data.fitSources[0].storedRelativePath).toContain(sourceHash);
    vi.spyOn(sources, "read").mockResolvedValue(new Uint8Array([9, 9, 9]));
    await expect(repository.restore(raw)).rejects.toThrow("FIT files");
    expect(f.values.get(STORAGE_KEY)).toBe(original());
  });
});

it("does not seed when the active browser key is missing but safety copies exist", async () => {
  const f = fixture(original());
  await f.repository.load();
  await f.repository.restore(replacement());
  f.values.delete(STORAGE_KEY);
  f.storage.setItem.mockClear();
  await expect(new BrowserRepository(f.storage).load()).rejects.toMatchObject({
    kind: "corrupted",
  });
  expect(f.storage.setItem).not.toHaveBeenCalled();
  expect([...f.values.values()]).toContain(original());
});

it("retains recoverable old bytes even if both acknowledgement and rollback fail", async () => {
  const f = fixture(original());
  await f.repository.load();
  let committed = false;
  f.storage.setItem.mockImplementation((key, value) => {
    if (key === STORAGE_KEY) {
      if (!committed) {
        f.values.set(key, value);
        committed = true;
      }
      throw new Error("Storage unavailable");
    }
    f.values.set(key, value);
  });
  await expect(f.repository.restore(replacement())).rejects.toMatchObject({
    kind: "inaccessible",
  });
  expect(
    [...f.values.entries()].find(([key]) =>
      key.includes("before-restore"),
    )?.[1],
  ).toBe(original());
  await expect(f.repository.save(createInitialData())).rejects.toThrow(
    "disabled",
  );
});
