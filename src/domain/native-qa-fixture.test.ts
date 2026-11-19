import { expect, it } from "vitest";
import snapshot from "../../native-qa/synthetic-snapshot.json";
import { validateCurrentSnapshot } from "./snapshot-validation";
import type { AppData } from "./types";

it("uses a synthetic snapshot accepted by the production validator", () => {
  expect(() => validateCurrentSnapshot(snapshot as AppData)).not.toThrow();
  expect(snapshot.sessions).toHaveLength(1);
  expect(snapshot.sessions[0].title).toBe("Synthetic QA rest");
  expect(snapshot.activities).toEqual([]);
  expect(snapshot.fitSources).toEqual([]);
  expect(snapshot.journals).toEqual([]);
});
