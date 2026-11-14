import { z } from "zod";
import type { AppData } from "./types";

export type DataErrorKind = "unsupported" | "corrupted" | "inaccessible";
export class DataIntegrityError extends Error {
  constructor(
    public readonly kind: DataErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "DataIntegrityError";
  }
}
export function storageError(error: unknown): DataIntegrityError {
  return error instanceof DataIntegrityError
    ? error
    : new DataIntegrityError(
        "inaccessible",
        "Storage could not be read or written. Check available disk space and file permissions, then retry.",
      );
}
const text = z.string();
const id = text.min(1);
const number = z.number().finite();
const positive = number.nonnegative();
const integer = positive.int();
const date = text.regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T12:00:00Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
});
const time = text.refine(
  (value) =>
    /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)),
);
const hr = positive.max(300).optional();
const scalar = z.union([text, number, z.boolean(), z.null()]);
const lapRole = z.enum(["work", "recovery", "warm-up", "cooldown", "other"]);
const revision = z
  .object({
    id,
    changedAt: time,
    field: id,
    from: scalar,
    to: scalar,
    reason: text,
  })
  .strict();
const session = z
  .object({
    id,
    sourceKey: id,
    week: integer.min(1),
    originalDate: date,
    scheduledDate: date,
    originalDistanceMiles: positive,
    plannedDistanceMiles: positive,
    title: text,
    kind: z.enum(["rest", "easy", "recovery", "workout", "long"]),
    instructions: text,
    guidance: text,
    flexible: z.boolean(),
    phase: text,
    status: z.enum(["planned", "completed", "modified", "skipped", "moved"]),
    outcomeNote: text.optional(),
    replacementDescription: text.optional(),
    revisions: z.array(revision),
  })
  .strict();
const activity = z
  .object({
    id,
    sourceHash: id,
    fileName: text,
    occurredAt: time,
    distanceMiles: positive,
    durationSeconds: positive.optional(),
    averageHr: hr,
    role: z.enum([
      "primary-easy",
      "primary-long",
      "primary-workout",
      "warm-up",
      "cooldown",
      "strides",
      "unrelated",
    ]),
    plannedSessionId: id.optional(),
    bundleId: id.optional(),
    isPrimary: z.boolean(),
    importedAt: time,
    laps: z.array(
      z
        .object({
          id,
          distanceMiles: positive,
          durationSeconds: positive,
          averageHr: hr,
          role: lapRole,
        })
        .strict(),
    ),
  })
  .strict();
const journal = z
  .object({
    id,
    sessionId: id.optional(),
    date,
    actualDistanceMiles: positive.optional(),
    durationSeconds: positive.optional(),
    timeEntryMode: z.enum(["duration", "pace"]).optional(),
    paceSecondsPerUnit: positive.optional(),
    paceUnit: z.enum(["min-mi", "min-km"]).optional(),
    averageHr: hr,
    rpe: integer.min(1).max(10).optional(),
    sleep: z
      .enum(["restorative", "adequate", "limited", "severely-limited"])
      .optional(),
    sleepEntryMode: z.enum(["subjective", "garmin"]).optional(),
    sleepScore: integer.max(100).optional(),
    sleepDurationMinutes: positive.max(1440).optional(),
    soreness: z.enum(["none", "mild", "moderate", "severe"]).optional(),
    sorenessLocation: text.optional(),
    shoeId: id.optional(),
    note: text.optional(),
    createdAt: time.optional(),
    updatedAt: time,
  })
  .strict();
const shoe = z
  .object({
    id,
    name: text,
    mileageMiles: positive,
    isDefault: z.boolean(),
    retired: z.boolean().optional(),
  })
  .strict();
const source = z
  .object({
    id,
    sourceHash: text.regex(/^[a-f0-9]{64}$/),
    originalFileName: text,
    byteLength: integer,
    importedAt: time,
    decoderId: id,
    decoderVersion: id,
    preservationStatus: z.enum([
      "pending",
      "verified",
      "unavailable",
      "failed",
    ]),
    storedRelativePath: text.optional(),
    preservationError: text.optional(),
  })
  .strict();
const sourceActivity = z
  .object({
    id,
    sourceId: id,
    sourceIndex: integer,
    occurredAt: time,
    localDate: date.optional(),
    sport: text,
    subSport: text.optional(),
    distanceMeters: positive,
    durationSeconds: positive.optional(),
    averageHr: hr,
    totalAscentMeters: positive.optional(),
    recordCount: integer,
    laps: z.array(
      z
        .object({
          id,
          sourceIndex: integer,
          startTime: time.optional(),
          distanceMeters: positive,
          durationSeconds: positive,
          averageHr: hr,
        })
        .strict(),
    ),
    samples: z.array(
      z
        .object({
          id,
          sourceIndex: integer,
          timestamp: time.optional(),
          elapsedSeconds: positive.optional(),
          distanceMeters: positive.optional(),
          speedMetersPerSecond: positive.optional(),
          heartRate: hr,
          altitudeMeters: number.optional(),
          cadence: positive.optional(),
          powerWatts: positive.optional(),
        })
        .strict(),
    ),
  })
  .strict();
const batch = z
  .object({
    id,
    createdAt: time,
    completedAt: time.optional(),
    sourceResults: z.array(
      z
        .object({
          sourceId: id,
          status: z.enum([
            "decoded",
            "failed",
            "cancelled",
            "exact-duplicate",
            "possible-duplicate",
            "excluded",
            "unresolved",
          ]),
          activityIds: z.array(id),
          errorCode: text.optional(),
          errorMessage: text.optional(),
        })
        .strict(),
    ),
  })
  .strict();
const common = {
  sessions: z.array(session),
  activities: z.array(activity),
  journals: z.array(journal),
  settings: z
    .object({
      distanceUnit: z.enum(["mi", "km"]),
      easyHrLow: hr,
      easyHrHigh: hr,
      recoveryHrHigh: hr,
    })
    .strict(),
  importFingerprints: z.array(id),
};
const empty = z.array(z.never()).optional();
const versions = {
  2: z
    .object({
      ...common,
      schemaVersion: z.literal(2),
      journals: z.array(
        journal.extend({
          sleep: z.enum(["a-lot", "normal", "a-little", "barely"]).optional(),
        }),
      ),
      shoes: empty,
      fitSources: empty,
      fitSourceActivities: empty,
      fitImportBatches: empty,
    })
    .strict(),
  3: z
    .object({
      ...common,
      schemaVersion: z.literal(3),
      shoes: z.array(shoe),
      fitSources: empty,
      fitSourceActivities: empty,
      fitImportBatches: empty,
    })
    .strict(),
  4: z
    .object({
      ...common,
      schemaVersion: z.literal(4),
      shoes: z.array(shoe),
      fitSources: z.array(source),
      fitSourceActivities: z.array(sourceActivity),
      fitImportBatches: z.array(batch),
    })
    .strict(),
};
export function parseSnapshotJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new DataIntegrityError(
      "corrupted",
      "Saved data is not valid JSON. The original data has been retained.",
    );
  }
}
export function validateSnapshot(value: unknown): void {
  const version =
    value && typeof value === "object" && "schemaVersion" in value
      ? value.schemaVersion
      : undefined;
  if (typeof version !== "number" || !Number.isInteger(version))
    throw new DataIntegrityError(
      "corrupted",
      "Saved data has no valid schema version.",
    );
  if (version !== 2 && version !== 3 && version !== 4)
    throw new DataIntegrityError(
      "unsupported",
      `Snapshot version ${version} is unsupported. Use a compatible application; this build supports versions 2–4 and cannot downgrade newer data.`,
    );
  const result = versions[version].safeParse(value);
  if (!result.success)
    throw new DataIntegrityError(
      "corrupted",
      `Invalid saved record at ${result.error.issues[0].path.join(".") || "snapshot"}. No data was replaced.`,
    );
  // Validate without sanitizing/stripping the caller's original values.
  const data = result.data;
  function unique(values: string[], label: string) {
    if (new Set(values).size !== values.length)
      throw new DataIntegrityError(
        "corrupted",
        `Duplicate ${label} IDs in saved data.`,
      );
  }
  function reference(
    target: string | undefined,
    values: Set<string>,
    label: string,
  ) {
    if (target !== undefined && !values.has(target))
      throw new DataIntegrityError(
        "corrupted",
        `Missing ${label} reference in saved data.`,
      );
  }
  const sessions = new Set(data.sessions.map((x) => x.id));
  const shoes = new Set(data.shoes?.map((x) => x.id));
  for (const [name, records] of Object.entries(data)) {
    if (Array.isArray(records) && name !== "importFingerprints")
      unique(
        records.map((x) => (x as { id: string }).id),
        name,
      );
  }
  unique(data.importFingerprints, "import fingerprint");
  unique(
    data.sessions.flatMap((x) => x.revisions.map((r) => r.id)),
    "revision",
  );
  for (const item of data.journals) {
    reference(item.sessionId, sessions, "journal session");
    reference(item.shoeId, shoes, "journal shoe");
  }
  for (const item of data.activities) {
    reference(item.plannedSessionId, sessions, "activity session");
    unique(
      item.laps.map((x) => x.id),
      "lap",
    );
  }
  if (data.schemaVersion === 4) {
    const sources = new Set(data.fitSources.map((x) => x.id));
    const activities = new Map(data.fitSourceActivities.map((x) => [x.id, x]));
    unique(
      data.fitSources.map((x) => x.sourceHash),
      "FIT hash",
    );
    for (const item of data.fitSourceActivities) {
      reference(item.sourceId, sources, "FIT source");
      unique(
        item.laps.map((x) => x.id),
        "source lap",
      );
      unique(
        item.samples.map((x) => x.id),
        "sample",
      );
    }
    for (const item of data.fitImportBatches)
      for (const result of item.sourceResults) {
        // Failed/cancelled input has a diagnostic ID but deliberately no source record.
        if (!["failed", "cancelled"].includes(result.status))
          reference(result.sourceId, sources, "batch source");
        unique(result.activityIds, "batch activity");
        for (const activityId of result.activityIds) {
          if (activities.get(activityId)?.sourceId !== result.sourceId)
            throw new DataIntegrityError(
              "corrupted",
              "Missing or mismatched batch activity reference.",
            );
        }
      }
  }
}
export function validateCurrentSnapshot(value: AppData): void {
  validateSnapshot(value);
  if (value.schemaVersion !== 4)
    throw new DataIntegrityError(
      "unsupported",
      "Writes require a validated version-4 snapshot.",
    );
}
