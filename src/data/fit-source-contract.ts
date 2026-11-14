// Version-1 serde wire contract. Shared JSON fixtures are checked by Rust and TS.
// Source IDs are existing lowercase SHA-256 hashes; paths are output metadata only.
export const MAX_FIT_SOURCE_BYTES = 32 * 1024 * 1024;

export interface NativeSourceMetadata {
  contractVersion: 1;
  sourceId: string;
  sourceHash: string;
  byteLength: number;
  storedRelativePath: string;
}

export interface NativeReadResponse {
  source: NativeSourceMetadata;
  bytes: number[];
}

const errorMessages = {
  unsupported_version: "Unsupported FIT storage contract version.",
  invalid_source_id: "FIT source ID must be a lowercase SHA-256 value.",
  invalid_fit: "FIT source must contain an original FIT header.",
  too_large: "FIT source exceeds the 32 MiB storage limit.",
  hash_mismatch: "FIT source bytes do not match their source hash.",
  conflict:
    "Stored FIT source conflicts with the supplied bytes; nothing was overwritten.",
  missing: "Saved FIT source is missing.",
  corrupt: "Saved FIT source failed its integrity check.",
  unsafe_path: "FIT storage contains an unsafe path or linked object.",
  storage_unavailable: "FIT source storage is inaccessible.",
  write_failed: "FIT source could not be saved and verified. Retry is safe.",
  cleanup_failed:
    "FIT staging cleanup failed. Retry is safe; final sources were retained.",
} as const;

export type FitSourceErrorCode = keyof typeof errorMessages;

export class FitSourceStorageError extends Error {
  readonly contractVersion = 1;
  constructor(readonly code: FitSourceErrorCode) {
    super(errorMessages[code]);
    this.name = "FitSourceStorageError";
  }
}

export function normalizeStorageError(error: unknown): FitSourceStorageError {
  if (error instanceof FitSourceStorageError) return error;
  if (
    typeof error === "object" &&
    error !== null &&
    "contractVersion" in error &&
    error.contractVersion === 1 &&
    "code" in error &&
    typeof error.code === "string" &&
    Object.prototype.hasOwnProperty.call(errorMessages, error.code)
  ) {
    return new FitSourceStorageError(error.code as FitSourceErrorCode);
  }
  // Never expose a raw IPC/OS failure that may contain unrelated private paths.
  return new FitSourceStorageError("storage_unavailable");
}
