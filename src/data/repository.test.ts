import { describe, expect, it } from "vitest";
import { createInitialData } from "../domain/seed";
import type { AppData } from "../domain/types";
import {
  BrowserRepository,
  type AppRepository,
  SerializedRepository,
} from "./repository";

describe("browser persistence", () => {
  it("survives a repository restart", async () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const first = new BrowserRepository(storage);
    const data = await first.load();
    data.settings.easyHrHigh = 160;
    await first.save(data);
    const second = new BrowserRepository(storage);
    expect((await second.load()).settings.easyHrHigh).toBe(160);
  });

  it("upgrades version 2 snapshots without discarding journals", async () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const repository = new BrowserRepository(storage);
    const current = await repository.load();
    const versionTwo = {
      ...current,
      schemaVersion: 2,
      shoes: undefined,
      journals: [
        {
          id: "journal-old",
          date: "2026-11-07",
          sleep: "a-little",
          updatedAt: "2026-11-07T12:00:00Z",
        },
      ],
    };
    values.set("stride-plan:data:v1", JSON.stringify(versionTwo));
    const upgraded = await repository.load();
    expect(upgraded.schemaVersion).toBe(5);
    expect(upgraded.journals[0].sleep).toBe("limited");
    expect(upgraded.shoes[0].isDefault).toBe(true);
    expect(upgraded.fitSources).toEqual([]);
  });

  it("upgrades version 3 snapshots with empty FIT source collections", async () => {
    const values = new Map<string, string>();
    const repository = new BrowserRepository({
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    const versionThree = { ...createInitialData(), schemaVersion: 3 };
    delete (versionThree as Partial<AppData>).fitSources;
    delete (versionThree as Partial<AppData>).fitSourceActivities;
    delete (versionThree as Partial<AppData>).fitImportBatches;
    values.set("stride-plan:data:v1", JSON.stringify(versionThree));
    const upgraded = await repository.load();
    expect(upgraded.schemaVersion).toBe(5);
    expect(upgraded.fitSources).toEqual([]);
    expect(upgraded.fitSourceActivities).toEqual([]);
    expect(upgraded.fitImportBatches).toEqual([]);
    expect(upgraded.activityReviewDrafts).toEqual([]);
    expect(upgraded.activityReviewConfirmations).toEqual([]);
  });

  it("upgrades version 4 snapshots with empty review collections", async () => {
    const values = new Map<string, string>();
    const repository = new BrowserRepository({
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    const versionFour = { ...createInitialData(), schemaVersion: 4 };
    delete (versionFour as Partial<AppData>).activityReviewDrafts;
    delete (versionFour as Partial<AppData>).activityReviewConfirmations;
    values.set("stride-plan:data:v1", JSON.stringify(versionFour));
    const upgraded = await repository.load();
    expect(upgraded.schemaVersion).toBe(5);
    expect(upgraded.activityReviewDrafts).toEqual([]);
    expect(upgraded.activityReviewConfirmations).toEqual([]);
  });
});

describe("serialized persistence", () => {
  it("does not let a slower save overwrite a newer snapshot", async () => {
    const calls: number[] = [];
    const releases: Array<() => void> = [];
    const inner: AppRepository = {
      load: async () => createInitialData(),
      save: async (data) => {
        calls.push(data.settings.easyHrHigh ?? 0);
        await new Promise<void>((resolve) => releases.push(resolve));
      },
    };
    const repository = new SerializedRepository(inner);
    const firstData = createInitialData();
    firstData.settings.easyHrHigh = 151;
    const secondData = createInitialData();
    secondData.settings.easyHrHigh = 152;
    const first = repository.save(firstData);
    const second = repository.save(secondData);
    await Promise.resolve();
    expect(calls).toEqual([151]);
    releases.shift()?.();
    await first;
    await Promise.resolve();
    expect(calls).toEqual([151, 152]);
    releases.shift()?.();
    await second;
  });
});
