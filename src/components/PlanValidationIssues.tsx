import type { PlanDiagnostic } from "../domain/training-plan-contract";
import { validationDescription } from "../domain/plan-conversion";

export function PlanValidationIssues({
  diagnostics,
}: {
  diagnostics: PlanDiagnostic[];
}) {
  return (
    <ul className="validation-list">
      {diagnostics.map((item, index) => (
        <li key={index}>
          <strong>
            {item.severity === "warning"
              ? "Warning"
              : item.code === "invalid_json"
                ? "Invalid JSON syntax"
                : item.code.startsWith("schema.")
                  ? "Schema error"
                  : "Blocking validation error"}
          </strong>
          {" · "}
          {validationDescription(item)}
          <details>
            <summary>Technical details</summary>
            <p className="plan-draft-identity">
              {item.code} · {item.path || "/"}: {item.message}
            </p>
          </details>
        </li>
      ))}
    </ul>
  );
}
