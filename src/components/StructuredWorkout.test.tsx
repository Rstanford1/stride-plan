import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { validateTrainingPlan } from "../domain/training-plan";
import fixture from "../domain/__fixtures__/training-plan/valid-workout.json";
import {
  StructuredWorkout,
  StructuredWorkoutSummary,
} from "./StructuredWorkout";

afterEach(cleanup);

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
  expect(
    screen.getByText(/Recovery after work block: 2 min walk/),
  ).toBeInTheDocument();
  const summary = screen.getByLabelText("Prescribed workout summary");
  expect(summary).toHaveTextContent(
    "After selected work repetitions: 90 s jog; 200 m jog",
  );
  expect(summary).toHaveTextContent(
    "After work set 1: 30 s walk then 200 m jog",
  );
  expect(summary.querySelector(".f2-repetitions")?.textContent).not.toContain(
    "Recovery after",
  );
  expect(
    screen.getByText("Between sets: 30 s walk, then 200 m jog."),
  ).toBeInTheDocument();
});

it("does not invent a recovery summary when none is prescribed", () => {
  const result = validateTrainingPlan(fixture);
  if (!result.ok) throw new Error("Invalid synthetic fixture");
  const workout = structuredClone(
    result.plan.weeks[0].days[0].sessions[0].workout!,
  );
  workout.blocks = workout.blocks.filter((block) => block.role !== "recovery");
  for (const block of workout.blocks) {
    if (block.role === "recovery") continue;
    delete block.recoveryAfter;
    for (const set of block.sets) {
      delete set.recoveryAfter;
      for (const repetition of set.repetitions) delete repetition.recoveryAfter;
    }
  }
  render(<StructuredWorkoutSummary workout={workout} />);
  expect(
    screen.getByLabelText("Prescribed workout summary"),
  ).not.toHaveTextContent("recovery");
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

it("keeps prescribed recovery targets and coach notes in the expanded detail", () => {
  const result = validateTrainingPlan(fixture);
  if (!result.ok) throw new Error("Invalid synthetic fixture");
  const workout = structuredClone(
    result.plan.weeks[0].days[0].sessions[0].workout!,
  );
  const block = workout.blocks.find((item) => item.role === "work")!;
  if (block.role === "recovery") throw new Error("Expected work block");
  const rest = block.sets[0].repetitions[0].recoveryAfter!;
  if ("components" in rest) throw new Error("Expected interval");
  rest.targets = [{ kind: "effort", text: "Gentle effort" }];
  rest.coachText = ["Keep this recovery easy."];
  render(
    <>
      <StructuredWorkoutSummary workout={workout} />
      <StructuredWorkout workout={workout} />
    </>,
  );
  expect(
    screen.getByLabelText("Prescribed workout summary"),
  ).not.toHaveTextContent("Gentle effort");
  expect(
    screen.getByText("Recovery target: Gentle effort"),
  ).toBeInTheDocument();
  expect(screen.getByText("Keep this recovery easy.")).toBeInTheDocument();
});

it("identifies the component a separate recovery block follows", () => {
  const result = validateTrainingPlan(fixture);
  if (!result.ok) throw new Error("Invalid synthetic fixture");
  const workout = structuredClone(
    result.plan.weeks[0].days[0].sessions[0].workout!,
  );
  const rest = workout.blocks.find((block) => block.role === "recovery")!;
  if (rest.role !== "recovery") throw new Error("Expected recovery block");
  rest.afterId = "rep-2";
  render(
    <>
      <StructuredWorkoutSummary workout={workout} />
      <StructuredWorkout workout={workout} />
    </>,
  );
  expect(screen.getByLabelText("Prescribed workout summary")).toHaveTextContent(
    "After work set 1 repetition 2: 2 min walk",
  );
  expect(
    screen.getByText("Recovery after work set 1 repetition 2: 2 min walk"),
  ).toBeInTheDocument();
});
