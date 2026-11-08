import { describe, expect, it } from "vitest";
import { FitFileParserDecoder } from "../domain/fit-decoder";
import { createFitFixture } from "../test/fit-fixture";
import { runFitImportBatch } from "./fit-import-controller";
import { MemoryFitSourceStore } from "./fit-source-store";

describe("FIT import batches", () => {
  it("keeps successful files when another file fails", async () => {
    const result = await runFitImportBatch({
      files: [
        {
          name: "valid.fit",
          loadBytes: async () => createFitFixture(),
        },
        {
          name: "broken.fit",
          loadBytes: async () => new Uint8Array([1, 2, 3]),
        },
      ],
      existingSources: [],
      decoder: new FitFileParserDecoder(),
      sourceStore: new MemoryFitSourceStore(),
      createdAt: "2026-11-08T17:00:00.000Z",
    });
    expect(result.sources).toHaveLength(1);
    expect(result.activities).toHaveLength(1);
    expect(result.batch.sourceResults.map((item) => item.status)).toEqual([
      "decoded",
      "failed",
    ]);
  });

  it("records files not started after cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runFitImportBatch({
      files: [
        { name: "one.fit", loadBytes: async () => createFitFixture() },
        { name: "two.fit", loadBytes: async () => createFitFixture() },
      ],
      existingSources: [],
      decoder: new FitFileParserDecoder(),
      sourceStore: new MemoryFitSourceStore(),
      createdAt: "2026-11-08T17:00:00.000Z",
      signal: controller.signal,
    });
    expect(result.batch.sourceResults.map((item) => item.status)).toEqual([
      "cancelled",
      "cancelled",
    ]);
  });
});
