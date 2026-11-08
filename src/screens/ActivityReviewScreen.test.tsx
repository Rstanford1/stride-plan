import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppProvider, useAppData } from "../data/app-context";
import { createInitialData } from "../domain/seed";
import { ActivityReviewScreen } from "./ActivityReviewScreen";

function ReadyGate({ children }: { children: React.ReactNode }) {
  return useAppData().ready ? children : null;
}

function seedImportedRun() {
  const data = createInitialData();
  data.fitSources.push({
    id: "fit-source:screen-test",
    sourceHash: "b".repeat(64),
    originalFileName: "screen-test.fit",
    byteLength: 100,
    importedAt: "2026-11-08T16:00:00.000Z",
    decoderId: "test",
    decoderVersion: "1",
    preservationStatus: "verified",
  });
  data.fitSourceActivities.push({
    id: "fit-activity:screen-test:0",
    sourceId: "fit-source:screen-test",
    sourceIndex: 0,
    occurredAt: "2026-11-08T15:00:00.000Z",
    localDate: "2026-11-08",
    sport: "running",
    distanceMeters: 11_265.408,
    durationSeconds: 3_600,
    averageHr: 151,
    recordCount: 0,
    laps: [],
    samples: [],
  });
  data.fitImportBatches.push({
    id: "fit-batch:screen-test",
    createdAt: "2026-11-08T16:00:00.000Z",
    completedAt: "2026-11-08T16:00:01.000Z",
    sourceResults: [
      {
        sourceId: "fit-source:screen-test",
        status: "decoded",
        activityIds: ["fit-activity:screen-test:0"],
      },
    ],
  });
  window.localStorage.setItem("stride-plan:data:v1", JSON.stringify(data));
}

beforeEach(() => {
  window.localStorage.clear();
  seedImportedRun();
});
afterEach(cleanup);

describe("Activity Review screen", () => {
  it("shows an editable suggestion and confirms it atomically", async () => {
    render(
      <AppProvider>
        <ReadyGate>
          <ActivityReviewScreen />
        </ReadyGate>
      </AppProvider>,
    );
    expect(
      await screen.findByRole("heading", { name: "Draft import" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Why this match was suggested"),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("combobox", { name: "Activity role" }),
    ).toHaveValue("primary-long");
    fireEvent.click(screen.getByRole("button", { name: "Confirm review" }));
    expect(
      await screen.findByRole("heading", { name: "Reviewed import" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revise review" })).toBeEnabled();

    await waitFor(() => {
      const stored = JSON.parse(
        window.localStorage.getItem("stride-plan:data:v1") ?? "{}",
      ) as ReturnType<typeof createInitialData>;
      expect(stored.activities[0]).toMatchObject({
        sourceActivityId: "fit-activity:screen-test:0",
        role: "primary-long",
        plannedSessionId: "plan-w1-d7",
      });
      expect(stored.sessions[6].status).toBe("completed");
      expect(stored.shoes[0].mileageMiles).toBeCloseTo(7);
    });
  });
});
