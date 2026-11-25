import type { AppData } from "../domain/types";
import { createInitialData } from "../domain/seed";
import { upgradeAppData } from "../domain/app-data";
import {
  DataIntegrityError,
  parseSnapshotJson,
  storageError,
  validateCurrentSnapshot,
  validateSnapshot,
} from "../domain/snapshot-validation";
import { inspectLegacyRestore } from "./restore";
import { createFitSourceStore, type FitSourceStore } from "./fit-source-store";
import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";
import {
  applyConfirmation,
  applyCorrection,
  commandFingerprint,
  type ConfirmationCommand,
  type ConfirmationReceipt,
  type CorrectionCommand,
  type LogicalActivityState,
} from "../domain/logical-activity";
import type { DurableConfirmationResult } from "./logical-activity-service";

export const STORAGE_KEY = "stride-plan:data:v1";
/** Candidate-only rejection: the active repository has not been invalidated. */
export class RestoreInputError extends DataIntegrityError {
  constructor(error: unknown) {
    const failure = storageError(error);
    super(failure.kind, failure.message);
    this.name = "RestoreInputError";
  }
}
export interface AppRepository {
  load(): Promise<AppData>;
  save(data: AppData): Promise<void>;
  confirmLogicalActivity?(
    command: ConfirmationCommand,
  ): Promise<{ result: DurableConfirmationResult; data: AppData }>;
  correctLogicalActivity?(
    command: CorrectionCommand,
  ): Promise<{ result: DurableConfirmationResult; data: AppData }>;
  restore?(raw: string): Promise<AppData>;
  activate?(input: {
    before: AppData;
    after: AppData;
    bytes: Uint8Array;
    sourceHash: string;
    validatorFingerprint: string;
    effectiveDate: string;
    activationId: string;
  }): Promise<void>;
  inspectActive?(): Promise<{
    activationId: string;
    sourceBytes: Uint8Array;
    effectiveDate: string;
  } | null>;
}

/** One canonical snapshot, immutable recovery/staging copies, atomic publication. */
abstract class SnapshotRepository implements AppRepository {
  state:
    | "unresolved"
    | "empty"
    | "valid"
    | "unsupported"
    | "corrupted"
    | "inaccessible" = "unresolved";
  protected expected: string | null = null;
  constructor(private readonly sources: FitSourceStore) {}
  protected abstract read(): Promise<string | null>;
  protected abstract copy(raw: string, purpose: string): Promise<void>;
  protected abstract commit(
    before: string | null,
    after: string | null,
    replacement?: boolean,
  ): Promise<void>;
  protected async compatible(): Promise<void> {}
  protected async assertReplacementAllowed(): Promise<void> {}
  protected async beforeLogicalUpgrade(raw: string): Promise<void> {
    await this.copy(raw, "before-confirmed-activity");
  }
  protected async commitLogical(
    before: string,
    after: string,
  ): Promise<ConfirmationReceipt | null> {
    await this.commit(before, after);
    return null;
  }

  async load(): Promise<AppData> {
    this.state = "unresolved";
    try {
      await this.compatible();
      const raw = await this.read();
      this.expected = raw;
      if (raw === null) {
        const initial = createInitialData();
        await this.publish(JSON.stringify(initial));
        this.state = "empty";
        return initial;
      }
      const parsed = parseSnapshotJson(raw);
      validateSnapshot(parsed);
      // Preserve exact stored bytes before running any historical adapter.
      if (
        (parsed as AppData).schemaVersion !== 4 &&
        (parsed as AppData).schemaVersion !== 5 &&
        (parsed as AppData).schemaVersion !== 7
      )
        await this.copy(raw, "before-migration");
      const data = upgradeAppData(parsed);
      validateCurrentSnapshot(data);
      if (data !== parsed) {
        const staged = JSON.stringify(data);
        await this.copy(staged, "migration-stage");
        await this.publish(staged);
      }
      this.state = "valid";
      return data;
    } catch (error) {
      throw this.lock(error);
    }
  }
  protected lock(error: unknown): DataIntegrityError {
    const failure = storageError(error);
    this.state = failure.kind;
    return failure;
  }
  private assertWritable() {
    if (this.state !== "valid" && this.state !== "empty")
      throw new DataIntegrityError(
        "inaccessible",
        "Writes are disabled until saved-state integrity is resolved. Retry loading first.",
      );
  }
  protected async assertCurrent() {
    await this.compatible();
    if ((await this.read()) !== this.expected)
      throw new DataIntegrityError(
        "inaccessible",
        "Saved data changed in another window. Reload before making changes.",
      );
  }
  private async publish(after: string, replacement = false) {
    const before = this.expected;
    try {
      await this.commit(before, after, replacement);
      if ((await this.read()) !== after)
        throw new Error("Persistence verification failed");
      this.expected = after;
    } catch (error) {
      // A lost acknowledgement may follow a successful atomic commit. Only undo
      // our exact staged bytes; never overwrite a concurrent writer's snapshot.
      try {
        await this.commit(after, before, replacement);
      } catch {
        /* Safety copy remains; fail closed. */
      }
      throw error;
    }
  }
  async save(data: AppData): Promise<void> {
    this.assertWritable();
    try {
      validateCurrentSnapshot(data);
      await this.assertCurrent();
      await this.publish(JSON.stringify(data));
      this.state = "valid";
    } catch (error) {
      throw this.lock(error);
    }
  }
  async confirmLogicalActivity(
    command: ConfirmationCommand,
  ): Promise<{ result: DurableConfirmationResult; data: AppData }> {
    return this.changeLogicalActivity(command);
  }
  async correctLogicalActivity(
    command: CorrectionCommand,
  ): Promise<{ result: DurableConfirmationResult; data: AppData }> {
    return this.changeLogicalActivity(command);
  }
  private async changeLogicalActivity(
    command: ConfirmationCommand | CorrectionCommand,
  ): Promise<{ result: DurableConfirmationResult; data: AppData }> {
    this.assertWritable();
    await this.compatible();
    const raw = await this.read();
    if (raw === null)
      throw new DataIntegrityError(
        "inaccessible",
        "No saved snapshot is available.",
      );
    const parsed = parseSnapshotJson(raw) as AppData;
    validateCurrentSnapshot(parsed);
    const existing = parsed.logicalActivities?.commands.find(
      (item) => item.id === command.commandId,
    );
    if (existing) {
      if (existing.fingerprint !== commandFingerprint(command))
        throw new Error("Command ID was already used for a different request.");
      this.expected = raw;
      return {
        result: { status: "confirmed", receipt: existing.receipt },
        data: parsed,
      };
    }
    if (raw !== this.expected)
      throw new DataIntegrityError(
        "inaccessible",
        "Saved data changed in another window. Reload before confirming.",
      );
    const logical: LogicalActivityState = parsed.logicalActivities ?? {
      activities: [],
      commands: [],
    };
    const now = new Date().toISOString();
    const candidate =
      "eventId" in command
        ? applyConfirmation(logical, command, now)
        : {
            status: "confirmed" as const,
            ...applyCorrection(logical, command, now),
          };
    if (candidate.status !== "confirmed")
      return { result: candidate, data: parsed };
    const next: AppData = {
      ...parsed,
      schemaVersion: 7,
      logicalActivities: candidate.state,
    };
    validateCurrentSnapshot(next);
    const after = JSON.stringify(next);
    if (parsed.schemaVersion !== 7) await this.beforeLogicalUpgrade(raw);
    const nativeReceipt = await this.commitLogical(raw, after);
    if (
      nativeReceipt &&
      (nativeReceipt.commandId !== candidate.receipt.commandId ||
        nativeReceipt.logicalActivityId !==
          candidate.receipt.logicalActivityId ||
        nativeReceipt.confirmationEventId !==
          candidate.receipt.confirmationEventId ||
        nativeReceipt.confirmedAt !== candidate.receipt.confirmedAt ||
        nativeReceipt.committedRevision !== candidate.receipt.committedRevision)
    )
      throw new DataIntegrityError(
        "corrupted",
        "The committed activity receipt could not be verified.",
      );
    const persisted = await this.read();
    if (persisted !== after)
      throw new DataIntegrityError(
        "inaccessible",
        "The confirmation could not be verified. Retry the same command.",
      );
    this.expected = persisted;
    this.state = "valid";
    return {
      result: { status: "confirmed", receipt: candidate.receipt },
      data: next,
    };
  }
  async restore(raw: string): Promise<AppData> {
    this.assertWritable();
    // Invalid candidates do not invalidate the existing valid store.
    let preview;
    try {
      if (this.expected && JSON.parse(this.expected).schemaVersion === 7)
        throw new DataIntegrityError(
          "unsupported",
          "Legacy restore cannot replace confirmed activity history. Recover a complete compatible database instead.",
        );
      await this.assertReplacementAllowed();
      preview = await inspectLegacyRestore(raw, this.sources);
      if (preview.missingSources.length)
        throw new DataIntegrityError(
          "corrupted",
          "Restore blocked: original FIT files are missing or cannot be verified. Current data is unchanged.",
        );
    } catch (error) {
      throw new RestoreInputError(error);
    }
    try {
      await this.assertCurrent();
      if (this.expected === null)
        throw new Error("No durable current snapshot");
      await this.copy(this.expected, "before-restore");
      // Keep the uploaded bytes too, before converting historical versions.
      await this.copy(raw, "restore-input");
      const staged = JSON.stringify(preview.data);
      await this.copy(staged, "restore-stage");
      validateCurrentSnapshot(parseSnapshotJson(staged) as AppData);
      await this.assertCurrent();
      await this.publish(staged, true);
      return preview.data;
    } catch (error) {
      if (error instanceof RestoreInputError) throw error;
      throw this.lock(error);
    }
  }
}

export class BrowserRepository extends SnapshotRepository {
  constructor(
    private readonly storage:
      | Pick<Storage, "getItem" | "setItem" | "removeItem">
      | (() => Storage) = () => window.localStorage,
    sources: FitSourceStore = createFitSourceStore(),
  ) {
    super(sources);
  }
  private get store() {
    return typeof this.storage === "function" ? this.storage() : this.storage;
  }
  protected async read() {
    const raw = this.store.getItem(STORAGE_KEY);
    if (
      raw === null &&
      this.store.getItem(`${STORAGE_KEY}:recovery-present`) !== null
    )
      throw new DataIntegrityError(
        "corrupted",
        "The active snapshot is missing but recovery copies exist. Recover a saved copy before continuing; no demo data was created.",
      );
    return raw;
  }
  protected async copy(raw: string, purpose: string) {
    const key = `${STORAGE_KEY}:${purpose}:${crypto.randomUUID()}`;
    this.store.setItem(key, raw);
    if (this.store.getItem(key) !== raw)
      throw new Error("Safety copy verification failed");
    this.store.setItem(`${STORAGE_KEY}:recovery-present`, key);
    if (this.store.getItem(`${STORAGE_KEY}:recovery-present`) !== key)
      throw new Error("Recovery marker verification failed");
  }
  protected async commit(before: string | null, after: string | null) {
    // Synchronous localStorage operations: no await between check and atomic set.
    if (this.store.getItem(STORAGE_KEY) !== before)
      throw new Error("Stale snapshot");
    if (after === null) this.store.removeItem(STORAGE_KEY);
    else this.store.setItem(STORAGE_KEY, after);
  }
}

export type SnapshotDatabase = Pick<Database, "select" | "execute">;
export class SqliteRepository extends SnapshotRepository {
  private database?: Promise<SnapshotDatabase>;
  constructor(
    private readonly open: () => Promise<SnapshotDatabase> = () =>
      Database.load("sqlite:stride-plan.db"),
    sources: FitSourceStore = createFitSourceStore(),
  ) {
    super(sources);
  }
  private db() {
    return (this.database ??= this.open().catch((error) => {
      this.database = undefined;
      throw error;
    }));
  }
  // The native transaction creates and verifies a complete SQLite safety copy.
  protected async beforeLogicalUpgrade(): Promise<void> {}
  protected async commitLogical(
    before: string,
    after: string,
  ): Promise<ConfirmationReceipt | null> {
    if (!("__TAURI_INTERNALS__" in globalThis))
      throw new DataIntegrityError(
        "unsupported",
        "Durable activity confirmation requires the Windows app.",
      );
    return invoke<ConfirmationReceipt>("save_logical_activity", {
      request: { contractVersion: 1, before, after },
    });
  }
  async inspectActive(): Promise<{
    activationId: string;
    sourceBytes: Uint8Array;
    effectiveDate: string;
  } | null> {
    if (!("__TAURI_INTERNALS__" in globalThis)) return null;
    const result = await invoke<{
      activationId: string | null;
      sourceBytes: number[] | null;
      effectiveDate: string | null;
    }>("inspect_active_plan", { request: { contractVersion: 1 } });
    return result.activationId && result.sourceBytes && result.effectiveDate
      ? {
          activationId: result.activationId,
          sourceBytes: Uint8Array.from(result.sourceBytes),
          effectiveDate: result.effectiveDate,
        }
      : null;
  }
  async activate(input: {
    before: AppData;
    after: AppData;
    bytes: Uint8Array;
    sourceHash: string;
    validatorFingerprint: string;
    effectiveDate: string;
    activationId: string;
  }): Promise<void> {
    if (!("__TAURI_INTERNALS__" in globalThis))
      throw new DataIntegrityError(
        "unsupported",
        "Plan activation requires the Windows app.",
      );
    validateCurrentSnapshot(input.before);
    validateCurrentSnapshot(input.after);
    await this.assertCurrent();
    if (this.expected !== JSON.stringify(input.before))
      throw new DataIntegrityError(
        "inaccessible",
        "Saved data changed before activation. Reload and review the impact again.",
      );
    try {
      await invoke("activate_training_plan", {
        request: {
          contractVersion: 1,
          activationId: input.activationId,
          before: this.expected,
          after: JSON.stringify(input.after),
          sourceBytes: Array.from(input.bytes),
          sourceHash: input.sourceHash,
          validatorFingerprint: input.validatorFingerprint,
          effectiveDate: input.effectiveDate,
        },
      });
      const stored = await this.read();
      if (stored !== JSON.stringify(input.after))
        throw new Error(
          "Activation acknowledgement could not be verified. Reload saved data.",
        );
      this.expected = stored;
    } catch (error) {
      throw this.lock(error);
    }
  }
  protected async assertReplacementAllowed() {
    if (!("__TAURI_INTERNALS__" in globalThis)) return;
    if (await this.inspectActive())
      throw new DataIntegrityError(
        "unsupported",
        "Legacy restore and reset are unavailable after plan activation because they omit immutable plan sources.",
      );
    const result = await invoke<{ draft: unknown }>("inspect_plan_draft", {
      request: { contractVersion: 1 },
    });
    if (result.draft !== null)
      throw new DataIntegrityError(
        "unsupported",
        "Legacy restore and reset are blocked while a native draft exists. Export draft recovery separately.",
      );
  }
  protected async compatible() {
    const nativeDraftAware = "__TAURI_INTERNALS__" in globalThis;
    if (nativeDraftAware) {
      // Native inspection checks the exact T05 schema and legacy ledger before
      // broad SQL-plugin access can initialize or modify the snapshot.
      await invoke("inspect_plan_draft", { request: { contractVersion: 1 } });
    }
    const db = await this.db();
    if (nativeDraftAware) {
      const version = await db.select<{ user_version: number }[]>(
        "PRAGMA user_version",
      );
      if (version[0]?.user_version === 5) await this.inspectActive();
    }
    const tables = await db.select<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    );
    const known = new Set([
      "app_state",
      "_sqlx_migrations",
      "snapshot_recovery",
      "planned_sessions",
      "session_revisions",
      "activities",
      "activity_laps",
      "journal_entries",
      "import_sources",
      "shoes",
      ...(nativeDraftAware
        ? [
            "plan_draft_sources",
            "plan_drafts",
            "plan_draft_validation",
            "active_plan_records",
          ]
        : []),
    ]);
    for (const { name } of tables) {
      if (name.startsWith("sqlite_")) continue;
      if (!known.has(name))
        throw new DataIntegrityError(
          "unsupported",
          "This database contains newer native tables. Open it with a compatible application; legacy JSON cannot replace it.",
        );
      if (["app_state", "_sqlx_migrations", "snapshot_recovery"].includes(name))
        continue;
      if (
        nativeDraftAware &&
        [
          "plan_draft_sources",
          "plan_drafts",
          "plan_draft_validation",
          "active_plan_records",
        ].includes(name)
      )
        continue;
      const rows = await db.select<{ count: number }[]>(
        `SELECT COUNT(*) AS count FROM "${name}"`,
      );
      if (rows[0].count > 0)
        throw new DataIntegrityError(
          "unsupported",
          "Native records exist outside the legacy snapshot. This build cannot safely replace or migrate them.",
        );
    }
    if (tables.some((x) => x.name === "_sqlx_migrations")) {
      const rows = await db.select<{ version: number }[]>(
        "SELECT version FROM _sqlx_migrations WHERE version > 2",
      );
      if (rows.length)
        throw new DataIntegrityError(
          "unsupported",
          "This database uses a newer native schema. Open it with a compatible application.",
        );
    }
  }
  protected async read() {
    const database = await this.db();
    const tables = await database.select<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    );
    if (!tables.some((table) => table.name === "app_state")) {
      if (tables.length)
        throw new DataIntegrityError(
          "corrupted",
          "The snapshot table is missing from an existing database. No data was replaced.",
        );
      return null;
    }
    const rows = await (
      await this.db()
    ).select<{ payload: string }[]>(
      "SELECT payload FROM app_state WHERE id = 1",
    );
    if (!rows.length)
      throw new DataIntegrityError(
        "corrupted",
        "The active snapshot is missing from an existing database. Recover the saved data before continuing; no demo data was created.",
      );
    if (typeof rows[0].payload !== "string")
      throw new DataIntegrityError(
        "corrupted",
        "The saved snapshot row has an invalid payload. No data was replaced.",
      );
    return rows[0].payload;
  }
  protected async copy(raw: string, purpose: string) {
    const db = await this.db();
    await db.execute(
      "CREATE TABLE IF NOT EXISTS snapshot_recovery (id TEXT PRIMARY KEY, purpose TEXT NOT NULL, payload TEXT NOT NULL)",
    );
    const id = crypto.randomUUID();
    await db.execute(
      "INSERT INTO snapshot_recovery (id, purpose, payload) VALUES ($1, $2, $3)",
      [id, purpose, raw],
    );
    const rows = await db.select<{ payload: string }[]>(
      "SELECT payload FROM snapshot_recovery WHERE id = $1",
      [id],
    );
    if (rows[0]?.payload !== raw)
      throw new Error("Safety copy verification failed");
  }
  protected async commit(
    before: string | null,
    after: string | null,
    replacement = false,
  ) {
    if (replacement && "__TAURI_INTERNALS__" in globalThis) {
      if (before === null || after === null)
        throw new Error("Replacement requires durable snapshots");
      try {
        await invoke("replace_legacy_snapshot", {
          request: { contractVersion: 1, before, after },
        });
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "legacy_blocked"
        )
          throw new RestoreInputError(
            new DataIntegrityError(
              "unsupported",
              "Legacy restore and reset are blocked while a native draft exists.",
            ),
          );
        throw error;
      }
      return;
    }
    if (
      "__TAURI_INTERNALS__" in globalThis &&
      ((before !== null && [5, 7].includes(JSON.parse(before).schemaVersion)) ||
        (after !== null && [5, 7].includes(JSON.parse(after).schemaVersion)))
    ) {
      if (
        before === null ||
        after === null ||
        ![5, 7].includes(JSON.parse(before).schemaVersion) ||
        JSON.parse(before).schemaVersion !== JSON.parse(after).schemaVersion
      )
        throw new DataIntegrityError(
          "unsupported",
          "Protected snapshots change only through guarded native commands.",
        );
      await invoke("save_active_snapshot", {
        request: { contractVersion: 1, before, after },
      });
      return;
    }
    const db = await this.db();
    if (before === null && after !== null) {
      await this.compatible();
      await db.execute(
        "CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL, updated_at TEXT NOT NULL)",
      );
    }
    // A single SQL statement is atomic across the plugin's connection pool.
    // Do not issue BEGIN/COMMIT separately: they may use different connections.
    const result =
      after === null
        ? await db.execute(
            "DELETE FROM app_state WHERE id = 1 AND payload = $1",
            [before],
          )
        : before === null
          ? await db.execute(
              "INSERT INTO app_state (id, payload, updated_at) VALUES (1, $1, $2) ON CONFLICT(id) DO NOTHING",
              [after, new Date().toISOString()],
            )
          : await db.execute(
              "UPDATE app_state SET payload = $1, updated_at = $2 WHERE id = 1 AND payload = $3",
              [after, new Date().toISOString(), before],
            );
    if (result.rowsAffected !== 1)
      throw new DataIntegrityError(
        "inaccessible",
        "Saved data changed during persistence. Reload before making changes.",
      );
  }
}

export class SerializedRepository implements AppRepository {
  private queue: Promise<unknown> = Promise.resolve();
  private logical: LogicalActivityState | undefined;
  constructor(private readonly repository: AppRepository) {}
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => undefined);
    return result;
  }
  load() {
    return this.enqueue(async () => {
      const data = await this.repository.load();
      this.logical = data.logicalActivities
        ? structuredClone(data.logicalActivities)
        : undefined;
      return data;
    });
  }
  save(data: AppData) {
    const snapshot = structuredClone(data);
    return this.enqueue(() =>
      this.repository.save(
        this.logical
          ? {
              ...snapshot,
              schemaVersion: 7,
              logicalActivities: structuredClone(this.logical),
            }
          : snapshot,
      ),
    );
  }
  confirmLogicalActivity(command: ConfirmationCommand) {
    const request = structuredClone(command);
    return this.enqueue(async () => {
      if (!this.repository.confirmLogicalActivity)
        throw new DataIntegrityError(
          "unsupported",
          "Durable activity confirmation is unavailable.",
        );
      const result = await this.repository.confirmLogicalActivity(request);
      if (result.data.logicalActivities)
        this.logical = structuredClone(result.data.logicalActivities);
      return result;
    });
  }
  correctLogicalActivity(command: CorrectionCommand) {
    const request = structuredClone(command);
    return this.enqueue(async () => {
      if (!this.repository.correctLogicalActivity)
        throw new DataIntegrityError(
          "unsupported",
          "Durable activity correction is unavailable.",
        );
      const result = await this.repository.correctLogicalActivity(request);
      if (result.data.logicalActivities)
        this.logical = structuredClone(result.data.logicalActivities);
      return result;
    });
  }
  restore(raw: string) {
    return this.enqueue(() => {
      if (!this.repository.restore)
        throw new DataIntegrityError(
          "unsupported",
          "Safe restore is unavailable for this repository.",
        );
      return this.repository.restore(raw);
    });
  }
  activate(input: {
    before: AppData;
    after: AppData;
    bytes: Uint8Array;
    sourceHash: string;
    validatorFingerprint: string;
    effectiveDate: string;
    activationId: string;
  }) {
    return this.enqueue(() => {
      if (!this.repository.activate)
        throw new DataIntegrityError(
          "unsupported",
          "Plan activation requires the Windows app.",
        );
      return this.repository.activate(input);
    });
  }
  inspectActive() {
    return this.enqueue(
      () => this.repository.inspectActive?.() ?? Promise.resolve(null),
    );
  }
}
export function createRepository(): AppRepository {
  return new SerializedRepository(
    "__TAURI_INTERNALS__" in window
      ? new SqliteRepository()
      : new BrowserRepository(),
  );
}
