import { invoke } from "@tauri-apps/api/core";
import type { NativeSourceMetadata } from "./fit-source-contract";

export interface GarminStatus {
  credentialStored: boolean;
  lastVerifiedAt: number | null;
  verifiedThisSession: boolean;
}
export interface GarminActivity {
  activityId: string;
  date: string | null;
}
export interface GarminRetrieval {
  provider: "garmin";
  activityId: string;
  source: NativeSourceMetadata;
  relatedSourceHashes?: string[];
}
const messages = {
  browser:
    "The browser could not be opened. Visit Garmin Connect settings and choose Personal API Key.",
  invalid_key:
    "Enter a valid Personal API key without spaces (up to 2,048 characters).",
  authentication:
    "Garmin rejected the credential. Replace an incorrect, expired or revoked key.",
  not_connected: "Connect a Garmin Personal API key first.",
  credential_store:
    "Windows Credential Manager is unavailable. Check Windows access and try again.",
  network: "Cannot reach Garmin. Check your connection and try again.",
  timeout: "Garmin did not respond within 30 seconds. Try again.",
  rate_limited: "Garmin has limited requests. Wait before trying again.",
  provider: "Garmin could not complete the request. Try again later.",
  invalid_response:
    "Garmin returned an unexpected response. List recent activities again or try later.",
  too_large:
    "This download exceeds the safe size limit (16 MiB ZIP / 32 MiB FIT).",
  invalid_archive:
    "The download must contain exactly one safe, original FIT file.",
  invalid_fit:
    "The recording failed FIT file integrity checks. It was not preserved.",
  storage:
    "The original FIT or its Garmin receipt could not be saved and verified. Check local storage; retrying is safe.",
  cancelled:
    "Operation cancelled. Any source already being saved is retained safely; no workout was created.",
  busy: "Another Garmin operation is still running. Wait for it to finish.",
  unsupported:
    "Garmin integration is available only in the Windows desktop app.",
} as const;

export function garminError(error: unknown): string {
  if (typeof error !== "object" || error === null || !("code" in error))
    return "The Garmin operation failed. Try again.";
  const code = error.code;
  if (typeof code !== "string" || !Object.hasOwn(messages, code))
    return "The Garmin operation failed. Try again.";
  const message = messages[code as keyof typeof messages];
  if (
    code === "rate_limited" &&
    "retryAfterSeconds" in error &&
    typeof error.retryAfterSeconds === "number" &&
    Number.isInteger(error.retryAfterSeconds) &&
    error.retryAfterSeconds >= 0 &&
    error.retryAfterSeconds <= 86400
  )
    return `${message} Retry after ${error.retryAfterSeconds} seconds.`;
  return message;
}
export const garmin = {
  openKeyPage: () => invoke<void>("garmin_open_key_page"),
  available: () => "__TAURI_INTERNALS__" in globalThis,
  status: () => invoke<GarminStatus>("garmin_status"),
  connect: (apiKey: string) =>
    invoke<GarminStatus>("garmin_connect", { apiKey }),
  verify: () => invoke<GarminStatus>("garmin_verify"),
  disconnect: () => invoke<GarminStatus>("garmin_disconnect"),
  list: () => invoke<GarminActivity[]>("garmin_list_activities"),
  retrieve: (activityId: string) =>
    invoke<GarminRetrieval>("garmin_retrieve_activity", { activityId }),
  cancel: () => invoke<void>("garmin_cancel"),
};
