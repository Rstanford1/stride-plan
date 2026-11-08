import { FitDecodeError, type FitDecoder } from "../domain/fit-decoder";
import { sha256Hex } from "../domain/fit-hash";
import type {
  FitImportBatch,
  FitSourceActivity,
  FitSourceRecord,
} from "../domain/types";
import { FitImportService } from "./fit-import-service";
import type { FitSourceStore } from "./fit-source-store";

export interface FitImportInput {
  name: string;
  loadBytes(): Promise<Uint8Array>;
}

export interface FitImportBatchResult {
  batch: FitImportBatch;
  sources: FitSourceRecord[];
  activities: FitSourceActivity[];
}

export async function runFitImportBatch(input: {
  files: FitImportInput[];
  existingSources: FitSourceRecord[];
  decoder: FitDecoder;
  sourceStore: FitSourceStore;
  createdAt: string;
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
}): Promise<FitImportBatchResult> {
  const service = new FitImportService(input.decoder, input.sourceStore);
  const sources: FitSourceRecord[] = [];
  const activities: FitSourceActivity[] = [];
  const sourceResults: FitImportBatch["sourceResults"] = [];

  for (const [index, file] of input.files.entries()) {
    if (input.signal?.aborted) {
      sourceResults.push(
        ...input.files.slice(index).map((_, remainingIndex) => ({
          sourceId: `cancelled:${index + remainingIndex}`,
          status: "cancelled" as const,
          activityIds: [],
        })),
      );
      break;
    }
    let sourceHash: string | undefined;
    try {
      const bytes = await file.loadBytes();
      sourceHash = await sha256Hex(bytes);
      const result = await service.inspect({
        fileName: file.name,
        bytes,
        importedAt: input.createdAt,
        existingSources: [...input.existingSources, ...sources],
      });
      if (result.status === "exact-duplicate") {
        sourceResults.push({
          sourceId: result.sourceId,
          status: "exact-duplicate",
          activityIds: [],
        });
      } else {
        sources.push(result.source);
        activities.push(...result.activities);
        sourceResults.push({
          sourceId: result.source.id,
          status: "decoded",
          activityIds: result.activities.map((activity) => activity.id),
        });
      }
    } catch (error) {
      sourceResults.push({
        sourceId: sourceHash ? `fit-source:${sourceHash}` : `failed:${index}`,
        status: "failed",
        activityIds: [],
        errorCode: error instanceof FitDecodeError ? error.code : "read-failed",
        errorMessage:
          error instanceof Error
            ? error.message
            : "The FIT file could not be read.",
      });
    }
    input.onProgress?.(index + 1, input.files.length);
  }

  return {
    batch: {
      id: `fit-batch:${crypto.randomUUID()}`,
      createdAt: input.createdAt,
      completedAt: new Date().toISOString(),
      sourceResults,
    },
    sources,
    activities,
  };
}
