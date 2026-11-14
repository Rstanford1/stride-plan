import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import wire from "../../src-tauri/tests/fit-source-wire.json";
import { sha256Hex } from "../domain/fit-hash";
import {
  FitSourceStorageError,
  MAX_FIT_SOURCE_BYTES,
  normalizeStorageError,
} from "./fit-source-contract";
import {
  BrowserFitSourceStore,
  MemoryFitSourceStore,
  TauriFitSourceStore,
} from "./fit-source-store";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("FIT source store", () => {
  it("preserves an independent byte-for-byte copy", async () => {
    const store = new MemoryFitSourceStore();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const sourceHash = await sha256Hex(bytes);
    const result = await store.preserve(sourceHash, bytes);
    bytes[0] = 9;
    expect(result.status).toBe("verified");
    expect(await store.read(sourceHash)).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("refuses bytes that do not match their declared hash", async () => {
    const store = new MemoryFitSourceStore();
    await expect(
      store.preserve("0".repeat(64), new Uint8Array([1, 2, 3])),
    ).rejects.toThrow("do not match");
  });
});

describe("native FIT source adapter", () => {
  beforeEach(() => vi.mocked(invoke).mockReset());

  it("uses the serde wire fixture and preserves the existing source-reference interface", async () => {
    const store = new TauriFitSourceStore();
    vi.mocked(invoke)
      .mockResolvedValueOnce(wire.metadata)
      .mockResolvedValueOnce(wire.response);
    await expect(
      store.preserve(wire.store.sourceHash, Uint8Array.from(wire.store.bytes)),
    ).resolves.toEqual({
      status: "verified",
      storedRelativePath: wire.metadata.storedRelativePath,
    });
    expect(invoke).toHaveBeenNthCalledWith(1, "store_fit_source", {
      request: wire.store,
    });
    await expect(store.read(wire.read.sourceHash)).resolves.toEqual(
      Uint8Array.from(wire.store.bytes),
    );
    expect(invoke).toHaveBeenNthCalledWith(2, "read_fit_source", {
      request: wire.read,
    });
  });

  it("waits for native verification before acknowledging durable storage", async () => {
    let finish!: (value: unknown) => void;
    vi.mocked(invoke).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    let verified = false;
    const result = new TauriFitSourceStore()
      .preserve(wire.store.sourceHash, Uint8Array.from(wire.store.bytes))
      .then((value) => {
        verified = true;
        return value;
      });
    await Promise.resolve();
    expect(verified).toBe(false);
    finish(wire.metadata);
    expect((await result).status).toBe("verified");
  });

  it.each([
    "../outside.fit",
    "C:\\private.fit",
    "/tmp/other",
    "A".repeat(64),
    "a".repeat(63),
  ])(
    "rejects invalid source identifier %s before invoking native code",
    async (sourceHash) => {
      const store = new TauriFitSourceStore();
      await expect(
        store.preserve(sourceHash, new Uint8Array()),
      ).rejects.toThrow("SHA-256");
      await expect(store.read(sourceHash)).rejects.toThrow("SHA-256");
      expect(invoke).not.toHaveBeenCalled();
    },
  );

  it("rejects oversized sources before allocating an IPC array", async () => {
    await expect(
      new TauriFitSourceStore().preserve(
        wire.store.sourceHash,
        new Uint8Array(MAX_FIT_SOURCE_BYTES + 1),
      ),
    ).rejects.toMatchObject({ code: "too_large" });
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([
    "conflict",
    "write_failed",
    "cleanup_failed",
    "unsafe_path",
    "storage_unavailable",
    "hash_mismatch",
    "unsupported_version",
    "invalid_fit",
  ])(
    "reports native %s failures without marking storage verified",
    async (code) => {
      vi.mocked(invoke).mockRejectedValueOnce({
        contractVersion: 1,
        code,
        message: "C:\\unrelated\\private.fit",
      });
      await expect(
        new TauriFitSourceStore().preserve(
          wire.store.sourceHash,
          Uint8Array.from(wire.store.bytes),
        ),
      ).rejects.toMatchObject({ code });
    },
  );

  it.each(["missing", "corrupt", "storage_unavailable"])(
    "reports a typed %s read failure",
    async (code) => {
      vi.mocked(invoke).mockRejectedValueOnce({ ...wire.error, code });
      await expect(
        new TauriFitSourceStore().read(wire.read.sourceHash),
      ).rejects.toMatchObject({ code });
    },
  );

  it("checks read bytes and metadata rather than trusting a saved verified flag", async () => {
    const store = new TauriFitSourceStore();
    vi.mocked(invoke).mockResolvedValueOnce({
      ...wire.response,
      bytes: wire.response.bytes.map(() => 0),
    });
    await expect(store.read(wire.read.sourceHash)).rejects.toMatchObject({
      code: "corrupt",
    });
    vi.mocked(invoke).mockResolvedValueOnce({ ...wire.response, bytes: [-1] });
    await expect(store.read(wire.read.sourceHash)).rejects.toMatchObject({
      code: "corrupt",
    });
    vi.mocked(invoke).mockResolvedValueOnce({
      ...wire.metadata,
      storedRelativePath: "../outside.fit",
    });
    await expect(
      store.preserve(wire.store.sourceHash, Uint8Array.from(wire.store.bytes)),
    ).rejects.toMatchObject({ code: "corrupt" });
    vi.mocked(invoke).mockResolvedValueOnce({
      ...wire.metadata,
      contractVersion: 2,
    });
    await expect(
      store.preserve(wire.store.sourceHash, Uint8Array.from(wire.store.bytes)),
    ).rejects.toMatchObject({ code: "corrupt" });
  });

  it("normalizes unknown IPC errors without exposing unrelated filesystem paths", () => {
    expect(normalizeStorageError("C:\\private\\secret.db")).toBeInstanceOf(
      FitSourceStorageError,
    );
    expect(
      normalizeStorageError("C:\\private\\secret.db").message,
    ).not.toContain("private");
    expect(normalizeStorageError(wire.error)).toMatchObject(wire.error);
    expect(
      normalizeStorageError({ contractVersion: 1, code: "toString" }).code,
    ).toBe("storage_unavailable");
  });

  it("keeps browser storage explicitly unavailable", async () => {
    const store = new BrowserFitSourceStore();
    await expect(store.preserve()).resolves.toEqual({ status: "unavailable" });
    await expect(store.read()).resolves.toBeUndefined();
    expect(invoke).not.toHaveBeenCalled();
  });
});
