import { createInitialData } from "./seed";
import type { AppData } from "./types";

export function upgradeAppData(value: AppData): AppData {
  if (
    value.schemaVersion === 5 &&
    Array.isArray(value.shoes) &&
    Array.isArray(value.fitSources) &&
    Array.isArray(value.fitSourceActivities) &&
    Array.isArray(value.fitImportBatches) &&
    Array.isArray(value.activityReviewDrafts) &&
    Array.isArray(value.activityReviewConfirmations)
  )
    return value;
  if (
    value.schemaVersion === 4 &&
    Array.isArray(value.fitSources) &&
    Array.isArray(value.fitSourceActivities) &&
    Array.isArray(value.fitImportBatches)
  ) {
    return {
      ...value,
      schemaVersion: 5,
      activityReviewDrafts: [],
      activityReviewConfirmations: [],
    };
  }
  if (value.schemaVersion === 3 && Array.isArray(value.shoes)) {
    return {
      ...value,
      schemaVersion: 5,
      fitSources: [],
      fitSourceActivities: [],
      fitImportBatches: [],
      activityReviewDrafts: [],
      activityReviewConfirmations: [],
    };
  }
  if (value.schemaVersion === 2) {
    const sleepMap = {
      "a-lot": "restorative",
      normal: "adequate",
      "a-little": "limited",
      barely: "severely-limited",
    } as const;
    return {
      ...value,
      schemaVersion: 5,
      journals: value.journals.map((entry) => ({
        ...entry,
        sleep: entry.sleep
          ? sleepMap[entry.sleep as keyof typeof sleepMap]
          : undefined,
        sleepEntryMode: entry.sleep ? "subjective" : undefined,
        createdAt: entry.createdAt ?? entry.updatedAt,
      })),
      shoes: [
        {
          id: "shoe-daily-trainer",
          name: "Daily trainer",
          mileageMiles: 0,
          isDefault: true,
        },
      ],
      fitSources: [],
      fitSourceActivities: [],
      fitImportBatches: [],
      activityReviewDrafts: [],
      activityReviewConfirmations: [],
    };
  }
  return createInitialData();
}
