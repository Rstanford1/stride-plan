import {
  applyConfirmation,
  applyCorrection,
  type ConfirmationCommand,
  type ConfirmationPreparation,
  type ConfirmationReceipt,
  type CorrectionCommand,
  type LogicalActivityState,
} from "../domain/logical-activity";

/**
 * The adapter owns the complete canonical snapshot. compareAndCommit must only
 * resolve true after a durable atomic commit, and false if `before` is stale.
 * It must never replace other fields from an earlier snapshot.
 */
export interface AtomicActivityStore<T> {
  read(): Promise<T>;
  compareAndCommit(before: T, after: T): Promise<boolean>;
  activities(snapshot: T): LogicalActivityState;
  withActivities(snapshot: T, activities: LogicalActivityState): T;
}

export type DurableConfirmationResult =
  | Exclude<ConfirmationPreparation, { status: "ready" }>
  | { status: "confirmed"; receipt: ConfirmationReceipt };

/**
 * This service does not provide a storage backend. A caller must supply an
 * adapter that fulfils the atomic and durable contract above.
 */
export class LogicalActivityService<T> {
  constructor(
    private readonly store: AtomicActivityStore<T>,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async confirm(
    command: ConfirmationCommand,
  ): Promise<DurableConfirmationResult> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const before = await this.store.read();
      const activities = this.store.activities(before);
      const result = applyConfirmation(activities, command, this.now());
      if (result.status !== "confirmed") return result;
      // An idempotent retry is already durable; do not publish a second change.
      if (result.state === activities)
        return { status: "confirmed", receipt: result.receipt };
      const after = this.store.withActivities(before, result.state);
      if (await this.store.compareAndCommit(before, after))
        return { status: "confirmed", receipt: result.receipt };
    }
    throw new Error(
      "Activity confirmation conflicted repeatedly. Retry the same command.",
    );
  }

  async correct(command: CorrectionCommand): Promise<ConfirmationReceipt> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const before = await this.store.read();
      const activities = this.store.activities(before);
      const result = applyCorrection(activities, command, this.now());
      if (result.state === activities) return result.receipt;
      const after = this.store.withActivities(before, result.state);
      if (await this.store.compareAndCommit(before, after))
        return result.receipt;
    }
    throw new Error(
      "Activity correction conflicted repeatedly. Retry the same command.",
    );
  }
}
