import { describe, expect, it } from "vitest";
import { FitFileParserDecoder } from "../domain/fit-decoder";
import { createFitFixture } from "../test/fit-fixture";
import { FitImportService } from "./fit-import-service";
import { MemoryFitSourceStore } from "./fit-source-store";

describe("FIT import service", () => {
  it("creates immutable source facts and verified preservation metadata", async () => {
    const service = new FitImportService(
      new FitFileParserDecoder(),
      new MemoryFitSourceStore(),
    );
    const result = await service.inspect({
      fileName: "generated-activity.fit",
      bytes: createFitFixture(),
      importedAt: "2026-11-08T17:00:00.000Z",
      existingSources: [],
    });
    expect(result.status).toBe("decoded");
    if (result.status !== "decoded") throw new Error("Expected decoded FIT");
    expect(result.source).toMatchObject({
      originalFileName: "generated-activity.fit",
      preservationStatus: "verified",
      decoderId: "fit-file-parser",
    });
    expect(result.activities[0]).toMatchObject({
      sourceId: result.source.id,
      distanceMeters: 5_000,
      recordCount: 2,
    });
  });

  it("detects an exact duplicate before decoding it again", async () => {
    const bytes = createFitFixture();
    const decoder = {
      decode: async () => {
        throw new Error("Duplicate should not be decoded");
      },
    };
    const firstService = new FitImportService(
      new FitFileParserDecoder(),
      new MemoryFitSourceStore(),
    );
    const first = await firstService.inspect({
      fileName: "first.fit",
      bytes,
      importedAt: "2026-11-08T17:00:00.000Z",
      existingSources: [],
    });
    if (first.status !== "decoded") throw new Error("Expected decoded FIT");
    const duplicate = await new FitImportService(
      decoder,
      new MemoryFitSourceStore(),
    ).inspect({
      fileName: "renamed.fit",
      bytes,
      importedAt: "2026-11-08T17:01:00.000Z",
      existingSources: [first.source],
    });
    expect(duplicate).toMatchObject({
      status: "exact-duplicate",
      sourceId: first.source.id,
    });
  });
});
