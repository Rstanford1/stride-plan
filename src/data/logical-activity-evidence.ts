import type { ActivityEvidence } from "../domain/logical-activity";
import type { AppData, JournalEntry } from "../domain/types";
import type { GarminRetrieval } from "./garmin";

/** Manual entry time is not assumed to be the time the run took place. */
export function manualEvidence(entry: JournalEntry): ActivityEvidence {
  return {
    kind: "manual",
    sourceId: entry.id,
    occurredAt: null,
    localDate: entry.date,
    timezone: null,
  };
}

/** The native commit verifies the original bytes again before acknowledgement. */
export function fitEvidence(
  data: AppData,
  activityId: string,
): ActivityEvidence {
  const recording = data.fitSourceActivities.find(
    (item) => item.id === activityId,
  );
  const source = data.fitSources.find(
    (item) => item.id === recording?.sourceId,
  );
  if (!recording || !source || source.preservationStatus !== "verified")
    throw new Error(
      "The original FIT recording must be preserved and verified before confirmation.",
    );
  return {
    kind: "fit",
    sourceId: source.id,
    activityId: recording.id,
    sourceHash: source.sourceHash,
    occurredAt: recording.occurredAt,
    localDate: recording.localDate ?? null,
    timezone: null,
  };
}

/** Provider identity is kept separately from the verified original FIT hash. */
export function garminEvidence(result: GarminRetrieval): ActivityEvidence {
  if (
    result.provider !== "garmin" ||
    !result.activityId ||
    !/^[a-f0-9]{64}$/.test(result.source.sourceHash)
  )
    throw new Error("Invalid Garmin provenance.");
  return {
    kind: "garmin",
    providerId: result.activityId,
    sourceHash: result.source.sourceHash,
    occurredAt: null,
    localDate: null,
    timezone: null,
  };
}
