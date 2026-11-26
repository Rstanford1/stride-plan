import type { ConfirmationCommand } from "../domain/logical-activity";
import { logicalActivityCredits } from "../domain/logical-activity-accounting";
import type { AppData } from "../domain/types";

export interface LegacyCandidate {
  id: string;
  date: string;
  label: string;
}

/** Existing records remain separate evidence until the owner chooses a relationship. */
export function legacyCandidates(
  data: AppData,
  command: ConfirmationCommand,
): LegacyCandidate[] {
  const credits = logicalActivityCredits(data.logicalActivities);
  const ownedManual = new Set(
    credits.flatMap((credit) => credit.manualSourceIds),
  );
  const ownedFit = new Set(credits.flatMap((credit) => credit.fitActivityIds));
  const days = command.sources.flatMap((source) => {
    const value = source.localDate ?? source.occurredAt?.slice(0, 10);
    return value ? [value] : [];
  });
  const close = (date: string) =>
    !days.length ||
    days.some(
      (day) =>
        Math.abs(
          Date.parse(`${day}T12:00:00Z`) - Date.parse(`${date}T12:00:00Z`),
        ) <= 86400000,
    );
  const candidates: LegacyCandidate[] = [];
  for (const journal of data.journals) {
    if (
      !ownedManual.has(journal.id) &&
      ((journal.sessionId === command.plannedSessionId &&
        !!journal.sessionId) ||
        close(journal.date))
    )
      candidates.push({
        id: `journal:${journal.id}`,
        date: journal.date,
        label: "Manual journal",
      });
  }
  for (const activity of data.activities) {
    if (ownedFit.has(activity.id) || activity.role === "unrelated") continue;
    const sameHash = command.sources.some(
      (source) =>
        source.kind !== "manual" &&
        (source.sourceHash === activity.sourceHash ||
          (source.kind === "garmin" &&
            source.relatedSourceHashes?.includes(activity.sourceHash))),
    );
    if (
      sameHash ||
      (activity.plannedSessionId === command.plannedSessionId &&
        !!activity.plannedSessionId) ||
      close(activity.occurredAt.slice(0, 10))
    )
      candidates.push({
        id: `activity:${activity.id}`,
        date: activity.occurredAt.slice(0, 10),
        label: "Imported activity",
      });
  }
  return candidates;
}

export function reviewLegacyCandidates(
  data: AppData,
  command: ConfirmationCommand,
):
  | { status: "ready" }
  | { status: "review-required"; candidates: string[] }
  | { status: "review-later" } {
  const candidates = legacyCandidates(data, command);
  const decisions = command.legacyDuplicateDecisions ?? [];
  const byId = new Map(
    decisions.map((item) => [item.candidateId, item.decision]),
  );
  if (
    byId.size !== decisions.length ||
    decisions.some(
      (item) =>
        !candidates.some((candidate) => candidate.id === item.candidateId) ||
        !["merge", "keep-both", "review-later"].includes(item.decision),
    )
  )
    throw new Error("Invalid legacy duplicate decisions.");
  const missing = candidates.filter((candidate) => !byId.has(candidate.id));
  if (missing.length)
    return {
      status: "review-required",
      candidates: missing.map((item) => `legacy:${item.id}`),
    };
  if (decisions.some((item) => item.decision === "review-later"))
    return { status: "review-later" };
  for (const candidate of candidates) {
    const [kind, ...parts] = candidate.id.split(":");
    const id = parts.join(":");
    const included = command.sources.some((source) =>
      kind === "journal"
        ? source.kind === "manual" && source.sourceId === id
        : source.kind === "fit" && source.activityId === id,
    );
    if (included && byId.get(candidate.id) !== "merge")
      throw new Error("The same source cannot be kept as two activities.");
    if (byId.get(candidate.id) === "merge" && !included)
      throw new Error(
        "Merging an older record requires its preserved source evidence.",
      );
    if (kind === "journal" && byId.get(candidate.id) === "merge") {
      const journal = data.journals.find((item) => item.id === id);
      const source = command.sources.find(
        (item) => item.kind === "manual" && item.sourceId === id,
      );
      if (journal?.shoeId && source?.kind === "manual") {
        if (source.legacyShoeCredit === undefined)
          throw new Error(
            "Choose whether the older run is already included in its shoe total.",
          );
        if (
          source.legacyShoeCredit &&
          (source.legacyShoeCredit.shoeId !== journal.shoeId ||
            source.legacyShoeCredit.distanceMiles !==
              journal.actualDistanceMiles ||
            (data.shoes.find((shoe) => shoe.id === journal.shoeId)
              ?.mileageMiles ?? 0) < source.legacyShoeCredit.distanceMiles)
        )
          throw new Error(
            "The older shoe attribution cannot be verified against the saved total.",
          );
      }
    }
  }
  return { status: "ready" };
}
