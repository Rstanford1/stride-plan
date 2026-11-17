import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";
import schema from "../../schemas/training-plan/1.1.schema.json?raw";
import example from "../domain/__fixtures__/training-plan/valid-workout.json?raw";
import { nativeDraftsAvailable } from "./plan-draft-store";

export const conversionFiles = {
  schema: {
    name: "stride-plan-training-plan-1.1.schema.json",
    contents: schema,
  },
  example: { name: "stride-plan-example-plan.json", contents: example },
} as const;
export type ConversionFile = keyof typeof conversionFiles;
const saveResult = z.discriminatedUnion("status", [
  z
    .object({ contractVersion: z.literal(1), status: z.literal("cancelled") })
    .strict(),
  z
    .object({
      contractVersion: z.literal(1),
      status: z.literal("saved"),
      path: z.string().min(1).max(32767),
    })
    .strict(),
]);
export async function saveConversionFile(
  kind: ConversionFile,
): Promise<string> {
  if (nativeDraftsAvailable()) {
    let response: unknown;
    try {
      response = await invoke("save_plan_conversion_file", {
        request: { contractVersion: 1, kind },
      });
    } catch {
      throw new Error(
        "The conversion file could not be saved and verified. Choose a regular file outside application storage, check folder permissions and free disk space, then retry.",
      );
    }
    const parsed = saveResult.safeParse(response);
    if (!parsed.success)
      throw new Error("The download could not be verified. Please try again.");
    const result = parsed.data;
    return result.status === "saved"
      ? `File saved and verified: ${result.path}`
      : "Download cancelled. No file was saved.";
  }
  const artifact = conversionFiles[kind];
  const url = URL.createObjectURL(
    new Blob([artifact.contents], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = artifact.name;
  anchor.click();
  // Let the browser start consuming the object before releasing it.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return `Download requested: ${artifact.name}. Check your browser downloads.`;
}
