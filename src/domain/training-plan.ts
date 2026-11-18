/** Version routing never upgrades or rewrites the submitted document. */
import * as v11 from "./training-plan-validation";
import * as v12 from "./training-plan-validation-1.2";
import type {
  PlanValidationResult,
  TrainingPlan,
} from "./training-plan-contract";
function parser(text: string) {
  // The selected parser still checks limits, duplicate keys and all semantics.
  if (new TextEncoder().encode(text).length > 10 * 1024 * 1024) return v11;
  try {
    return JSON.parse(text)?.schemaVersion === "1.2" ? v12 : v11;
  } catch {
    return v11;
  }
}
function currentDiagnostics(
  result: PlanValidationResult,
): PlanValidationResult {
  if (
    !result.ok &&
    result.diagnostics.some((issue) => issue.code === "unsupported_version")
  )
    return {
      ok: false,
      diagnostics: result.diagnostics.map((issue) =>
        issue.code === "unsupported_version"
          ? {
              ...issue,
              message:
                "Unsupported training-plan version. JSON 1.1 and 1.2 are supported; no automatic conversion is available.",
            }
          : issue,
      ),
    };
  return result;
}
export function parseTrainingPlan(text: string) {
  return currentDiagnostics(parser(text).parseTrainingPlan(text));
}
export function validateTrainingPlan(value: unknown) {
  // Inspect JSON safety before reading potentially hostile object properties.
  const baseline = v11.validateTrainingPlan(value);
  if (
    !baseline.ok &&
    baseline.diagnostics.length === 1 &&
    baseline.diagnostics[0].code === "unsupported_version" &&
    (value as { schemaVersion?: unknown }).schemaVersion === "1.2"
  )
    return v12.validateTrainingPlan(value);
  return currentDiagnostics(baseline);
}
export function serializeTrainingPlan(plan: TrainingPlan): string {
  const result = validateTrainingPlan(plan);
  if (!result.ok)
    throw new Error(
      `Invalid training plan: ${result.diagnostics.find((i) => i.severity === "error")?.code}`,
    );
  return JSON.stringify(plan, null, 2);
}
