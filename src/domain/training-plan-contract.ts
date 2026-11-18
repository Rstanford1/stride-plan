export type {
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

import type { TrainingPlan as Plan11 } from "../../.generated/training-plan";
import type { TrainingPlan as Plan12 } from "../../.generated/training-plan-1.2";
export type TrainingPlan = Plan11 | Plan12;
export type { Plan11, Plan12 };

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
