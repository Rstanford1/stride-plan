import partial from "../domain/__fixtures__/training-plan/valid-partial.json";
import {
  previewPlan,
  validatorFingerprint,
  type DraftRecord,
  type SavedDraft,
} from "../data/plan-draft-store";
import { sha256Hex } from "../domain/fit-hash";

export async function syntheticDraft(): Promise<SavedDraft> {
  const preview = await previewPlan(
    new TextEncoder().encode(`\ufeff${JSON.stringify(partial, null, 2)}\r\n `),
    "synthetic-plan.json",
  );
  if (!preview.validation.ok) throw new Error("Invalid synthetic fixture");
  const { manifest } = preview.validation.plan;
  const diagnosticsJson = JSON.stringify(preview.validation.diagnostics);
  const record: DraftRecord = {
    sourceId: `plan-source:${preview.sourceHash}`,
    sourceHash: preview.sourceHash,
    byteLength: preview.bytes.length,
    originalFileName: preview.fileName,
    importedAt: "2026-11-15T03:00:00.000Z",
    draftId: `plan-draft:${preview.sourceHash}`,
    planId: manifest.planId,
    versionId: manifest.versionId,
    parentVersionId: manifest.parentVersionId ?? null,
    revision: 1,
    state: "draft",
    createdAt: "2026-11-15T03:00:00.000Z",
    schemaVersion: "1.1",
    validatorVersion: "t01-1",
    validatorFingerprint: await validatorFingerprint(),
    diagnosticsJson,
    diagnosticsHash: await sha256Hex(new TextEncoder().encode(diagnosticsJson)),
  };
  return { record, preview };
}
export function wireDraft(saved: SavedDraft) {
  return {
    contractVersion: 1,
    record: saved.record,
    bytes: Array.from(saved.preview.bytes),
  };
}
export async function recoveryDraft(saved: SavedDraft) {
  return JSON.stringify({
    contractVersion: 1,
    kind: "stride-plan-draft-recovery",
    record: saved.record,
    recordHash: await sha256Hex(
      new TextEncoder().encode(JSON.stringify(saved.record)),
    ),
    sourceBase64: btoa(
      Array.from(saved.preview.bytes, (b) => String.fromCharCode(b)).join(""),
    ),
  });
}
