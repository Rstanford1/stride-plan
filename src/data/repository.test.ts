import { describe, expect, it } from "vitest";
import { BrowserRepository } from "./repository";

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
    expect(upgraded.schemaVersion).toBe(3);
    expect(upgraded.journals[0].sleep).toBe("limited");
    expect(upgraded.shoes[0].isDefault).toBe(true);
  });
});
