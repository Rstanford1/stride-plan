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
});
