export type {
  TrainingPlan,
  Session,
  Workout,
  Block,
  WorkoutSet,
  Repetition,
  Recovery,
  Quantity,
  Target,
  Progression,
} from "../../.generated/training-plan";

import type { TrainingPlan } from "../../.generated/training-plan";

export interface PlanDiagnostic {
  severity: "error" | "warning";
  code: string;
  /** RFC 6901 JSON Pointer into the submitted document; empty means root. */
  path: string;
  message: string;
}

export type PlanValidationResult =
  | { ok: true; plan: TrainingPlan; diagnostics: PlanDiagnostic[] }
  | { ok: false; diagnostics: PlanDiagnostic[] };
