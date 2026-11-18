import { describe, expect, it, vi } from "vitest";
import type { invoke } from "@tauri-apps/api/core";
import {
  NativeDraftStore,
  previewPlan,
  validatorFingerprint,
  type DraftRecord,
} from "./plan-draft-store";
import {
  syntheticDraft,
  wireDraft,
  recoveryDraft,
} from "../test/plan-draft-fixture";
import identities from "../test/historical-plan-validators.json";
import { recognizedValidator } from "./plan-validator-registry";
import plan12 from "../domain/__fixtures__/training-plan/valid-1.2-75plus.json";
import { createInitialData } from "../domain/seed";
import { sha256Hex } from "../domain/fit-hash";
const snapshot = JSON.stringify(createInitialData());
describe("versioned immutable draft/recovery boundary", () => {
  it.each(identities)(
    "replays and recovers exact historical 1.1 source, record, fingerprint and report from $sourceCommit",
    async (identity) => {
      const saved = await syntheticDraft();
      saved.record.validatorFingerprint = identity.validatorFingerprint;
      const validator = await recognizedValidator(saved.record);
      expect(validator).toBeDefined();
      const result = validator!.parse(
        new TextDecoder().decode(saved.preview.bytes),
      );
      expect(JSON.stringify(result.diagnostics)).toBe(
        saved.record.diagnosticsJson,
      );
      const envelope = await recoveryDraft(saved);
      const original = JSON.stringify(saved.record);
      const bytes = saved.preview.bytes.slice();
      let present = true;
      const call = vi.fn(
        async (command: string, args?: Record<string, unknown>) => {
          if (command === "inspect_plan_draft")
            return {
              contractVersion: 1,
              snapshot,
              draft: present ? saved.record : null,
            };
          if (command === "read_plan_draft")
            return present ? wireDraft(saved) : null;
          if (command === "export_plan_draft") return envelope;
          if (command === "recover_plan_draft") {
            expect(args?.request).toMatchObject({ envelopeJson: envelope });
            present = true;
            return wireDraft(saved);
          }
          if (command === "save_plan_draft") {
            expect(args?.request).toMatchObject({
              validatorFingerprint: await validatorFingerprint("1.1"),
              expectedDraftId: saved.record.draftId,
            });
            return wireDraft(saved);
          }
          throw Error("Unexpected mutation");
        },
      ) as typeof invoke;
      expect((await new NativeDraftStore(call).read())?.record).toEqual(
        saved.record,
      );
      expect(await new NativeDraftStore(call).exportRecovery()).toBe(envelope);
      present = false;
      expect(
        (await new NativeDraftStore(call).recover(envelope)).record,
      ).toEqual(saved.record);
      const reopened = await new NativeDraftStore(call).read();
      expect(reopened?.preview.bytes).toEqual(bytes);
      expect(JSON.stringify(reopened?.record)).toBe(original);
      expect(call).not.toHaveBeenCalledWith(
        "save_plan_draft",
        expect.anything(),
      );
      const reimport = await new NativeDraftStore(call).save(
        saved.preview,
        saved.record,
      );
      expect(JSON.stringify(reimport.record)).toBe(original);
      expect(await new NativeDraftStore(call).exportRecovery()).toBe(envelope);
    },
  );
  it("saves a private copy of 1.2 bytes, then reopens, exports and recovers without source normalization", async () => {
    const saved = await syntheticDraft();
    saved.preview = await previewPlan(
      new TextEncoder().encode(
        `\ufeff${JSON.stringify(plan12, null, 2).replaceAll("\n", "\r\n")}\r\n `,
      ),
      "synthetic-1.2.json",
    );
    expect(saved.preview.validation.ok).toBe(true);
    const report = JSON.stringify(saved.preview.validation.diagnostics);
    Object.assign(saved.record, {
      schemaVersion: "1.2",
      validatorVersion: "t081-1",
      validatorFingerprint: await validatorFingerprint("1.2"),
      sourceId: `plan-source:${saved.preview.sourceHash}`,
      draftId: `plan-draft:${saved.preview.sourceHash}`,
      sourceHash: saved.preview.sourceHash,
      byteLength: saved.preview.bytes.length,
      originalFileName: saved.preview.fileName,
      diagnosticsJson: report,
      diagnosticsHash: await sha256Hex(new TextEncoder().encode(report)),
    } satisfies Partial<DraftRecord>);
    const envelope = await recoveryDraft(saved);
    let present = false;
    const call = vi.fn(
      async (command: string, args?: Record<string, unknown>) => {
        if (command === "inspect_plan_draft")
          return {
            contractVersion: 1,
            snapshot,
            draft: present ? saved.record : null,
          };
        if (command === "save_plan_draft") {
          expect(args?.request).toMatchObject({
            validatorFingerprint: saved.record.validatorFingerprint,
            bytes: Array.from(saved.preview.bytes),
            diagnosticsJson: report,
          });
          present = true;
          return wireDraft(saved);
        }
        if (command === "read_plan_draft")
          return present ? wireDraft(saved) : null;
        if (command === "export_plan_draft") return envelope;
        if (command === "recover_plan_draft") {
          present = true;
          return wireDraft(saved);
        }
        throw Error("Unexpected command");
      },
    ) as typeof invoke;
    expect(await new NativeDraftStore(call).save(saved.preview, null)).toEqual(
      saved,
    );
    expect(await new NativeDraftStore(call).read()).toEqual(saved);
    expect(await new NativeDraftStore(call).exportRecovery()).toBe(envelope);
    present = false;
    expect(await new NativeDraftStore(call).recover(envelope)).toEqual(saved);
    expect(await new NativeDraftStore(call).read()).toEqual(saved);
  });
  it("rejects unrecognized or mismatched schema/validator pairs and rehashed false reports before native recovery", async () => {
    for (const changed of [
      { validatorFingerprint: "a".repeat(64) },
      { validatorVersion: "t081-1" },
      { schemaVersion: "1.2" },
      { diagnosticsJson: "[]" },
    ]) {
      const saved = await syntheticDraft();
      Object.assign(saved.record, changed);
      saved.record.diagnosticsHash = await sha256Hex(
        new TextEncoder().encode(saved.record.diagnosticsJson),
      );
      const call = vi.fn();
      await expect(
        new NativeDraftStore(call).recover(await recoveryDraft(saved)),
      ).rejects.toThrow();
      expect(call).not.toHaveBeenCalled();
    }
  });
  it("pins both explicitly recognized historical identities and uses only PR16 identity for new 1.1 imports", async () => {
    expect(await validatorFingerprint()).toBe(
      identities[1].validatorFingerprint,
    );
    expect(
      await recognizedValidator({
        ...identities[0],
        validatorVersion: "future",
      }),
    ).toBeUndefined();
  });
});
