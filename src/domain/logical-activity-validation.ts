import { z } from "zod";
import type { LogicalActivityState } from "./logical-activity";
import { journalSchema } from "./journal-schema";

const id = z.string().min(1);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T12:00:00Z`);
    return (
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  });
const timestamp = z
  .string()
  .refine(
    (value) =>
      /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)),
  );
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const evidenceFields = {
  occurredAt: timestamp.nullable(),
  localDate: date.nullable(),
  timezone: z.string().min(1).nullable(),
};
const evidence = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("manual"),
      sourceId: id,
      original: journalSchema,
      legacyShoeCredit: z
        .object({
          shoeId: id,
          distanceMiles: z.number().finite().nonnegative(),
        })
        .strict()
        .nullable()
        .optional(),
      ...evidenceFields,
    })
    .strict(),
  z
    .object({
      kind: z.literal("fit"),
      sourceId: id,
      activityId: id,
      sourceHash: hash,
      ...evidenceFields,
    })
    .strict(),
  z
    .object({
      kind: z.literal("garmin"),
      providerId: id,
      sourceHash: hash,
      relatedSourceHashes: z.array(hash).min(1).optional(),
      ...evidenceFields,
    })
    .strict(),
]);
const recorded = z
  .object({
    distanceMiles: z.number().finite().nonnegative().nullable(),
    durationSeconds: z.number().finite().nonnegative().nullable(),
    averageHr: z.number().finite().nonnegative().max(300).nullable(),
    outcome: z.enum(["completed", "modified", "unplanned"]),
    note: z.string().nullable(),
    replacementDescription: z.string().optional(),
    shoeAllocations: z.array(
      z
        .object({
          shoeId: id,
          distanceMiles: z.number().finite().nonnegative(),
        })
        .strict(),
    ),
    manualEntry: journalSchema.optional(),
  })
  .strict()
  .refine((value) => {
    const ids = value.shoeAllocations.map((entry) => entry.shoeId);
    return (
      new Set(ids).size === ids.length &&
      (!ids.length ||
        (value.distanceMiles !== null &&
          Math.abs(
            value.shoeAllocations.reduce(
              (sum, entry) => sum + entry.distanceMiles,
              0,
            ) - value.distanceMiles,
          ) < 1e-6))
    );
  });
const receipt = z
  .object({
    commandId: id,
    logicalActivityId: id,
    committedRevision: z.number().int().positive(),
    confirmationEventId: id,
    confirmedAt: timestamp,
  })
  .strict();
const version = z
  .object({
    revision: z.number().int().positive(),
    assignedDate: date,
    plannedSessionId: id.nullable(),
    sources: z.array(evidence).min(1),
    recorded,
    reason: id,
    changedAt: timestamp,
    legacyDuplicateDecisions: z
      .array(
        z
          .object({
            candidateId: id,
            decision: z.enum(["merge", "keep-both", "review-later"]),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();
const duplicateDecision = z.enum(["merge", "keep-both", "review-later"]);
const confirmationCommand = z
  .object({
    commandId: id,
    activityId: id,
    eventId: id,
    expectedRevision: z.number().int().positive().nullable(),
    assignedDate: date,
    plannedSessionId: id.nullable(),
    sources: z.array(evidence).min(1),
    recorded,
    duplicateDecisions: z.array(
      z.object({ activityId: id, decision: duplicateDecision }).strict(),
    ),
    legacyDuplicateDecisions: z
      .array(
        z.object({ candidateId: id, decision: duplicateDecision }).strict(),
      )
      .optional(),
    mergeRecordedChoice: z.enum(["keep-existing", "use-incoming"]).optional(),
  })
  .strict();
export const logicalActivityStateSchema = z
  .object({
    activities: z.array(
      z
        .object({
          id,
          confirmationState: z.literal("confirmed"),
          confirmed: receipt,
          versions: z.array(version).min(1),
        })
        .strict(),
    ),
    commands: z.array(z.object({ id, fingerprint: id, receipt }).strict()),
    pending: z
      .array(
        z
          .object({ id, command: confirmationCommand, createdAt: timestamp })
          .strict(),
      )
      .optional(),
  })
  .strict();

function sourceKey(source: z.infer<typeof evidence>): string {
  if (source.kind === "manual") return `manual:${source.sourceId}`;
  if (source.kind === "fit")
    return `fit:${source.sourceHash}:${source.activityId}`;
  return `garmin:${source.providerId}`;
}
function sourcePreserved(
  old: z.infer<typeof evidence>,
  current: z.infer<typeof evidence> | undefined,
): boolean {
  if (!current) return false;
  if (old.kind !== "garmin" || current.kind !== "garmin")
    return JSON.stringify(old) === JSON.stringify(current);
  const { relatedSourceHashes: oldHashes, ...oldFacts } = old;
  const { relatedSourceHashes: newHashes, ...newFacts } = current;
  const oldAll = [old.sourceHash, ...(oldHashes ?? [])];
  const newAll = [current.sourceHash, ...(newHashes ?? [])];
  return (
    JSON.stringify(oldFacts) === JSON.stringify(newFacts) &&
    oldAll.every((hash) => newAll.includes(hash))
  );
}

/** Validate persisted records without rewriting or discarding their contents. */
export function validateLogicalActivityState(
  value: unknown,
): asserts value is LogicalActivityState {
  const result = logicalActivityStateSchema.safeParse(value);
  if (!result.success) throw new Error("Invalid logical activity snapshot.");
  const { activities, commands, pending = [] } = result.data;
  const owners = new Map<string, string>();
  const ids = new Set<string>();
  const events = new Set<string>();
  for (const activity of activities) {
    if (
      ids.has(activity.id) ||
      events.has(activity.confirmed.confirmationEventId) ||
      activity.confirmed.logicalActivityId !== activity.id ||
      activity.confirmed.committedRevision !== 1
    )
      throw new Error("Duplicate or invalid logical activity identity.");
    ids.add(activity.id);
    events.add(activity.confirmed.confirmationEventId);
    let previous = new Map<string, z.infer<typeof evidence>>();
    for (let index = 0; index < activity.versions.length; index++) {
      const item = activity.versions[index];
      if (item.revision !== index + 1)
        throw new Error("Invalid activity revision sequence.");
      const current = new Map(
        item.sources.map((source) => [sourceKey(source), source]),
      );
      for (const source of item.sources)
        if (source.kind === "manual" && source.original.id !== source.sourceId)
          throw new Error("Invalid manual source identity.");
      for (const source of item.sources)
        if (
          source.kind === "garmin" &&
          source.relatedSourceHashes &&
          (!source.relatedSourceHashes.includes(source.sourceHash) ||
            new Set(source.relatedSourceHashes).size !==
              source.relatedSourceHashes.length)
        )
          throw new Error("Invalid Garmin source identities.");
      if (
        item.recorded.manualEntry &&
        !item.sources.some(
          (source) =>
            source.kind === "manual" &&
            source.sourceId === item.recorded.manualEntry?.id,
        )
      )
        throw new Error("Missing manual source evidence.");
      if (
        current.size !== item.sources.length ||
        [...previous].some(
          ([key, source]) => !sourcePreserved(source, current.get(key)),
        )
      )
        throw new Error("Original source evidence was changed or removed.");
      previous = current;
    }
    for (const key of previous.keys()) {
      if (owners.has(key))
        throw new Error("A source belongs to more than one activity.");
      owners.set(key, activity.id);
    }
  }
  const commandIds = new Set<string>();
  for (const command of commands) {
    const activity = activities.find(
      (item) => item.id === command.receipt.logicalActivityId,
    );
    if (
      commandIds.has(command.id) ||
      command.id !== command.receipt.commandId ||
      !activity ||
      command.receipt.committedRevision > activity.versions.length ||
      command.receipt.confirmationEventId !==
        activity.confirmed.confirmationEventId ||
      command.receipt.confirmedAt !== activity.confirmed.confirmedAt
    )
      throw new Error("Invalid activity command receipt.");
    commandIds.add(command.id);
  }
  for (const activity of activities)
    if (
      !commands.some(
        (command) =>
          command.id === activity.confirmed.commandId &&
          JSON.stringify(command.receipt) ===
            JSON.stringify(activity.confirmed),
      )
    )
      throw new Error("Missing original confirmation receipt.");
  const pendingIds = new Set<string>();
  for (const item of pending) {
    if (
      item.id !== item.command.commandId ||
      pendingIds.has(item.id) ||
      commandIds.has(item.id)
    )
      throw new Error("Invalid pending activity identity.");
    pendingIds.add(item.id);
    const sourceIds = item.command.sources.map(sourceKey);
    if (
      new Set(sourceIds).size !== sourceIds.length ||
      item.command.sources.some(
        (source) =>
          source.kind === "manual" && source.sourceId !== source.original.id,
      )
    )
      throw new Error("Invalid pending source evidence.");
    for (const source of item.command.sources)
      if (
        source.kind === "garmin" &&
        source.relatedSourceHashes &&
        (!source.relatedSourceHashes.includes(source.sourceHash) ||
          new Set(source.relatedSourceHashes).size !==
            source.relatedSourceHashes.length)
      )
        throw new Error("Invalid pending Garmin source identities.");
    if (
      item.command.recorded.manualEntry &&
      !item.command.sources.some(
        (source) =>
          source.kind === "manual" &&
          source.sourceId === item.command.recorded.manualEntry?.id,
      )
    )
      throw new Error("Pending manual entry has no source evidence.");
  }
}
