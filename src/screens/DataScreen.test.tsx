import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DataScreen } from "./DataScreen";
import { AppProvider } from "../data/app-context";
import { BrowserRepository, STORAGE_KEY } from "../data/repository";
import { createInitialData } from "../domain/seed";
import { parseBackup, serializeBackup } from "../domain/backup";
import { syntheticDraft } from "../test/plan-draft-fixture";

afterEach(cleanup);

it("offers JSON-only plan intake without changing legacy imported sessions or training history", async () => {
  const legacy = createInitialData();
  // Synthetic record in the shape produced by the retired workbook importer.
  Object.assign(legacy.sessions[0], {
    id: "import-a251d2fcc8-1",
    sourceKey: "plan:2026-11-02:legacy recovery",
    originalDistanceMiles: 3,
    plannedDistanceMiles: 2,
    status: "modified",
    revisions: [
      {
        id: "legacy-revision",
        changedAt: "2026-11-02T18:00:00Z",
        field: "plannedDistanceMiles",
        from: 3,
        to: 2,
        reason: "Synthetic revision",
      },
    ],
  });
  legacy.journals.push({
    id: "legacy-journal",
    sessionId: legacy.sessions[0].id,
    date: "2026-11-02",
    actualDistanceMiles: 2,
    note: "Synthetic history",
    updatedAt: "2026-11-02T19:00:00Z",
  });
  const raw = serializeBackup(legacy);
  const values = new Map([[STORAGE_KEY, raw]]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
  };
  const repository = new BrowserRepository(storage);
  await expect(repository.load()).resolves.toEqual(legacy);
  render(
    <AppProvider repository={repository}>
      <DataScreen />
    </AppProvider>,
  );
  expect(
    screen.getByRole("button", { name: "Select JSON plan file" }),
  ).toBeEnabled();
  expect(screen.getByLabelText("JSON training-plan file")).toHaveAttribute(
    "accept",
    ".json,application/json",
  );
  expect(screen.queryByText("CSV or Excel.", { exact: false })).toBeNull();
  expect(document.querySelector('input[accept*=".xlsx"]')).toBeNull();
  expect(
    screen.getByRole("heading", { name: "Import FIT activities" }),
  ).toBeVisible();
  expect(screen.getByRole("heading", { name: "Garmin Connect" })).toBeVisible();
  fireEvent.change(screen.getByLabelText("JSON training-plan file"), {
    target: { files: [{ name: "coach.pdf", size: 4, arrayBuffer: vi.fn() }] },
  });
  await screen.findByRole("alert");
  const { preview } = await syntheticDraft();
  fireEvent.change(screen.getByLabelText("JSON training-plan file"), {
    target: {
      files: [
        {
          name: "synthetic.json",
          size: preview.bytes.length,
          arrayBuffer: async () => Uint8Array.from(preview.bytes).buffer,
        },
      ],
    },
  });
  await screen.findByText("Validation preview");
  await waitFor(() => expect(screen.getByText(/Plan validated/)).toBeVisible());
  expect(screen.getByRole("button", { name: "Save as draft" })).toBeDisabled();
  expect(values.get(STORAGE_KEY)).toBe(raw);
  expect(storage.setItem).not.toHaveBeenCalled();
  expect(storage.removeItem).not.toHaveBeenCalled();
  expect(await new BrowserRepository(storage).load()).toEqual(legacy);
  expect(parseBackup(serializeBackup(legacy))).toEqual(legacy);
});
