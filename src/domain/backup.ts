import type { AppData } from "./types";
import { upgradeAppData } from "./app-data";
import { parseSnapshotJson } from "./snapshot-validation";

export function serializeBackup(data: AppData): string {
  return JSON.stringify(data, null, 2);
}

export function parseBackup(contents: string): AppData {
  return upgradeAppData(parseSnapshotJson(contents));
}
