import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";
import { parseTrainingPlan } from "../domain/training-plan";
import {
  parseSnapshotJson,
  validateCurrentSnapshot,
} from "../domain/snapshot-validation";
import type { AppData } from "../domain/types";
import type { PlanValidationResult } from "../domain/training-plan-contract";
import { sha256Hex } from "../domain/fit-hash";

export const PLAN_SOURCE_LIMIT = 8 * 1024 * 1024;
export const PLAN_RECOVERY_LIMIT = 16 * 1024 * 1024;
const hashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const idSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
export const draftRecordSchema = z
  .object({
    sourceId: z.string(),
    sourceHash: hashSchema,
    byteLength: z.number().int().min(1).max(PLAN_SOURCE_LIMIT),
    originalFileName: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[^\x00-\x1f\x7f/\\:]+$/),
    importedAt: z.string().datetime(),
    draftId: z.string(),
    planId: idSchema,
    versionId: idSchema,
    parentVersionId: idSchema.nullable(),
    revision: z.literal(1),
    state: z.literal("draft"),
    createdAt: z.string().datetime(),
    schemaVersion: z.enum(["1.1", "1.2"]),
    validatorVersion: z.enum(["t01-1", "t081-1"]),
    validatorFingerprint: hashSchema,
    diagnosticsJson: z.string().max(1024 * 1024),
    diagnosticsHash: hashSchema,
  })
  .strict();
export type DraftRecord = z.infer<typeof draftRecordSchema>;
export interface PlanPreview {
  bytes: Uint8Array;
  fileName: string;
  sourceHash: string;
  validation: PlanValidationResult;
}
export interface NativeSaveRequest {
  contractVersion: 1;
  bytes: number[];
  originalFileName: string;
  sourceHash: string;
  diagnosticsJson: string;
  validatorFingerprint: string;
  expectedDraftId: string | null;
  expectedRevision: number | null;
  expectedSnapshot: string;
}
export interface SavedDraft {
  record: DraftRecord;
  preview: PlanPreview;
}
export interface DraftInspection {
  contractVersion: 1;
  snapshot: string | null;
  draft: DraftRecord | null;
}
export interface DraftStore {
  inspect(): Promise<DraftInspection>;
  save(preview: PlanPreview, expected: DraftRecord | null): Promise<SavedDraft>;
  read(): Promise<SavedDraft | null>;
  exportRecovery(): Promise<string>;
  saveRecovery(): Promise<RecoverySaveResult>;
  recover(text: string): Promise<SavedDraft>;
}
export type RecoverySaveResult =
  | { contractVersion: 1; status: "cancelled" }
  | { contractVersion: 1; status: "saved"; path: string };
const messages = {
  unsupported:
    "Unsupported draft, validator or database version. No data was replaced.",
  conflict:
    "A different draft or revision is already saved. Nothing was overwritten.",
  invalid: "The plan or draft recovery data is invalid. No draft was saved.",
  corrupt: "Saved draft records or original source failed verification.",
  source: "The original plan source is missing, corrupt or inaccessible.",
  backup:
    "The pre-migration safety copy could not be verified. Migration stopped.",
  legacy_blocked:
    "Legacy restore and reset are blocked while a native draft exists.",
  storage: "Draft storage could not complete the operation. Retry is safe.",
  export_write:
    "Recovery could not be saved and verified. Check folder permissions and free disk space, then retry.",
  export_verify:
    "The recovery file could not be verified. A file may exist at the selected location; no successful save was confirmed.",
  export_conflict:
    "The draft or destination changed during export. Nothing was overwritten; choose the destination again.",
  export_unsafe:
    "Choose a regular file outside application storage. Original plan sources and linked files cannot be replaced.",
  export_cleanup:
    "The temporary recovery export could not be removed. No successful save was confirmed.",
};
export class PlanDraftError extends Error {
  constructor(readonly code: keyof typeof messages) {
    super(messages[code]);
  }
}
function failure(value: unknown): PlanDraftError {
  if (value instanceof PlanDraftError) return value;
  if (
    typeof value === "object" &&
    value !== null &&
    "contractVersion" in value &&
    value.contractVersion === 1 &&
    "code" in value &&
    typeof value.code === "string" &&
    Object.hasOwn(messages, value.code)
  )
    return new PlanDraftError(value.code as keyof typeof messages);
  return new PlanDraftError("storage");
}
export const nativeDraftsAvailable = () => "__TAURI_INTERNALS__" in globalThis;
export { validatorFingerprint } from "./plan-validator-registry";
import {
  validatorFingerprint,
  recognizedValidator,
} from "./plan-validator-registry";

export async function previewPlan(
  bytes: Uint8Array,
  fileName: string,
): Promise<PlanPreview> {
  const original = Uint8Array.from(bytes);
  if (!original.length || original.length > PLAN_SOURCE_LIMIT)
    throw new Error("Plan JSON must be between 1 byte and 8 MiB.");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(original);
  } catch {
    throw new Error("Plan JSON must use valid UTF-8 text.");
  }
  return {
    bytes: original,
    fileName,
    sourceHash: await sha256Hex(original),
    validation: parseTrainingPlan(text),
  };
}

async function verifySaved(value: unknown): Promise<SavedDraft> {
  const wire = z
    .object({
      contractVersion: z.literal(1),
      record: draftRecordSchema,
      bytes: z
        .array(z.number().int().min(0).max(255))
        .min(1)
        .max(PLAN_SOURCE_LIMIT),
    })
    .strict()
    .safeParse(value);
  if (!wire.success) throw new PlanDraftError("corrupt");
  const { record } = wire.data;
  const preview = await previewPlan(
    Uint8Array.from(wire.data.bytes),
    record.originalFileName,
  );
  const validator = await recognizedValidator(record);
  if (!validator) throw new PlanDraftError("corrupt");
  preview.validation = validator.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(preview.bytes),
  );
  if (
    !preview.validation.ok ||
    preview.validation.plan.schemaVersion !== record.schemaVersion ||
    record.sourceHash !== preview.sourceHash ||
    record.byteLength !== preview.bytes.length ||
    record.sourceId !== `plan-source:${preview.sourceHash}` ||
    record.draftId !== `plan-draft:${preview.sourceHash}` ||
    record.diagnosticsHash !==
      (await sha256Hex(new TextEncoder().encode(record.diagnosticsJson))) ||
    record.diagnosticsJson !== JSON.stringify(preview.validation.diagnostics)
  )
    throw new PlanDraftError("corrupt");
  const manifest = preview.validation.plan.manifest;
  if (
    manifest.planId !== record.planId ||
    manifest.versionId !== record.versionId ||
    (manifest.parentVersionId ?? null) !== record.parentVersionId
  )
    throw new PlanDraftError("corrupt");
  return { record, preview };
}

async function inspectEnvelope(text: string) {
  if (new TextEncoder().encode(text).length > PLAN_RECOVERY_LIMIT)
    throw new PlanDraftError("invalid");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new PlanDraftError("invalid");
  }
  const envelope = z
    .object({
      contractVersion: z.literal(1),
      kind: z.literal("stride-plan-draft-recovery"),
      record: draftRecordSchema,
      recordHash: hashSchema,
      sourceBase64: z.string().max(Math.ceil(PLAN_SOURCE_LIMIT / 3) * 4),
    })
    .strict()
    .safeParse(value);
  if (!envelope.success) throw new PlanDraftError("invalid");
  if (
    envelope.data.recordHash !==
    (await sha256Hex(
      new TextEncoder().encode(JSON.stringify(envelope.data.record)),
    ))
  )
    throw new PlanDraftError("corrupt");
  let bytes: number[];
  try {
    bytes = Array.from(atob(envelope.data.sourceBase64), (c) =>
      c.charCodeAt(0),
    );
  } catch {
    throw new PlanDraftError("invalid");
  }
  await verifySaved({
    contractVersion: 1,
    record: envelope.data.record,
    bytes,
  });
  return envelope.data;
}

export class NativeDraftStore implements DraftStore {
  constructor(private readonly call: typeof invoke = invoke) {}
  private async command<T>(command: string, request: object): Promise<T> {
    try {
      return await this.call<T>(command, { request });
    } catch (e) {
      throw failure(e);
    }
  }
  async inspect(): Promise<DraftInspection> {
    const result = z
      .object({
        contractVersion: z.literal(1),
        snapshot: z.string().nullable(),
        draft: draftRecordSchema.nullable(),
      })
      .strict()
      .safeParse(
        await this.command("inspect_plan_draft", { contractVersion: 1 }),
      );
    if (!result.success) throw new PlanDraftError("corrupt");
    if (result.data.snapshot !== null)
      validateCurrentSnapshot(
        parseSnapshotJson(result.data.snapshot) as AppData,
      );
    return result.data;
  }
  async save(
    input: PlanPreview,
    expected: DraftRecord | null,
  ): Promise<SavedDraft> {
    // Revalidate a private byte copy, never a mutable UI projection.
    const preview = await previewPlan(input.bytes, input.fileName);
    if (!preview.validation.ok) throw new PlanDraftError("invalid");
    const current = await this.inspect();
    if (current.snapshot === null) throw new PlanDraftError("storage");
    return verifySaved(
      await this.command("save_plan_draft", {
        contractVersion: 1,
        bytes: Array.from(preview.bytes),
        originalFileName: preview.fileName,
        sourceHash: preview.sourceHash,
        diagnosticsJson: JSON.stringify(preview.validation.diagnostics),
        validatorFingerprint: await validatorFingerprint(
          preview.validation.plan.schemaVersion,
        ),
        expectedDraftId: expected?.draftId ?? null,
        expectedRevision: expected?.revision ?? null,
        expectedSnapshot: current.snapshot,
      } satisfies NativeSaveRequest),
    );
  }
  async read() {
    const value = await this.command("read_plan_draft", { contractVersion: 1 });
    return value === null ? null : verifySaved(value);
  }
  async exportRecovery() {
    const text = await this.command<unknown>("export_plan_draft", {
      contractVersion: 1,
    });
    if (typeof text !== "string") throw new PlanDraftError("corrupt");
    await inspectEnvelope(text);
    return text;
  }
  async saveRecovery(): Promise<RecoverySaveResult> {
    const text = await this.exportRecovery();
    const response = await this.command("save_plan_draft_recovery", {
      contractVersion: 1,
      expectedRecoveryHash: await sha256Hex(new TextEncoder().encode(text)),
    });
    const result = z
      .discriminatedUnion("status", [
        z
          .object({
            contractVersion: z.literal(1),
            status: z.literal("cancelled"),
          })
          .strict(),
        z
          .object({
            contractVersion: z.literal(1),
            status: z.literal("saved"),
            path: z.string().min(1).max(32767),
          })
          .strict(),
      ])
      .safeParse(response);
    if (!result.success) throw new PlanDraftError("export_verify");
    return result.data;
  }
  async recover(text: string) {
    await inspectEnvelope(text);
    const current = await this.inspect();
    if (current.snapshot === null) throw new PlanDraftError("storage");
    return verifySaved(
      await this.command("recover_plan_draft", {
        contractVersion: 1,
        envelopeJson: text,
        expectedSnapshot: current.snapshot,
      }),
    );
  }
}
