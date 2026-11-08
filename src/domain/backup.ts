import type { AppData } from "./types";
import { upgradeAppData } from "./app-data";

export function serializeBackup(data: AppData): string {
  return JSON.stringify(data, null, 2);
}

export function parseBackup(contents: string): AppData {
  const parsed = JSON.parse(contents) as Partial<AppData>;
  if (
    typeof parsed.schemaVersion !== "number" ||
    !Array.isArray(parsed.sessions) ||
    !Array.isArray(parsed.activities) ||
    !Array.isArray(parsed.journals) ||
    !parsed.settings ||
    !Array.isArray(parsed.importFingerprints)
  ) {
    throw new Error("Invalid Stride Plan backup");
  }
  return upgradeAppData(parsed as AppData);
}
