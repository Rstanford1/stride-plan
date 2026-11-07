import type { AppData } from "../domain/types";
import { createInitialData } from "../domain/seed";
import Database from "@tauri-apps/plugin-sql";

const STORAGE_KEY = "stride-plan:data:v1";

export interface AppRepository {
  load(): Promise<AppData>;
  save(data: AppData): Promise<void>;
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
      return parsed.schemaVersion === 2 ? parsed : createInitialData();
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
    if (parsed.schemaVersion === 2) return parsed;
    const initial = createInitialData();
    await this.save(initial);
    return initial;
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
