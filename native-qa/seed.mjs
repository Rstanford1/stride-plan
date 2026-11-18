// Recheck the isolation boundary immediately before creating a fresh profile.
import "./preflight.mjs";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const profile = path.join(
  process.env.STRIDE_QA_CONFIG_BASE,
  "com.strideplan.qa.i13",
);
mkdirSync(profile);
const database = new DatabaseSync(path.join(profile, "stride-plan.db"));
try {
  database.exec(
    "CREATE TABLE app_state (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL, updated_at TEXT NOT NULL)",
  );
  database
    .prepare("INSERT INTO app_state VALUES (1, ?, ?)")
    .run(
      readFileSync("native-qa/synthetic-snapshot.json", "utf8"),
      "2026-01-01T00:00:00.000Z",
    );
} finally {
  database.close();
}
