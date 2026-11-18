import type { AppData, FitImportBatch } from "../domain/types";
import type { FitImportBatchResult } from "./fit-import-controller";

/** Reconcile against the commit-time dataset, without changing source facts. */
export function mergeFitImportBatch(
  current: AppData,
  result: FitImportBatchResult,
): { data: AppData; batch: FitImportBatch } {
  const previous = current.fitImportBatches.find(
    (batch) => batch.id === result.batch.id,
  );
  if (previous) return { data: current, batch: previous };

  const byHash = new Map(
    current.fitSources.map((source) => [source.sourceHash, source]),
  );
  const duplicates = new Map<string, string>();
  const sources = result.sources.filter((source) => {
    const existing = byHash.get(source.sourceHash);
    if (existing) {
      duplicates.set(source.id, existing.id);
      return false;
    }
    byHash.set(source.sourceHash, source);
    return true;
  });
  const acceptedIds = new Set(sources.map((source) => source.id));
  const batch: FitImportBatch = {
    ...result.batch,
    sourceResults: result.batch.sourceResults.map((item) => {
      const duplicateId = duplicates.get(item.sourceId);
      return duplicateId &&
        (item.status === "decoded" || item.status === "exact-duplicate")
        ? {
            ...item,
            sourceId: duplicateId,
            status: "exact-duplicate",
            activityIds: [],
          }
        : item;
    }),
  };
  return {
    data: {
      ...current,
      fitSources: [...current.fitSources, ...sources],
      fitSourceActivities: [
        ...current.fitSourceActivities,
        ...result.activities.filter((activity) =>
          acceptedIds.has(activity.sourceId),
        ),
      ],
      fitImportBatches: [...current.fitImportBatches, batch],
    },
    batch,
  };
}
