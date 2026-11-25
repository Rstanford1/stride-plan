import type { LogicalActivityState, RecordedValues } from "./logical-activity";
import type { AppData, SessionStatus } from "./types";
import type { JournalEntry } from "./types";

export interface LogicalActivityCredit {
  logicalActivityId: string;
  assignedDate: string;
  plannedSessionId: string | null;
  recorded: RecordedValues;
  manualSourceIds: string[];
  fitActivityIds: string[];
}

/** One current credit per confirmed physical activity, irrespective of source count. */
export function logicalActivityCredits(
  state: LogicalActivityState | undefined,
): LogicalActivityCredit[] {
  return (state?.activities ?? []).map((activity) => {
    const current = activity.versions.at(-1);
    if (!current)
      throw new Error("Confirmed activity has no current revision.");
    return {
      logicalActivityId: activity.id,
      assignedDate: current.assignedDate,
      plannedSessionId: current.plannedSessionId,
      recorded: current.recorded,
      manualSourceIds: current.sources.flatMap((source) =>
        source.kind === "manual" ? [source.sourceId] : [],
      ),
      fitActivityIds: current.sources.flatMap((source) =>
        source.kind === "fit" ? [source.activityId] : [],
      ),
    };
  });
}

/** Raw allocations only; existing shoe balances need separately verified attribution. */
export function logicalShoeCredits(
  state: LogicalActivityState | undefined,
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const credit of logicalActivityCredits(state))
    for (const allocation of credit.recorded.shoeAllocations)
      totals.set(
        allocation.shoeId,
        (totals.get(allocation.shoeId) ?? 0) + allocation.distanceMiles,
      );
  return totals;
}

export function logicalSessionStatus(
  sessionId: string,
  original: SessionStatus,
  state: LogicalActivityState | undefined,
): SessionStatus {
  const linked = logicalActivityCredits(state).filter(
    (credit) => credit.plannedSessionId === sessionId,
  );
  if (linked.some((credit) => credit.recorded.outcome === "completed"))
    return "completed";
  if (linked.some((credit) => credit.recorded.outcome === "modified"))
    return "modified";
  return original;
}

/** Current manual details are projected from the confirmed revision. */
export function journalForSession(
  data: AppData,
  sessionId: string,
): JournalEntry | undefined {
  for (const activity of data.logicalActivities?.activities ?? []) {
    const version = activity.versions.at(-1);
    if (!version || version.plannedSessionId !== sessionId) continue;
    if (version.recorded.manualEntry) return version.recorded.manualEntry;
    const source = version.sources.find((item) => item.kind === "manual");
    if (source?.kind === "manual") return source.original;
  }
  return data.journals.find((entry) => entry.sessionId === sessionId);
}

/** Keep historic shoe totals untouched when their prior attribution is unknown. */
export function projectShoeMileage(data: AppData): {
  totals: Map<string, number>;
  unresolved: string[];
} {
  const totals = new Map(
    data.shoes.map((shoe) => [shoe.id, shoe.mileageMiles]),
  );
  const unresolved: string[] = [];
  const remainingBaseline = new Map(totals);
  for (const credit of logicalActivityCredits(data.logicalActivities)) {
    const activity = data.logicalActivities?.activities.find(
      (item) => item.id === credit.logicalActivityId,
    );
    const sources = activity?.versions.at(-1)?.sources ?? [];
    const deductions = new Map<string, number>();
    let uncertain = false;
    for (const source of sources) {
      if (source.kind !== "manual") continue;
      const journal = data.journals.find(
        (entry) => entry.id === source.sourceId,
      );
      if (!journal?.shoeId) continue;
      if (source.legacyShoeCredit === undefined) {
        uncertain = true;
        break;
      }
      if (source.legacyShoeCredit) {
        if (
          source.legacyShoeCredit.shoeId !== journal.shoeId ||
          source.legacyShoeCredit.distanceMiles !== journal.actualDistanceMiles
        ) {
          uncertain = true;
          break;
        }
        deductions.set(
          journal.shoeId,
          (deductions.get(journal.shoeId) ?? 0) +
            source.legacyShoeCredit.distanceMiles,
        );
      }
    }
    if (
      uncertain ||
      [...deductions].some(
        ([id, miles]) => (remainingBaseline.get(id) ?? 0) < miles,
      )
    ) {
      unresolved.push(credit.logicalActivityId);
      continue;
    }
    for (const [id, miles] of deductions) {
      totals.set(id, totals.get(id)! - miles);
      remainingBaseline.set(id, remainingBaseline.get(id)! - miles);
    }
    for (const allocation of credit.recorded.shoeAllocations)
      totals.set(
        allocation.shoeId,
        (totals.get(allocation.shoeId) ?? 0) + allocation.distanceMiles,
      );
  }
  return { totals, unresolved };
}
