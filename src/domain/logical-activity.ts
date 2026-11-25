/** Source facts are evidence; a link never rewrites an original record. */
export type ActivityEvidence =
  | {
      kind: "manual";
      sourceId: string;
      occurredAt: string | null;
      localDate: string | null;
      timezone: string | null;
    }
  | {
      kind: "fit";
      sourceId: string;
      activityId: string;
      sourceHash: string;
      occurredAt: string | null;
      localDate: string | null;
      timezone: string | null;
    }
  | {
      kind: "garmin";
      providerId: string;
      sourceHash: string;
      occurredAt: string | null;
      localDate: string | null;
      timezone: string | null;
    };

export interface RecordedValues {
  distanceMiles: number | null;
  durationSeconds: number | null;
  averageHr: number | null;
  outcome: "completed" | "modified" | "unplanned";
  note: string | null;
  shoeAllocations: { shoeId: string; distanceMiles: number }[];
}
export interface ActivityVersion {
  revision: number;
  assignedDate: string;
  plannedSessionId: string | null;
  sources: ActivityEvidence[];
  recorded: RecordedValues;
  reason: string;
  changedAt: string;
}
export interface ConfirmationReceipt {
  commandId: string;
  logicalActivityId: string;
  committedRevision: number;
  confirmationEventId: string;
  confirmedAt: string;
}
export interface LogicalActivity {
  id: string;
  confirmationState: "confirmed";
  confirmed: ConfirmationReceipt;
  versions: ActivityVersion[];
}
export interface ConfirmationCommand {
  commandId: string;
  activityId: string;
  eventId: string;
  expectedRevision: number | null;
  assignedDate: string;
  plannedSessionId: string | null;
  sources: ActivityEvidence[];
  recorded: RecordedValues;
  duplicateDecisions: {
    activityId: string;
    decision: "merge" | "keep-both" | "review-later";
  }[];
}
export interface ActivityCommandRecord {
  id: string;
  fingerprint: string;
  receipt: ConfirmationReceipt;
}
export interface CorrectionCommand {
  commandId: string;
  activityId: string;
  expectedRevision: number;
  assignedDate: string;
  plannedSessionId: string | null;
  recorded: RecordedValues;
  reason: string;
}
export interface LogicalActivityState {
  activities: LogicalActivity[];
  commands: ActivityCommandRecord[];
}
export type ConfirmationPreparation =
  | { status: "review-required"; candidates: string[] }
  | { status: "review-later" }
  | { status: "exact-duplicate"; activityId: string }
  | { status: "ready"; activityId: string; merged: boolean };

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export function commandFingerprint(
  command: ConfirmationCommand | CorrectionCommand,
): string {
  return stable(command);
}
function sourceKey(source: ActivityEvidence): string {
  if (source.kind === "manual") return `manual:${source.sourceId}`;
  if (source.kind === "fit")
    return `fit:${source.sourceHash}:${source.activityId}`;
  return `garmin:${source.providerId}`;
}
function current(activity: LogicalActivity): ActivityVersion {
  const version = activity.versions.at(-1);
  if (!version) throw new Error("Logical activity has no revision.");
  return version;
}
function possible(a: ActivityEvidence, b: ActivityEvidence): boolean {
  // Provider and FIT evidence can refer to the same original bytes even if
  // their recorded timestamps disagree. Never dismiss those as separate runs.
  if (
    a.kind !== "manual" &&
    b.kind !== "manual" &&
    a.sourceHash === b.sourceHash
  )
    return true;
  if (a.occurredAt && b.occurredAt) {
    const first = Date.parse(a.occurredAt),
      second = Date.parse(b.occurredAt);
    if (Number.isFinite(first) && Number.isFinite(second))
      return Math.abs(first - second) <= 86400000;
  }
  // Without reliable original times, do not rule out a match based on an assigned date.
  return true;
}
function validate(command: ConfirmationCommand) {
  if (
    !command.commandId ||
    !command.activityId ||
    !command.eventId ||
    !/^\d{4}-\d{2}-\d{2}$/.test(command.assignedDate) ||
    !command.sources.length
  )
    throw new Error("Incomplete confirmation request.");
  const parsedDate = new Date(`${command.assignedDate}T12:00:00Z`);
  if (
    !Number.isFinite(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== command.assignedDate
  )
    throw new Error("Invalid assigned training date.");
  for (const source of command.sources) {
    if (
      (source.kind === "manual" && !source.sourceId) ||
      (source.kind === "fit" &&
        (!source.sourceId ||
          !source.activityId ||
          !/^[a-f0-9]{64}$/.test(source.sourceHash))) ||
      (source.kind === "garmin" &&
        (!source.providerId || !/^[a-f0-9]{64}$/.test(source.sourceHash))) ||
      (source.occurredAt !== null &&
        !Number.isFinite(Date.parse(source.occurredAt)))
    )
      throw new Error("Invalid source evidence.");
  }
  if (new Set(command.sources.map(sourceKey)).size !== command.sources.length)
    throw new Error("Duplicate source identity.");
  const values = command.recorded;
  for (const number of [
    values.distanceMiles,
    values.durationSeconds,
    values.averageHr,
  ])
    if (number !== null && (!Number.isFinite(number) || number < 0))
      throw new Error("Invalid recorded value.");
  if (values.averageHr !== null && values.averageHr > 300)
    throw new Error("Invalid recorded heart rate.");
  if (
    new Set(values.shoeAllocations.map((item) => item.shoeId)).size !==
      values.shoeAllocations.length ||
    values.shoeAllocations.some(
      (item) =>
        !item.shoeId ||
        !Number.isFinite(item.distanceMiles) ||
        item.distanceMiles < 0,
    )
  )
    throw new Error("Invalid shoe allocations.");
  if (
    values.shoeAllocations.length &&
    (values.distanceMiles === null ||
      Math.abs(
        values.shoeAllocations.reduce(
          (sum, item) => sum + item.distanceMiles,
          0,
        ) - values.distanceMiles,
      ) > 1e-6)
  )
    throw new Error("Shoe allocations must equal the recorded distance.");
}
/** Conservative duplicate candidates. Evidence with unknown start times is never ruled out. */
export function prepareConfirmation(
  state: LogicalActivityState,
  command: ConfirmationCommand,
): ConfirmationPreparation {
  validate(command);
  const existing = state.activities.find(
    (activity) => activity.id === command.activityId,
  );
  const incoming = new Set(command.sources.map(sourceKey));
  const exact = state.activities.filter((activity) =>
    current(activity).sources.some((source) => incoming.has(sourceKey(source))),
  );
  if (exact.length > 1)
    throw new Error(
      "Source identities belong to different logical activities.",
    );
  if (exact.length === 1 && !existing) {
    const owned = new Set(current(exact[0]).sources.map(sourceKey));
    if (command.sources.every((source) => owned.has(sourceKey(source))))
      return { status: "exact-duplicate", activityId: exact[0].id };
  }
  if (exact.length === 1 && existing && exact[0].id !== command.activityId)
    throw new Error("Source already belongs to another activity.");
  const candidates = state.activities
    .filter(
      (activity) =>
        activity.id !== command.activityId &&
        (activity === exact[0] ||
          current(activity).sources.some((source) =>
            command.sources.some((other) => possible(source, other)),
          )),
    )
    .map((activity) => activity.id);
  const decisions = new Map(
    command.duplicateDecisions.map((item) => [item.activityId, item.decision]),
  );
  if (
    decisions.size !== command.duplicateDecisions.length ||
    [...decisions.keys()].some((id) => !candidates.includes(id)) ||
    command.duplicateDecisions.some(
      ({ decision }) =>
        !["merge", "keep-both", "review-later"].includes(decision),
    )
  )
    throw new Error("Invalid duplicate decisions.");
  const unresolved = candidates.filter((id) => !decisions.has(id));
  if (unresolved.length)
    return { status: "review-required", candidates: unresolved };
  if ([...decisions.values()].includes("review-later"))
    return { status: "review-later" };
  if (exact.length === 1 && decisions.get(exact[0].id) !== "merge")
    throw new Error(
      "A source identity cannot belong to two logical activities.",
    );
  const merged = [...decisions.entries()]
    .filter(([, decision]) => decision === "merge")
    .map(([id]) => id);
  if (merged.length > 1 || (merged.length && existing))
    throw new Error(
      "Multiple or conflicting merge targets need separate review.",
    );
  return {
    status: "ready",
    activityId: merged[0] ?? command.activityId,
    merged: merged.length > 0,
  };
}

export type ConfirmationResult =
  | { status: "review-required"; candidates: string[] }
  | { status: "review-later" }
  | { status: "exact-duplicate"; activityId: string }
  | {
      status: "confirmed";
      state: LogicalActivityState;
      receipt: ConfirmationReceipt;
    };

/** Pure candidate only. Callers must commit atomically before publishing a receipt. */
export function applyConfirmation(
  state: LogicalActivityState,
  command: ConfirmationCommand,
  committedAt: string,
): ConfirmationResult {
  const fingerprint = commandFingerprint(command);
  const priorCommand = state.commands.find(
    (item) => item.id === command.commandId,
  );
  if (priorCommand) {
    if (priorCommand.fingerprint !== fingerprint)
      throw new Error("Command ID was already used for a different request.");
    return { status: "confirmed", state, receipt: priorCommand.receipt };
  }
  if (!Number.isFinite(Date.parse(committedAt)))
    throw new Error("Invalid confirmation timestamp.");
  const preparation = prepareConfirmation(state, command);
  if (preparation.status !== "ready") return preparation;
  const existing = state.activities.find(
    (item) => item.id === preparation.activityId,
  );
  if (
    !existing &&
    state.activities.some(
      (item) => item.confirmed.confirmationEventId === command.eventId,
    )
  )
    throw new Error("Confirmation event ID is already in use.");
  if (
    (existing ? current(existing).revision : null) !== command.expectedRevision
  )
    throw new Error("Activity changed before confirmation.");
  if (existing && !preparation.merged)
    throw new Error("Use a correction command for an existing activity.");
  if (
    existing &&
    (current(existing).assignedDate !== command.assignedDate ||
      current(existing).plannedSessionId !== command.plannedSessionId ||
      stable(current(existing).recorded) !== stable(command.recorded))
  )
    throw new Error(
      "A merge cannot silently change recorded values, date or association.",
    );
  const previous = existing ? current(existing) : null;
  const sources = previous
    ? [
        ...previous.sources,
        ...command.sources.filter(
          (source) =>
            !previous.sources.some(
              (old) => sourceKey(old) === sourceKey(source),
            ),
        ),
      ]
    : command.sources;
  const revision = (previous?.revision ?? 0) + 1;
  const receipt: ConfirmationReceipt = {
    commandId: command.commandId,
    logicalActivityId: preparation.activityId,
    committedRevision: revision,
    confirmationEventId:
      existing?.confirmed.confirmationEventId ?? command.eventId,
    confirmedAt: existing?.confirmed.confirmedAt ?? committedAt,
  };
  const version: ActivityVersion = {
    revision,
    assignedDate: command.assignedDate,
    plannedSessionId: command.plannedSessionId,
    sources: structuredClone(sources),
    recorded: structuredClone(command.recorded),
    reason: preparation.merged ? "source association" : "confirmation",
    changedAt: committedAt,
  };
  const activity: LogicalActivity = existing
    ? { ...existing, versions: [...existing.versions, version] }
    : {
        id: command.activityId,
        confirmationState: "confirmed",
        confirmed: receipt,
        versions: [version],
      };
  return {
    status: "confirmed",
    state: {
      activities: [
        ...state.activities.filter((item) => item.id !== activity.id),
        activity,
      ],
      commands: [
        ...state.commands,
        { id: command.commandId, fingerprint, receipt },
      ],
    },
    receipt,
  };
}

export function confirmedDistance(state: LogicalActivityState): number | null {
  const values = state.activities.map(
    (activity) => current(activity).recorded.distanceMiles,
  );
  return values.some((value) => value === null)
    ? null
    : values.reduce<number>((sum, value) => sum + value!, 0);
}

/** Corrections retain the confirmation event, immutable evidence, and earlier versions. */
export function applyCorrection(
  state: LogicalActivityState,
  command: CorrectionCommand,
  changedAt: string,
): { state: LogicalActivityState; receipt: ConfirmationReceipt } {
  const fingerprint = commandFingerprint(command);
  const priorCommand = state.commands.find(
    (item) => item.id === command.commandId,
  );
  if (priorCommand) {
    if (priorCommand.fingerprint !== fingerprint)
      throw new Error("Command ID was already used for a different request.");
    return { state, receipt: priorCommand.receipt };
  }
  const activity = state.activities.find(
    (item) => item.id === command.activityId,
  );
  if (!activity || current(activity).revision !== command.expectedRevision)
    throw new Error("Activity changed before correction.");
  if (!command.reason.trim() || !Number.isFinite(Date.parse(changedAt)))
    throw new Error("Correction reason and timestamp are required.");
  const previous = current(activity);
  validate({
    commandId: command.commandId,
    activityId: command.activityId,
    eventId: activity.confirmed.confirmationEventId,
    expectedRevision: command.expectedRevision,
    assignedDate: command.assignedDate,
    plannedSessionId: command.plannedSessionId,
    sources: previous.sources,
    recorded: command.recorded,
    duplicateDecisions: [],
  });
  const revision = previous.revision + 1;
  const receipt: ConfirmationReceipt = {
    commandId: command.commandId,
    logicalActivityId: activity.id,
    committedRevision: revision,
    confirmationEventId: activity.confirmed.confirmationEventId,
    confirmedAt: activity.confirmed.confirmedAt,
  };
  const next: LogicalActivity = {
    ...activity,
    versions: [
      ...activity.versions,
      {
        revision,
        assignedDate: command.assignedDate,
        plannedSessionId: command.plannedSessionId,
        sources: structuredClone(previous.sources),
        recorded: structuredClone(command.recorded),
        reason: command.reason,
        changedAt,
      },
    ],
  };
  return {
    state: {
      activities: state.activities.map((item) =>
        item.id === activity.id ? next : item,
      ),
      commands: [
        ...state.commands,
        { id: command.commandId, fingerprint, receipt },
      ],
    },
    receipt,
  };
}
