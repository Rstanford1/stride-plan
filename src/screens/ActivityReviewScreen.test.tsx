import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppProvider, useAppData } from "../data/app-context";
import type { AppRepository } from "../data/repository";
import { createInitialData } from "../domain/seed";
import type { AppData } from "../domain/types";
import { ActivityReviewScreen } from "./ActivityReviewScreen";

function ReadyGate({ children }: { children: React.ReactNode }) {
  return useAppData().ready ? children : null;
}

function seedImportedRun(withPossibleDuplicate = false) {
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
    recordCount: 2,
    laps: [],
    samples: [
      {
        id: "sample-1",
        sourceIndex: 0,
        elapsedSeconds: 0,
        distanceMeters: 0,
        speedMetersPerSecond: 3,
        heartRate: 145,
      },
      {
        id: "sample-2",
        sourceIndex: 1,
        elapsedSeconds: 3_600,
        distanceMeters: 11_265.408,
        speedMetersPerSecond: 3.2,
        heartRate: 155,
      },
    ],
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
  if (withPossibleDuplicate) {
    data.activities.push({
      id: "existing-screen-activity",
      sourceHash: "existing",
      fileName: "existing.fit",
      occurredAt: "2026-11-08T15:00:00.000Z",
      distanceMiles: 7,
      durationSeconds: 3_600,
      role: "primary-long",
      plannedSessionId: "plan-w1-d7",
      isPrimary: true,
      importedAt: "2026-11-08T15:30:00.000Z",
      laps: [],
    });
  }
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
    fireEvent.click(screen.getByRole("button", { name: "Confirm all 1" }));
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

  it("provides keyboard-complete segment creation and boundary editing", async () => {
    render(
      <AppProvider>
        <ReadyGate>
          <ActivityReviewScreen />
        </ReadyGate>
      </AppProvider>,
    );
    await screen.findByRole("img", {
      name: "Recorded pace by distance; faster pace appears higher",
    });
    fireEvent.change(
      screen.getByRole("combobox", { name: "Optional overlay" }),
      { target: { value: "heartRate" } },
    );
    expect(document.querySelector(".metric-overlay")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create one segment" }));
    fireEvent.click(screen.getByRole("button", { name: "Split segment" }));
    const boundary = screen.getByRole("spinbutton", {
      name: "Boundary 1 time in seconds",
    });
    fireEvent.click(screen.getByRole("button", { name: "Select segment 1" }));
    expect(boundary.closest(".segment-card")).toHaveClass("selected");
    fireEvent.change(boundary, { target: { value: "1700" } });
    expect(boundary).toHaveValue(1700);
    expect(screen.getByText("Boundary 1 moved to 28:20.")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Move boundary 1 forward 5 seconds" }),
    );
    expect(boundary).toHaveValue(1705);
    fireEvent.keyDown(
      screen.getByRole("slider", { name: "Boundary 1 on graph" }),
      { key: "ArrowRight" },
    );
    expect(boundary).toHaveValue(1706);
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByRole("button", { name: "Pan right" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
  });

  it("blocks a possible duplicate until the record choice is explicit", async () => {
    cleanup();
    window.localStorage.clear();
    seedImportedRun(true);
    render(
      <AppProvider>
        <ReadyGate>
          <ActivityReviewScreen />
        </ReadyGate>
      </AppProvider>,
    );
    expect(
      await screen.findByRole("heading", {
        name: "Choose which record represents this run",
      }),
    ).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: "Confirm all 1" });
    expect(confirm).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Use existing activity" }),
    );
    expect(confirm).toBeEnabled();
  });

  it("surfaces a local save failure and safely retries the current draft", async () => {
    const seeded = JSON.parse(
      window.localStorage.getItem("stride-plan:data:v1") ?? "{}",
    ) as AppData;
    let allowSave = false;
    let saved: AppData | undefined;
    const repository: AppRepository = {
      load: async () => seeded,
      save: async (data) => {
        if (!allowSave) throw new Error("Test disk unavailable");
        saved = structuredClone(data);
      },
    };
    render(
      <AppProvider repositoryOverride={repository}>
        <ReadyGate>
          <ActivityReviewScreen />
        </ReadyGate>
      </AppProvider>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Test disk unavailable",
    );
    allowSave = true;
    fireEvent.click(screen.getByRole("button", { name: "Retry save" }));
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
    expect(saved?.activityReviewDrafts).toHaveLength(1);
  });
});
