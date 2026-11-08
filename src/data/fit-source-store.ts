import {
  BaseDirectory,
  exists,
  mkdir,
  readFile,
  remove,
  rename,
  writeFile,
} from "@tauri-apps/plugin-fs";
import { sha256Hex } from "../domain/fit-hash";

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
    await assertMatchingBytes(sourceHash, bytes);
    const relativePath = sourceRelativePath(sourceHash);
    const directory = `fit-sources/${sourceHash.slice(0, 2)}`;
    const temporaryPath = `${directory}/${sourceHash}.${crypto.randomUUID()}.tmp`;
    await mkdir(directory, {
      baseDir: BaseDirectory.AppLocalData,
      recursive: true,
    });
    if (await exists(relativePath, { baseDir: BaseDirectory.AppLocalData })) {
      await assertMatchingBytes(
        sourceHash,
        await readFile(relativePath, { baseDir: BaseDirectory.AppLocalData }),
      );
      return { status: "verified", storedRelativePath: relativePath };
    }
    try {
      await writeFile(temporaryPath, Uint8Array.from(bytes), {
        baseDir: BaseDirectory.AppLocalData,
        createNew: true,
      });
      await assertMatchingBytes(
        sourceHash,
        await readFile(temporaryPath, { baseDir: BaseDirectory.AppLocalData }),
      );
      await rename(temporaryPath, relativePath, {
        oldPathBaseDir: BaseDirectory.AppLocalData,
        newPathBaseDir: BaseDirectory.AppLocalData,
      });
      return { status: "verified", storedRelativePath: relativePath };
    } catch (error) {
      if (
        await exists(temporaryPath, { baseDir: BaseDirectory.AppLocalData })
      ) {
        await remove(temporaryPath, { baseDir: BaseDirectory.AppLocalData });
      }
      throw error;
    }
  }

  async read(sourceHash: string): Promise<Uint8Array | undefined> {
    assertSourceHash(sourceHash);
    const relativePath = sourceRelativePath(sourceHash);
    if (
      !(await exists(relativePath, { baseDir: BaseDirectory.AppLocalData }))
    ) {
      return undefined;
    }
    const bytes = await readFile(relativePath, {
      baseDir: BaseDirectory.AppLocalData,
    });
    await assertMatchingBytes(sourceHash, bytes);
    return bytes;
  }
}

export function createFitSourceStore(): FitSourceStore {
  return "__TAURI_INTERNALS__" in globalThis
    ? new TauriFitSourceStore()
    : new BrowserFitSourceStore();
}
