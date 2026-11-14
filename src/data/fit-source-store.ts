import { invoke } from "@tauri-apps/api/core";
import { sha256Hex } from "../domain/fit-hash";
import {
  FitSourceStorageError,
  MAX_FIT_SOURCE_BYTES,
  type NativeReadResponse,
  type NativeSourceMetadata,
  normalizeStorageError,
} from "./fit-source-contract";

export interface FitSourcePreservation {
  status: "verified" | "unavailable";
  storedRelativePath?: string;
}

export interface FitSourceStore {
  preserve(
    sourceHash: string,
    bytes: Uint8Array,
  ): Promise<FitSourcePreservation>;
  read(sourceHash: string): Promise<Uint8Array | undefined>;
}

function assertSourceHash(sourceHash: string): void {
  if (!/^[a-f0-9]{64}$/.test(sourceHash)) {
    throw new Error("FIT source hash must be a lowercase SHA-256 value.");
  }
}

async function assertMatchingBytes(
  sourceHash: string,
  bytes: Uint8Array,
): Promise<void> {
  if ((await sha256Hex(bytes)) !== sourceHash) {
    throw new Error("FIT source bytes do not match their source hash.");
  }
}

export class BrowserFitSourceStore implements FitSourceStore {
  async preserve(): Promise<FitSourcePreservation> {
    return { status: "unavailable" };
  }

  async read(): Promise<undefined> {
    return undefined;
  }
}

export class MemoryFitSourceStore implements FitSourceStore {
  private readonly values = new Map<string, Uint8Array>();

  async preserve(
    sourceHash: string,
    bytes: Uint8Array,
  ): Promise<FitSourcePreservation> {
    assertSourceHash(sourceHash);
    await assertMatchingBytes(sourceHash, bytes);
    this.values.set(sourceHash, Uint8Array.from(bytes));
    return {
      status: "verified",
      storedRelativePath: sourceRelativePath(sourceHash),
    };
  }

  async read(sourceHash: string): Promise<Uint8Array | undefined> {
    assertSourceHash(sourceHash);
    const value = this.values.get(sourceHash);
    return value ? Uint8Array.from(value) : undefined;
  }
}

function sourceRelativePath(sourceHash: string): string {
  return `fit-sources/${sourceHash.slice(0, 2)}/${sourceHash}.fit`;
}

export class TauriFitSourceStore implements FitSourceStore {
  async preserve(
    sourceHash: string,
    bytes: Uint8Array,
  ): Promise<FitSourcePreservation> {
    assertSourceHash(sourceHash);
    if (bytes.byteLength > MAX_FIT_SOURCE_BYTES) {
      throw new FitSourceStorageError("too_large");
    }
    try {
      const source = await invoke<NativeSourceMetadata>("store_fit_source", {
        request: { contractVersion: 1, sourceHash, bytes: Array.from(bytes) },
      });
      assertMetadata(source, sourceHash, bytes.byteLength);
      return {
        status: "verified",
        storedRelativePath: source.storedRelativePath,
      };
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  async read(sourceHash: string): Promise<Uint8Array | undefined> {
    assertSourceHash(sourceHash);
    try {
      const result = await invoke<NativeReadResponse>("read_fit_source", {
        request: { contractVersion: 1, sourceHash },
      });
      if (
        !Array.isArray(result.bytes) ||
        result.bytes.length > MAX_FIT_SOURCE_BYTES ||
        !result.bytes.every(
          (value) => Number.isInteger(value) && value >= 0 && value <= 255,
        )
      ) {
        throw new FitSourceStorageError("corrupt");
      }
      assertMetadata(result.source, sourceHash, result.bytes.length);
      const bytes = Uint8Array.from(result.bytes);
      if ((await sha256Hex(bytes)) !== sourceHash) {
        throw new FitSourceStorageError("corrupt");
      }
      return bytes;
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }
}

function assertMetadata(
  source: NativeSourceMetadata,
  sourceHash: string,
  byteLength: number,
): void {
  if (
    source.contractVersion !== 1 ||
    source.sourceId !== `fit-source:${sourceHash}` ||
    source.sourceHash !== sourceHash ||
    source.byteLength !== byteLength ||
    source.storedRelativePath !== sourceRelativePath(sourceHash)
  ) {
    throw new FitSourceStorageError("corrupt");
  }
}

export function createFitSourceStore(): FitSourceStore {
  return "__TAURI_INTERNALS__" in globalThis
    ? new TauriFitSourceStore()
    : new BrowserFitSourceStore();
}
