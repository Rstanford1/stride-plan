import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { compile } from "json-schema-to-typescript";

const root = new URL("../", import.meta.url);
const schemaBytes = await readFile(
  new URL("schemas/training-plan/1.1.schema.json", root),
  "utf8",
);
const schema = JSON.parse(schemaBytes);
const hash = createHash("sha256").update(schemaBytes).digest("hex");
const output = new URL(".generated/training-plan.d.ts", root);
const generate = () =>
  compile(schema, "TrainingPlan", {
    bannerComment: `/* Generated from training-plan/1.1.schema.json. Do not edit.\n * Schema SHA-256: ${hash}\n */`,
    unknownAny: true,
    additionalProperties: true,
    // Array bounds are runtime rules, not enormous tuple unions.
    ignoreMinAndMaxItems: true,
    format: true,
    style: { endOfLine: "lf" },
  });
const generated = await generate();
if (process.argv.includes("--check")) {
  if (generated !== (await generate())) {
    throw new Error("Training-plan type generation is not deterministic.");
  }
  const existing = await readFile(output, "utf8").catch((error) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (existing !== undefined && existing !== generated) {
    throw new Error(
      "Training-plan declarations are stale. Run pnpm types:generate.",
    );
  }
}
await mkdir(new URL(".generated/", root), { recursive: true });
await writeFile(output, generated);
console.log("Training-plan declarations generated and schema-linked.");
