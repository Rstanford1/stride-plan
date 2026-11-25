import type { LogicalActivityState, RecordedValues } from "./logical-activity";
import type { AppData, SessionStatus } from "./types";

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

/** Keep historic shoe totals untouched when their prior attribution is unknown. */
export function projectShoeMileage(data: AppData): {
  totals: Map<string, number>;
  unresolved: string[];
} {
  const totals = new Map(
    data.shoes.map((shoe) => [shoe.id, shoe.mileageMiles]),
  );
  const unresolved: string[] = [];
  for (const credit of logicalActivityCredits(data.logicalActivities)) {
    const historicShoeEntry = data.journals.some(
      (entry) => credit.manualSourceIds.includes(entry.id) && entry.shoeId,
    );
    if (historicShoeEntry) {
      unresolved.push(credit.logicalActivityId);
      continue;
    }
    for (const allocation of credit.recorded.shoeAllocations)
      totals.set(
        allocation.shoeId,
        (totals.get(allocation.shoeId) ?? 0) + allocation.distanceMiles,
      );
  }
  return { totals, unresolved };
}
