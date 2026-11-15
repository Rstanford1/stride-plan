import { describe, expect, it, vi } from "vitest";
import type { invoke } from "@tauri-apps/api/core";
import {
  NativeDraftStore,
  PLAN_SOURCE_LIMIT,
  previewPlan,
} from "./plan-draft-store";
import {
  syntheticDraft,
  wireDraft,
  recoveryDraft,
} from "../test/plan-draft-fixture";
import { createInitialData } from "../domain/seed";
import sharedWire from "../../src-tauri/tests/plan-draft-wire.json";
import type { NativeSaveRequest } from "./plan-draft-store";
import { sha256Hex } from "../domain/fit-hash";
const snapshot = JSON.stringify(createInitialData());

describe("T05 plan preview and native boundary", () => {
  it("binds Save As to the verified unchanged recovery envelope without passing paths or contents", async () => {
    const saved = await syntheticDraft();
    const text = await recoveryDraft(saved);
    const call = vi.fn(async (command: string) =>
      command === "export_plan_draft"
        ? text
        : {
            contractVersion: 1,
            status: "saved",
            path: "D:\\Synthetic exports\\chosen-name.json",
          },
    ) as typeof invoke;
    const result = await new NativeDraftStore(call).saveRecovery();
    expect(result).toEqual({
      contractVersion: 1,
      status: "saved",
      path: "D:\\Synthetic exports\\chosen-name.json",
    });
    expect(call).toHaveBeenLastCalledWith("save_plan_draft_recovery", {
      request: {
        contractVersion: 1,
        expectedRecoveryHash: await sha256Hex(new TextEncoder().encode(text)),
      },
    });
    expect(JSON.parse(text).sourceBase64).toEqual(
      JSON.parse(await recoveryDraft(saved)).sourceBase64,
    );
  });
  it("handles Save As cancellation and refuses unverified export acknowledgements", async () => {
    const text = await recoveryDraft(await syntheticDraft());
    for (const reply of [
      { contractVersion: 1, status: "saved" },
      { contractVersion: 2, status: "saved", path: "D:\\synthetic.json" },
      { contractVersion: 1, status: "download_requested" },
    ]) {
      const call = vi.fn(async (command: string) =>
        command === "export_plan_draft" ? text : reply,
      ) as typeof invoke;
      await expect(
        new NativeDraftStore(call).saveRecovery(),
      ).rejects.toMatchObject({ code: "export_verify" });
    }
    const call = vi.fn(async (command: string) =>
      command === "export_plan_draft"
        ? text
        : { contractVersion: 1, status: "cancelled" },
    ) as typeof invoke;
    await expect(new NativeDraftStore(call).saveRecovery()).resolves.toEqual({
      contractVersion: 1,
      status: "cancelled",
    });
  });
  it("does not open Save As for corrupt recovery and sanitizes native export failures", async () => {
    const call = vi.fn().mockResolvedValue("{}");
    await expect(new NativeDraftStore(call).saveRecovery()).rejects.toThrow();
    expect(call).toHaveBeenCalledTimes(1);
    const text = await recoveryDraft(await syntheticDraft());
    const failure = vi.fn(async (command: string) => {
      if (command === "export_plan_draft") return text;
      throw {
        contractVersion: 1,
        code: "export_write",
        message: "private raw OS failure",
      };
    }) as typeof invoke;
    await expect(new NativeDraftStore(failure).saveRecovery()).rejects.toThrow(
      "Check folder permissions and free disk space",
    );
  });
  it("matches the shared Rust version-1 request and error fixture", async () => {
    const wire: NativeSaveRequest = { ...sharedWire.save, contractVersion: 1 };
    expect(wire).toEqual(sharedWire.save);
    const call = vi.fn().mockRejectedValue(sharedWire.error);
    await expect(new NativeDraftStore(call).read()).rejects.toThrow(
      sharedWire.error.message,
    );
    expect(call).toHaveBeenCalledWith("read_plan_draft", {
      request: sharedWire.request,
    });
  });
  it("preserves BOM, CRLF, raw instructions and unknown metadata with T01 warnings", async () => {
    const saved = await syntheticDraft();
    expect(saved.preview.validation.ok).toBe(true);
    expect(
      saved.preview.validation.diagnostics.some(
        (d) => d.severity === "warning",
      ),
    ).toBe(true);
    expect(saved.preview.bytes.slice(0, 3)).toEqual(
      Uint8Array.from([239, 187, 191]),
    );
    if (saved.preview.validation.ok)
      expect(saved.preview.validation.plan).toHaveProperty(
        "futureMetadata.nested.keep",
        true,
      );
    const copy = await previewPlan(saved.preview.bytes, saved.preview.fileName);
    saved.preview.bytes[0] = 0;
    expect(copy.bytes[0]).toBe(239);
  });
  it.each(["not JSON", '{"schemaVersion":"9"}', '{"schemaVersion":"1.1"}'])(
    "rejects invalid or unsupported input before any persistence: %s",
    async (text) => {
      const preview = await previewPlan(
        new TextEncoder().encode(text),
        "synthetic.json",
      );
      const call = vi.fn();
      expect(preview.validation.ok).toBe(false);
      await expect(
        new NativeDraftStore(call).save(preview, null),
      ).rejects.toMatchObject({ code: "invalid" });
      expect(call).not.toHaveBeenCalled();
    },
  );
  it("rejects invalid UTF-8 and oversize bytes", async () => {
    await expect(
      previewPlan(Uint8Array.from([255]), "synthetic.json"),
    ).rejects.toThrow("UTF-8");
    await expect(
      previewPlan(new Uint8Array(PLAN_SOURCE_LIMIT + 1), "synthetic.json"),
    ).rejects.toThrow("8 MiB");
  });
  it("waits for native durable save and verifies a new adapter's reopened bytes and report", async () => {
    const saved = await syntheticDraft();
    let release: (value: unknown) => void = () => {};
    let stored = false;
    const calls: string[] = [];
    const call = vi.fn(
      async (command: string, args?: Record<string, unknown>) => {
        calls.push(command);
        if (command === "inspect_plan_draft")
          return {
            contractVersion: 1,
            snapshot,
            draft: stored ? saved.record : null,
          };
        if (command === "save_plan_draft") {
          expect(args?.request).toMatchObject({
            contractVersion: 1,
            sourceHash: saved.record.sourceHash,
            expectedSnapshot: snapshot,
            expectedDraftId: null,
          });
          return new Promise((resolve) => {
            release = resolve;
          });
        }
        if (command === "read_plan_draft") return wireDraft(saved);
        throw new Error("Unexpected command");
      },
    ) as typeof invoke;
    let acknowledged = false;
    const first = new NativeDraftStore(call)
      .save(saved.preview, null)
      .then((result) => {
        acknowledged = true;
        return result;
      });
    await vi.waitFor(() => expect(calls).toContain("save_plan_draft"));
    expect(acknowledged).toBe(false);
    stored = true;
    release(wireDraft(saved));
    const result = await first;
    const reopened = await new NativeDraftStore(call).read();
    expect(reopened).toEqual(result);
    expect(reopened?.preview.bytes).toEqual(saved.preview.bytes);
  });
  it("revalidates saved bytes and rejects corrupt source, metadata, report or validator identity", async () => {
    const saved = await syntheticDraft();
    for (const change of [
      (wire: ReturnType<typeof wireDraft>) => {
        wire.bytes[0] = 0;
      },
      (wire: ReturnType<typeof wireDraft>) => {
        wire.record.sourceHash = "a".repeat(64);
      },
      (wire: ReturnType<typeof wireDraft>) => {
        wire.record.validatorFingerprint = "a".repeat(64);
      },
      (wire: ReturnType<typeof wireDraft>) => {
        wire.record.diagnosticsJson = "[]";
      },
      (wire: ReturnType<typeof wireDraft>) => {
        wire.record.planId = "different";
      },
    ]) {
      const wire = structuredClone(wireDraft(saved));
      change(wire);
      const call = vi.fn().mockResolvedValue(wire);
      await expect(new NativeDraftStore(call).read()).rejects.toThrow();
    }
  });
  it("does not publish invalid recovery and preserves every record and byte for valid recovery", async () => {
    const saved = await syntheticDraft();
    const call = vi.fn(async (command: string) =>
      command === "inspect_plan_draft"
        ? { contractVersion: 1, snapshot, draft: null }
        : wireDraft(saved),
    ) as typeof invoke;
    const store = new NativeDraftStore(call);
    const tampered = JSON.parse(await recoveryDraft(saved));
    tampered.record.byteLength++;
    await expect(store.recover(JSON.stringify(tampered))).rejects.toThrow();
    expect(call).not.toHaveBeenCalled();
    const result = await store.recover(await recoveryDraft(saved));
    expect(result.record).toEqual(saved.record);
    expect(result.preview.bytes).toEqual(saved.preview.bytes);
  });
  it("uses the observed revision and renders only typed safe storage errors", async () => {
    const saved = await syntheticDraft();
    const call = vi.fn(
      async (command: string, args?: Record<string, unknown>) => {
        if (command === "inspect_plan_draft")
          return { contractVersion: 1, snapshot, draft: saved.record };
        expect(args?.request).toMatchObject({
          expectedDraftId: saved.record.draftId,
          expectedRevision: 1,
        });
        throw {
          contractVersion: 1,
          code: "conflict",
          message: "private path should not be exposed",
        };
      },
    ) as typeof invoke;
    await expect(
      new NativeDraftStore(call).save(saved.preview, saved.record),
    ).rejects.toThrow("Nothing was overwritten");
    const unknown = vi.fn().mockRejectedValue(new Error("C:\\private\\secret"));
    await expect(new NativeDraftStore(unknown).read()).rejects.toThrow(
      "Retry is safe",
    );
  });
});
