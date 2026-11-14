import { describe, expect, it } from "vitest";
import { FitFileParserDecoder } from "../domain/fit-decoder";
import { createFitFixture } from "../test/fit-fixture";
import { FitImportService } from "./fit-import-service";
import { MemoryFitSourceStore } from "./fit-source-store";
import { FitSourceStorageError } from "./fit-source-contract";
import { inspectLegacyRestore } from "./restore";
import { createInitialData } from "../domain/seed";

describe("FIT import service", () => {
  it("retains decoded facts but never claims verified storage after a native write failure", async () => {
    const service = new FitImportService(new FitFileParserDecoder(), {
      preserve: async () => {
        throw new FitSourceStorageError("write_failed");
      },
      read: async () => {
        throw new FitSourceStorageError("missing");
      },
    });
    const result = await service.inspect({
      fileName: "synthetic.fit",
      bytes: createFitFixture(),
      importedAt: "2026-11-14T17:00:00.000Z",
      existingSources: [],
    });
    if (result.status !== "decoded") throw new Error("Expected decoded FIT");
    expect(result.source).toMatchObject({
      preservationStatus: "failed",
      preservationError: expect.stringContaining("Retry is safe"),
    });
    expect(result.source.storedRelativePath).toBeUndefined();
    expect(result.activities).toHaveLength(1);
  });

  it("does not fabricate missing source availability when restoring a snapshot with verified flags", async () => {
    const service = new FitImportService(
      new FitFileParserDecoder(),
      new MemoryFitSourceStore(),
    );
    const result = await service.inspect({
      fileName: "synthetic.fit",
      bytes: createFitFixture(),
      importedAt: "2026-11-14T17:00:00.000Z",
      existingSources: [],
    });
    if (result.status !== "decoded") throw new Error("Expected decoded FIT");
    const snapshot = createInitialData();
    snapshot.fitSources = [result.source];
    snapshot.fitSourceActivities = result.activities;
    const preview = await inspectLegacyRestore(JSON.stringify(snapshot), {
      preserve: async () => {
        throw new Error("Restore cannot write source files");
      },
      read: async () => {
        throw new FitSourceStorageError("missing");
      },
    });
    expect(preview.missingSources).toEqual(["synthetic.fit"]);
    expect(preview.data.fitSources[0].preservationStatus).not.toBe("verified");
  });

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
