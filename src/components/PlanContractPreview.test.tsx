import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PlanContractPreview } from "./PlanContractPreview";
import twelve from "../domain/__fixtures__/training-plan/valid-1.2-75plus.json";
import eleven from "../domain/__fixtures__/training-plan/valid-independent.json";
import type { Plan11, Plan12 } from "../domain/training-plan-contract";
afterEach(cleanup);
describe("read-only contract review", () => {
  it("shows independent units, original dates, fixed priority, movable supporting mileage and optional double, with policy separately attributed", () => {
    render(<PlanContractPreview plan={twelve as Plan12} />);
    const summary = screen.getByText(/Weekly targets, scheduling and priority/);
    fireEvent.click(summary);
    expect(
      screen.getByText(/Total mileage target: 75–85 mi/),
    ).toHaveTextContent("Coach source evidence");
    expect(screen.getAllByText(/Scheduling: Fixed date/)).toHaveLength(3);
    expect(screen.getAllByText(/^Priority: Priority/)).toHaveLength(3);
    expect(
      screen.getAllByText(/Scheduling: Movable within this week/),
    ).toHaveLength(4);
    expect(
      screen.getByText(/double · optional · flexible/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Synthetic user approval:/)).toBeInTheDocument();
    expect(
      screen.getByText(/does not verify who approved/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
  it("keeps legacy metadata uninterpreted and missing fields visibly unknown", () => {
    const plan = structuredClone(eleven) as Plan11;
    Object.assign(plan.weeks[0], {
      totalMileageTarget: { value: 999, unit: "mi" },
    });
    render(<PlanContractPreview plan={plan} />);
    fireEvent.click(screen.getByText(/Weekly targets/));
    expect(
      screen.getByText("Total mileage target: Not specified"),
    ).toBeInTheDocument();
    expect(screen.getByText("Scheduling: Not specified")).toBeInTheDocument();
    expect(screen.getByText("Priority: Not specified")).toBeInTheDocument();
    expect(screen.queryByText(/999/)).not.toBeInTheDocument();
  });
});
