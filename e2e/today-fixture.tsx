import React from "react";
import { createRoot } from "react-dom/client";
import { AppProvider } from "../src/data/app-context";
import type { AppRepository } from "../src/data/repository";
import { activationCandidate } from "../src/domain/active-plan";
import { createInitialData } from "../src/domain/seed";
import { validateTrainingPlan } from "../src/domain/training-plan";
import fixture from "../src/domain/__fixtures__/training-plan/valid-workout.json";
import { TodayDashboard } from "../src/screens/TodayDashboard";
import "../src/styles.css";

const result = validateTrainingPlan(fixture);
if (!result.ok) throw new Error("Invalid synthetic fixture");
const data = activationCandidate(
  result.plan,
  createInitialData(),
  "visual-test",
  "2026-11-16",
  "2026-11-16T12:00:00Z",
);
const repository: AppRepository = {
  load: async () => structuredClone(data),
  save: async () => {},
  inspectActive: async () => ({
    activationId: "visual-test",
    effectiveDate: "2026-11-16",
    sourceBytes: new TextEncoder().encode(JSON.stringify(fixture)),
  }),
};
createRoot(document.getElementById("root")!).render(
  <AppProvider repository={repository}>
    <TodayDashboard openPlan={() => {}} openActivityReview={() => {}} />
  </AppProvider>,
);
