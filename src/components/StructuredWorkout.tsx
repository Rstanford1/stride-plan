import type {
  Quantity,
  Recovery,
  Target,
  Workout,
  WorkoutSet,
  TrainingPlan,
} from "../domain/training-plan-contract";

function quantity(value?: Quantity): string {
  if (!value) return "Not specified";
  return "value" in value && typeof value.value === "number"
    ? `${value.value} ${value.unit}`
    : `${value.min}–${value.max} ${value.unit}`;
}
type PaceReferences = TrainingPlan["paceReferences"];
function targets(
  items: Target[] = [],
  references: PaceReferences = [],
): string {
  return items
    .map((target) => {
      if (target.kind === "effort") return target.text;
      if (target.kind === "pace-reference")
        return (
          references.find((item) => item.id === target.referenceId)?.label ??
          "Pace reference unavailable"
        );
      return target.min === target.max
        ? `${target.min} ${target.unit}`
        : `${target.min}–${target.max} ${target.unit}`;
    })
    .join(", ");
}
function recovery(value: Recovery): string {
  const intervals =
    "components" in value && Array.isArray(value.components)
      ? value.components
      : [value as Exclude<Recovery, { components: unknown }>];
  return intervals
    .map((item) => `${quantity(item.quantity)} ${item.movement}`)
    .join(" then ");
}

function recoveryNotes(value: Recovery, references: PaceReferences): string[] {
  const sequence = "components" in value && Array.isArray(value.components);
  const intervals =
    "components" in value && Array.isArray(value.components)
      ? value.components
      : [value as Exclude<Recovery, { components: unknown }>];
  return [
    ...(sequence ? value.coachText : []),
    ...intervals.flatMap((interval) => [
      ...(targets(interval.targets, references)
        ? [`Recovery target: ${targets(interval.targets, references)}`]
        : []),
      ...interval.coachText,
    ]),
  ];
}

function RecoveryNotes({
  value,
  references,
}: {
  value: Recovery;
  references: PaceReferences;
}) {
  return (
    <>
      {recoveryNotes(value, references).map((note, index) => (
        <p key={index}>{note}</p>
      ))}
    </>
  );
}

function recoveryAnchor(workout: Workout, id: string): string {
  for (const block of workout.blocks) {
    if (block.id === id) return `${block.role} block`;
    if (block.role === "recovery") continue;
    for (const set of block.sets) {
      if (set.id === id) return `${block.role} set ${set.index}`;
      const repetition = set.repetitions.find((item) => item.id === id);
      if (repetition)
        return `${block.role} set ${set.index} repetition ${repetition.index}`;
    }
  }
  return "the specified workout component";
}

function recoverySummary(workout: Workout): string[] {
  const result: string[] = [];
  for (const block of workout.blocks) {
    if (block.role === "recovery") {
      result.push(
        `After ${recoveryAnchor(workout, block.afterId)}: ${recovery(block.recovery)}`,
      );
      continue;
    }
    const repetitions = [
      ...new Set(
        block.sets.flatMap((set) =>
          set.repetitions.flatMap((rep) =>
            rep.recoveryAfter ? [recovery(rep.recoveryAfter)] : [],
          ),
        ),
      ),
    ];
    if (repetitions.length)
      result.push(
        `After selected ${block.role} repetitions: ${repetitions.join("; ")}`,
      );
    for (const set of block.sets) {
      if (set.recoveryAfter)
        result.push(
          `After ${block.role} set ${set.index}: ${recovery(set.recoveryAfter)}`,
        );
    }
    if (block.recoveryAfter)
      result.push(
        `After ${block.role} block: ${recovery(block.recoveryAfter)}`,
      );
  }
  return result;
}

function groupedSets(sets: WorkoutSet[]) {
  const groups: { set: WorkoutSet; count: number; signature: string }[] = [];
  for (const set of sets) {
    const { id: _id, index: _index, repetitions, ...details } = set;
    const signature = JSON.stringify({
      ...details,
      repetitions: repetitions.map(
        ({ id: _repId, index: _repIndex, ...rep }) => rep,
      ),
    });
    const previous = groups.at(-1);
    if (previous?.signature === signature) previous.count += 1;
    else groups.push({ set, count: 1, signature });
  }
  return groups;
}

/** Render only prescribed structure; missing targets, counts and recoveries stay missing. */
export function StructuredWorkout({
  workout,
  references = [],
}: {
  workout: Workout;
  references?: PaceReferences;
}) {
  return (
    <div className="f2-structure">
      <p>Workout structure: {workout.structureStatus}</p>
      {workout.blocks.map((block) =>
        block.role === "recovery" ? (
          <div key={block.id}>
            <p>
              Recovery after {recoveryAnchor(workout, block.afterId)}:{" "}
              {recovery(block.recovery)}
            </p>
            <RecoveryNotes value={block.recovery} references={references} />
            {block.coachText.map((text, i) => (
              <p key={i}>{text}</p>
            ))}
          </div>
        ) : (
          <div key={block.id}>
            <strong>{block.role}</strong>
            {block.coachText.map((text, i) => (
              <p key={i}>{text}</p>
            ))}
            {block.sets.map((set) => (
              <div key={set.id}>
                <p>Set {set.index}</p>
                <ul>
                  {set.repetitions.map((rep) => (
                    <li key={rep.id}>
                      {quantity(rep.quantity ?? set.quantity)}
                      {targets(rep.targets ?? set.targets, references) &&
                        ` · ${targets(rep.targets ?? set.targets, references)}`}
                      {set.hammerRepetitionIndices?.includes(rep.index) &&
                        " · Hammer"}
                      {rep.coachText.map((text) => ` · ${text}`)}
                      {rep.recoveryAfter &&
                        ` · Recovery after: ${recovery(rep.recoveryAfter)}`}
                      {rep.recoveryAfter && (
                        <RecoveryNotes
                          value={rep.recoveryAfter}
                          references={references}
                        />
                      )}
                    </li>
                  ))}
                </ul>
                {set.recoveryAfter && (
                  <p>Recovery after set: {recovery(set.recoveryAfter)}</p>
                )}
                {set.recoveryAfter && (
                  <RecoveryNotes
                    value={set.recoveryAfter}
                    references={references}
                  />
                )}
                {set.coachText.map((text, i) => (
                  <p key={i}>{text}</p>
                ))}
              </div>
            ))}
            {block.recoveryAfter && (
              <p>Recovery after block: {recovery(block.recoveryAfter)}</p>
            )}
            {block.recoveryAfter && (
              <RecoveryNotes
                value={block.recoveryAfter}
                references={references}
              />
            )}
          </div>
        ),
      )}
    </div>
  );
}

export function StructuredWorkoutSummary({
  workout,
  references = [],
}: {
  workout: Workout;
  references?: PaceReferences;
}) {
  return (
    <div className="f2-workout-summary" aria-label="Prescribed workout summary">
      {workout.blocks
        .filter((block) => block.role === "work" || block.role === "strides")
        .map(
          (block) =>
            block.role !== "recovery" && (
              <div key={block.id}>
                <strong>{block.role}</strong>
                {groupedSets(block.sets).map(({ set, count }) => (
                  <div key={set.id}>
                    {count > 1 && <p>Repeat {count} rounds</p>}
                    <div className="f2-repetitions">
                      {set.repetitions.map((rep) => (
                        <span key={rep.id}>
                          {quantity(rep.quantity ?? set.quantity)}
                          {targets(rep.targets ?? set.targets, references) &&
                            ` · ${targets(rep.targets ?? set.targets, references)}`}
                          {set.hammerRepetitionIndices?.includes(rep.index) &&
                            " · Hammer"}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ),
        )}
      {recoverySummary(workout).length > 0 && (
        <p className="f2-recovery-summary">
          {recoverySummary(workout).join(" · ")}
        </p>
      )}
    </div>
  );
}
