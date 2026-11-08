import { describe, expect, it } from "vitest";
import { sha256Hex } from "../domain/fit-hash";
import { MemoryFitSourceStore } from "./fit-source-store";

describe("FIT source store", () => {
  it("preserves an independent byte-for-byte copy", async () => {
    const store = new MemoryFitSourceStore();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const sourceHash = await sha256Hex(bytes);
    const result = await store.preserve(sourceHash, bytes);
    bytes[0] = 9;
    expect(result.status).toBe("verified");
    expect(await store.read(sourceHash)).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("refuses bytes that do not match their declared hash", async () => {
    const store = new MemoryFitSourceStore();
    await expect(
      store.preserve("0".repeat(64), new Uint8Array([1, 2, 3])),
    ).rejects.toThrow("do not match");
  });
});
