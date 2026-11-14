import { parseBackup } from "../domain/backup";
import { sha256Hex } from "../domain/fit-hash";
import {
  parseSnapshotJson,
  validateSnapshot,
} from "../domain/snapshot-validation";
import type { AppData } from "../domain/types";
import type { FitSourceStore } from "./fit-source-store";

export interface RestorePreview {
  raw: string;
  version: number;
  data: AppData;
  missingSources: string[];
}
export async function inspectLegacyRestore(
  raw: string,
  sources: FitSourceStore,
): Promise<RestorePreview> {
  const parsed = parseSnapshotJson(raw);
  validateSnapshot(parsed);
  const data = parseBackup(raw);
  const missingSources: string[] = [];
  for (const source of data.fitSources) {
    try {
      const bytes = await sources.read(source.sourceHash);
      if (
        !bytes ||
        bytes.byteLength !== source.byteLength ||
        (await sha256Hex(bytes)) !== source.sourceHash
      )
        throw new Error("Missing source");
      source.preservationStatus = "verified";
      source.storedRelativePath = `fit-sources/${source.sourceHash.slice(0, 2)}/${source.sourceHash}.fit`;
      delete source.preservationError;
    } catch {
      missingSources.push(source.originalFileName);
    }
  }
  return {
    raw,
    version: (parsed as AppData).schemaVersion,
    data,
    missingSources,
  };
}
