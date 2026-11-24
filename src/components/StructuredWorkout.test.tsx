import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { validateTrainingPlan } from "../domain/training-plan";
import fixture from "../domain/__fixtures__/training-plan/valid-workout.json";
import {
  StructuredWorkout,
  StructuredWorkoutSummary,
} from "./StructuredWorkout";

it("renders supplied repetition overrides and explicit recovery without inventing targets", () => {
  const result = validateTrainingPlan(fixture);
  if (!result.ok) throw new Error("Invalid synthetic fixture");
  const workout = result.plan.weeks[0].days[0].sessions[0].workout!;
  render(
    <>
      <StructuredWorkoutSummary
        workout={workout}
        references={result.plan.paceReferences}
      />
      <StructuredWorkout
        workout={workout}
        references={result.plan.paceReferences}
      />
    </>,
  );
  expect(screen.getAllByText(/400 m · Interval/).length).toBeGreaterThan(0);
  expect(
    screen.getAllByText(/400 m · Synthetic controlled effort/).length,
  ).toBeGreaterThan(0);
  expect(
    screen.getAllByText(/Recovery after set: 30 s walk then 200 m jog/)[0],
  ).toBeInTheDocument();
  expect(screen.getByText(/Recovery: 2 min walk/)).toBeInTheDocument();
});

it("compresses only consecutive identical rounds", () => {
  const result = validateTrainingPlan(fixture);
  if (!result.ok) throw new Error("Invalid synthetic fixture");
  const workout = structuredClone(
    result.plan.weeks[0].days[0].sessions[0].workout!,
  );
  const work = workout.blocks.find((block) => block.role === "work")!;
  if (work.role === "recovery") throw new Error("Expected work block");
  work.sets[1] = {
    ...structuredClone(work.sets[0]),
    id: "second-identical-set",
    index: 2,
  };
  render(
    <StructuredWorkoutSummary
      workout={workout}
      references={result.plan.paceReferences}
    />,
  );
  expect(screen.getByText("Repeat 2 rounds")).toBeInTheDocument();
});
