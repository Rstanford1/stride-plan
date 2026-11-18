// Disposable test process; never resolves a real application profile.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
if (!basename(process.argv[2]).startsWith("stride-t081-synthetic-"))
  throw Error("Unsafe fixture path");
const db = new DatabaseSync(process.argv[2] + "/synthetic.sqlite");
db.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE");
db.exec(
  readFileSync(
    new URL(
      "../../src-tauri/migrations/0004_plan_draft_versions.sql",
      import.meta.url,
    ),
    "utf8",
  ),
);
db.exec("PRAGMA user_version=4");
process.stdout.write("uncommitted\n");
setInterval(() => {}, 1000);
