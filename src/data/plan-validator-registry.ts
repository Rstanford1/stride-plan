/** Closed identities. Historical report replay is separate from new intake. */
import schema11 from "../../schemas/training-plan/1.1.schema.json?raw";
import schema12 from "../../schemas/training-plan/1.2.schema.json?raw";
import text11 from "../domain/training-plan-validation.ts?raw";
import textPre16 from "../domain/training-plan-validation-pre16.ts?raw";
import text12 from "../domain/training-plan-validation-1.2.ts?raw";
import { parseTrainingPlan as pre16 } from "../domain/training-plan-validation-pre16";
import { parseTrainingPlan as v11 } from "../domain/training-plan-validation";
import { parseTrainingPlan as v12 } from "../domain/training-plan-validation-1.2";
import { sha256Hex } from "../domain/fit-hash";
const entries = [
  {
    schemaVersion: "1.1",
    validatorVersion: "t01-1",
    schema: schema11,
    text: textPre16,
    parse: pre16,
  },
  {
    schemaVersion: "1.1",
    validatorVersion: "t01-1",
    schema: schema11,
    text: text11,
    parse: v11,
  },
  {
    schemaVersion: "1.2",
    validatorVersion: "t081-1",
    schema: schema12,
    text: text12,
    parse: v12,
  },
] as const;
const fingerprint = (entry: (typeof entries)[number]) =>
  sha256Hex(new TextEncoder().encode(`${entry.schema}\n---\n${entry.text}`));
export const validatorFingerprint = (version = "1.1") => {
  const entry =
    version === "1.1" ? entries[1] : version === "1.2" ? entries[2] : undefined;
  if (!entry) throw new Error("Unsupported validator version");
  return fingerprint(entry);
};
export async function recognizedValidator(record: {
  schemaVersion: string;
  validatorVersion: string;
  validatorFingerprint: string;
}) {
  for (const entry of entries)
    if (
      entry.schemaVersion === record.schemaVersion &&
      entry.validatorVersion === record.validatorVersion &&
      (await fingerprint(entry)) === record.validatorFingerprint
    )
      return entry;
  return undefined;
}
