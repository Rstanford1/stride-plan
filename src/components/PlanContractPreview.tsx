import type { TrainingPlan } from "../domain/training-plan-contract";
import type { Quantity } from "../../.generated/training-plan";
const labels: Record<string, string> = {
  "fixed-date": "Fixed date",
  "movable-within-week": "Movable within this week",
  priority: "Priority",
  supporting: "Supporting",
  unspecified: "Not specified",
};
function quantity(value: Quantity | undefined) {
  if (!value) return "Not specified";
  return "value" in value
    ? `${value.value} ${value.unit}`
    : `${value.min}–${value.max} ${value.unit}`;
}
export function PlanContractPreview({ plan }: { plan: TrainingPlan }) {
  const extended = plan.schemaVersion === "1.2" ? plan : undefined;
  function basis(path: string) {
    const evidence = extended?.interpretationEvidence?.find(
      (e) => e.path === path,
    );
    if (!evidence) return "Evidence not specified";
    return evidence.kind === "coach"
      ? "Coach source evidence"
      : `User-approved policy: ${evidence.policyId}`;
  }
  return (
    <details>
      <summary>
        Weekly targets, scheduling and priority · JSON {plan.schemaVersion}
      </summary>
      <p>
        Weekly mileage and priority-workout completion are separate. These
        labels do not calculate completion or move sessions. Optional sessions
        remain optional.
      </p>
      {plan.weeks.map((week, wi) => (
        <section
          key={week.id}
          aria-label={`Week ${week.number} contract details`}
        >
          <h4>
            Week {week.number}: {week.startDate}–{week.endDate}
          </h4>
          <p>
            Total mileage target:{" "}
            {quantity(extended?.weeks[wi].totalMileageTarget)}
            {extended?.weeks[wi].totalMileageTarget
              ? ` · ${basis(`/weeks/${wi}/totalMileageTarget`)}`
              : ""}
          </p>
          {week.days.map((day, di) =>
            day.sessions.map((session, si) => {
              const classified = extended?.weeks[wi].days[di].sessions[si];
              const path = `/weeks/${wi}/days/${di}/sessions/${si}`;
              return (
                <div key={session.id}>
                  <p>
                    <strong>
                      {day.date} · {session.title}
                    </strong>{" "}
                    · {session.role} · {session.participation} ·{" "}
                    {session.completionClass}
                  </p>
                  <p>
                    Scheduling:{" "}
                    {labels[classified?.schedulingPolicy ?? "unspecified"]}
                    {classified?.schedulingPolicy &&
                    classified.schedulingPolicy !== "unspecified"
                      ? ` · ${basis(`${path}/schedulingPolicy`)}`
                      : ""}
                  </p>
                  <p>
                    Priority:{" "}
                    {labels[classified?.priorityClass ?? "unspecified"]}
                    {classified?.priorityClass &&
                    classified.priorityClass !== "unspecified"
                      ? ` · ${basis(`${path}/priorityClass`)}`
                      : ""}
                  </p>
                </div>
              );
            }),
          )}
        </section>
      ))}
      {extended?.interpretationPolicies?.map((policy) => (
        <div key={policy.id}>
          <h4>User-approved interpretation policy: {policy.id}</h4>
          <p>
            Approval recorded by the document producer; Stride Plan does not
            verify who approved it.
          </p>
          <pre className="plan-draft-source">{policy.statement}</pre>
        </div>
      ))}
    </details>
  );
}
