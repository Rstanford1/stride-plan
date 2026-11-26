import type {
  ActivityEvidence,
  ConfirmationCommand,
  RecordedValues,
} from "../domain/logical-activity";
import type { AppData, JournalEntry } from "../domain/types";
import type { GarminRetrieval } from "./garmin";

/** Manual entry time is not assumed to be the time the run took place. */
export function manualEvidence(
  entry: JournalEntry,
  legacyShoeCredit?: { shoeId: string; distanceMiles: number } | null,
): ActivityEvidence {
  return {
    kind: "manual",
    sourceId: entry.id,
    original: structuredClone(entry),
    ...(legacyShoeCredit !== undefined ? { legacyShoeCredit } : {}),
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
    !/^[a-f0-9]{64}$/.test(result.source.sourceHash) ||
    (result.relatedSourceHashes !== undefined &&
      (!result.relatedSourceHashes.includes(result.source.sourceHash) ||
        new Set(result.relatedSourceHashes).size !==
          result.relatedSourceHashes.length ||
        result.relatedSourceHashes.some(
          (hash) => !/^[a-f0-9]{64}$/.test(hash),
        )))
  )
    throw new Error("Invalid Garmin provenance.");
  return {
    kind: "garmin",
    providerId: result.activityId,
    sourceHash: result.source.sourceHash,
    ...(result.relatedSourceHashes && {
      relatedSourceHashes: [...result.relatedSourceHashes],
    }),
    occurredAt: null,
    localDate: null,
    timezone: null,
  };
}

export interface ConfirmationDetails {
  commandId: string;
  logicalActivityId: string;
  confirmationEventId: string;
  assignedDate: string;
  plannedSessionId: string | null;
  recorded: RecordedValues;
}
function sourceConfirmation(
  source: ActivityEvidence,
  details: ConfirmationDetails,
): ConfirmationCommand {
  return {
    commandId: details.commandId,
    activityId: details.logicalActivityId,
    eventId: details.confirmationEventId,
    expectedRevision: null,
    assignedDate: details.assignedDate,
    plannedSessionId: details.plannedSessionId,
    sources: [source],
    recorded: structuredClone(details.recorded),
    duplicateDecisions: [],
  };
}
/** Consumers supply the assigned date and optional association explicitly. */
export function fitConfirmation(
  data: AppData,
  recordingId: string,
  details: ConfirmationDetails,
): ConfirmationCommand {
  return sourceConfirmation(fitEvidence(data, recordingId), details);
}
/** Garmin confirmation remains separate from credential and synchronization flows. */
export function garminConfirmation(
  result: GarminRetrieval,
  details: ConfirmationDetails,
): ConfirmationCommand {
  return sourceConfirmation(garminEvidence(result), details);
}
