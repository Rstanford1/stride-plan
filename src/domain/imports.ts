import { z } from "zod";

export const planRowSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD."),
  title: z.string().trim().min(1),
  planned_miles: z.coerce.number().min(0).max(100),
  session_type: z.enum(["rest", "easy", "recovery", "workout", "long"]),
  guidance: z.string().optional().default(""),
  instructions: z.string().optional().default(""),
  flexible: z
    .union([z.boolean(), z.string()])
    .transform(
      (value) => value === true || String(value).toLowerCase() === "true",
    ),
  phase: z.string().optional().default("Imported"),
});

export type PlanImportRow = z.infer<typeof planRowSchema>;

export interface ImportValidation {
  validRows: PlanImportRow[];
  errors: { row: number; messages: string[] }[];
  duplicateDates: string[];
}

export function validatePlanRows(
  rows: Record<string, unknown>[],
): ImportValidation {
  const validRows: PlanImportRow[] = [];
  const errors: ImportValidation["errors"] = [];
  rows.forEach((row, index) => {
    const parsed = planRowSchema.safeParse(row);
    if (parsed.success) validRows.push(parsed.data);
    else
      errors.push({
        row: index + 2,
        messages: parsed.error.issues.map((issue) => issue.message),
      });
  });
  const counts = validRows.reduce<Record<string, number>>((result, row) => {
    result[row.date] = (result[row.date] ?? 0) + 1;
    return result;
  }, {});
  return {
    validRows,
    errors,
    duplicateDates: Object.entries(counts)
      .filter(([, count]) => count > 1)
      .map(([date]) => date),
  };
}

export function isDuplicateActivity(
  sourceHash: string,
  existingHashes: string[],
): boolean {
  return existingHashes.includes(sourceHash);
}
