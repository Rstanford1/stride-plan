import type { AppData } from "../domain/types";
import { createInitialData } from "../domain/seed";
import Database from "@tauri-apps/plugin-sql";

const STORAGE_KEY = "stride-plan:data:v1";

export interface AppRepository {
  load(): Promise<AppData>;
  save(data: AppData): Promise<void>;
}

function upgradeData(value: AppData): AppData {
  if (value.schemaVersion === 3 && Array.isArray(value.shoes)) return value;
  if (value.schemaVersion === 2) {
    const sleepMap = {
      "a-lot": "restorative",
      normal: "adequate",
      "a-little": "limited",
      barely: "severely-limited",
    } as const;
    return {
      ...value,
      schemaVersion: 3,
      journals: value.journals.map((entry) => ({
        ...entry,
        sleep: entry.sleep
          ? sleepMap[entry.sleep as keyof typeof sleepMap]
          : undefined,
        sleepEntryMode: entry.sleep ? "subjective" : undefined,
        createdAt: entry.createdAt ?? entry.updatedAt,
      })),
      shoes: [
        {
          id: "shoe-daily-trainer",
          name: "Daily trainer",
          mileageMiles: 0,
          isDefault: true,
        },
      ],
    };
  }
  return createInitialData();
}

export class BrowserRepository implements AppRepository {
  constructor(
    private readonly storage: Pick<
      Storage,
      "getItem" | "setItem"
    > = window.localStorage,
  ) {}

  async load(): Promise<AppData> {
    const stored = this.storage.getItem(STORAGE_KEY);
    if (!stored) return createInitialData();
    try {
      const parsed = JSON.parse(stored) as AppData;
      return upgradeData(parsed);
    } catch {
      return createInitialData();
    }
  }

  async save(data: AppData): Promise<void> {
    this.storage.setItem(STORAGE_KEY, JSON.stringify(data));
  }
}

export class SqliteRepository implements AppRepository {
  private database?: Database;

  private async db(): Promise<Database> {
    this.database ??= await Database.load("sqlite:stride-plan.db");
    return this.database;
  }

  async load(): Promise<AppData> {
    const database = await this.db();
    const rows = await database.select<{ payload: string }[]>(
      "SELECT payload FROM app_state WHERE id = 1",
    );
    if (!rows[0]) {
      const initial = createInitialData();
      await this.save(initial);
      return initial;
    }
    const parsed = JSON.parse(rows[0].payload) as AppData;
    const upgraded = upgradeData(parsed);
    if (upgraded !== parsed) await this.save(upgraded);
    return upgraded;
  }

  async save(data: AppData): Promise<void> {
    const database = await this.db();
    await database.execute(
      "INSERT INTO app_state (id, payload, updated_at) VALUES (1, $1, $2) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at",
      [JSON.stringify(data), new Date().toISOString()],
    );
  }
}

export function createRepository(): AppRepository {
  const isTauri = "__TAURI_INTERNALS__" in window;
  return isTauri ? new SqliteRepository() : new BrowserRepository();
}
