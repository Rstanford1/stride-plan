import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlanDraftPanel } from "./PlanDraftPanel";
import { syntheticDraft } from "../test/plan-draft-fixture";
import type { DraftStore } from "../data/plan-draft-store";
import {
  conversionPrompt,
  originalConversionPrompt,
} from "../domain/plan-conversion-prompt";
import { validationFeedback } from "../domain/plan-conversion";
import { parseTrainingPlan } from "../domain/training-plan-validation";
import { saveConversionFile } from "../data/plan-conversion-files";
import independent from "../domain/__fixtures__/training-plan/valid-independent.json";

vi.mock("../data/plan-conversion-files", () => ({
  saveConversionFile: vi.fn(),
}));
Object.defineProperty(navigator, "clipboard", {
  configurable: true,
  get: () => undefined,
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const tab = (name: string) => screen.getByRole("tab", { name });
async function setup(occupied = false) {
  const saved = await syntheticDraft();
  const store: DraftStore = {
    inspect: vi.fn().mockResolvedValue({
      contractVersion: 1,
      snapshot: "synthetic",
      draft: occupied ? saved.record : null,
    }),
    save: vi.fn().mockResolvedValue(saved),
    read: vi.fn().mockResolvedValue(saved),
    exportRecovery: vi.fn(),
    saveRecovery: vi.fn(),
    recover: vi.fn(),
  };
  render(<PlanDraftPanel store={store} />);
  await screen.findByText(
    occupied ? "A saved draft is available to reopen." : "No draft saved.",
  );
  return { saved, store };
}
async function select(name: string, bytes: Uint8Array) {
  fireEvent.click(tab("Import"));
  fireEvent.change(screen.getByLabelText("JSON training-plan file"), {
    target: {
      files: [
        {
          name,
          size: bytes.length,
          arrayBuffer: async () => Uint8Array.from(bytes).buffer,
        },
      ],
    },
  });
  await waitFor(() =>
    expect(screen.queryByText("Validating plan…")).toBeNull(),
  );
}

describe("T07 guided conversion", () => {
  it("opens Review and offers explicit saving for a valid plan without warnings", async () => {
    const { store } = await setup();
    await select(
      "clean.json",
      new TextEncoder().encode(JSON.stringify(independent)),
    );
    expect(tab("Review")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("No validation warnings.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Save as draft" })).toBeEnabled();
    expect(store.save).not.toHaveBeenCalled();
  });
  it("exposes five freely navigable tabs with arrow, Home, End and wrapping keyboard focus", async () => {
    await setup();
    expect(screen.getAllByRole("tab").map((item) => item.textContent)).toEqual([
      "Start",
      "Get files",
      "Use AI",
      "Import",
      "Review",
    ]);
    tab("Start").focus();
    for (const [key, target] of [
      ["ArrowRight", "Get files"],
      ["ArrowRight", "Use AI"],
      ["End", "Review"],
      ["ArrowRight", "Start"],
      ["ArrowLeft", "Review"],
      ["Home", "Start"],
    ]) {
      fireEvent.keyDown(document.activeElement!, { key });
      expect(tab(target)).toHaveFocus();
      expect(tab(target)).toHaveAttribute("aria-selected", "true");
      expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
      expect(screen.getByRole("tabpanel")).toHaveAttribute(
        "aria-labelledby",
        tab(target).id,
      );
    }
  });

  it("bypasses conversion via Start and never saves or transmits on selection/navigation", async () => {
    const { saved, store } = await setup();
    const network = vi.fn();
    vi.stubGlobal("fetch", network);
    fireEvent.click(screen.getByRole("button", { name: "Import JSON File →" }));
    expect(tab("Import")).toHaveAttribute("aria-selected", "true");
    await select("ready.json", saved.preview.bytes);
    expect(tab("Review")).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("heading", { name: "Review & Save Draft" }),
    ).toHaveFocus();
    expect(screen.getByText("Reviewing: ready.json")).toBeVisible();
    fireEvent.click(tab("Start"));
    fireEvent.click(tab("Review"));
    expect(screen.getByText("Reviewing: ready.json")).toBeVisible();
    expect(store.save).not.toHaveBeenCalled();
    expect(store.recover).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  });

  it("offers exactly two separate downloads, reports cancellation and preserves focus", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: "Get Started →" }));
    const panel = screen.getByRole("tabpanel");
    expect(
      within(panel)
        .getAllByRole("button")
        .map((item) => item.textContent),
    ).toEqual([
      "Download JSON Schema",
      "Download Example Plan",
      "Next: Use AI →",
    ]);
    vi.mocked(saveConversionFile)
      .mockResolvedValueOnce("Download cancelled. No file was saved.")
      .mockResolvedValueOnce(
        "File saved and verified: D:\\synthetic-example.json",
      );
    const schema = screen.getByRole("button", { name: "Download JSON Schema" });
    schema.focus();
    fireEvent.click(schema);
    await screen.findByText("Download cancelled. No file was saved.");
    expect(schema).toHaveFocus();
    fireEvent.click(
      screen.getByRole("button", { name: "Download Example Plan" }),
    );
    await screen.findByText(/File saved and verified/);
    expect(saveConversionFile).toHaveBeenNthCalledWith(1, "schema");
    expect(saveConversionFile).toHaveBeenNthCalledWith(2, "example");
  });

  it("shows all four instructions together and explicitly copies the entire original prompt plus contract clarifications", async () => {
    await setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(navigator, "clipboard", "get").mockReturnValue({
      writeText,
    } as unknown as Clipboard);
    fireEvent.click(tab("Use AI"));
    expect(
      within(screen.getByRole("list")).getAllByRole("listitem"),
    ).toHaveLength(4);
    expect(
      screen.getByText(/Stride Plan does not send the document/),
    ).toBeVisible();
    expect(
      screen.getByText(/PDF-specific conversion guidance remains pending/),
    ).toBeVisible();
    const copy = screen.getByRole("button", { name: "Copy AI Instructions" });
    copy.focus();
    fireEvent.click(copy);
    await screen.findByText(/AI instructions copied/);
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith(conversionPrompt);
    expect(conversionPrompt.startsWith(originalConversionPrompt)).toBe(true);
    expect(copy).toHaveFocus();
  });

  it("allows clipboard retry after failure without false success", async () => {
    await setup();
    const writeText = vi
      .fn()
      .mockRejectedValueOnce(new Error("Clipboard unavailable."))
      .mockResolvedValueOnce(undefined);
    vi.spyOn(navigator, "clipboard", "get").mockReturnValue({
      writeText,
    } as unknown as Clipboard);
    fireEvent.click(tab("Use AI"));
    const copy = screen.getByRole("button", { name: "Copy AI Instructions" });
    copy.focus();
    fireEvent.click(copy);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Clipboard unavailable.",
    );
    expect(screen.queryByText(/AI instructions copied/)).toBeNull();
    expect(copy).toHaveFocus();
    expect(copy).toBeEnabled();
    fireEvent.click(copy);
    await screen.findByText(/AI instructions copied/);
  });

  it("keeps invalid JSON on Import and copies exact actual schema errors and useful correction instructions", async () => {
    await setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(navigator, "clipboard", "get").mockReturnValue({
      writeText,
    } as unknown as Clipboard);
    const text = '{"schemaVersion":"1.1"}';
    await select("private-name.json", new TextEncoder().encode(text));
    expect(tab("Import")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "A required field is missing at /manifest.",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Copy Validation Feedback for AI" }),
    );
    await screen.findByText(/Validation feedback copied/);
    const actual = parseTrainingPlan(text).diagnostics;
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith(validationFeedback(actual));
    expect(writeText.mock.calls[0][0]).toContain(
      "ERROR [schema.required] /manifest: A required field is missing.",
    );
    expect(writeText.mock.calls[0][0]).not.toContain("private-name.json");
    fireEvent.click(tab("Review"));
    expect(
      screen.getByRole("button", { name: "Save as draft" }),
    ).toBeDisabled();
  });

  it("retains candidate A, failed filename B and saved draft separately; saving can only use A", async () => {
    const { saved, store } = await setup(true);
    const before = JSON.stringify(saved);
    await select("candidate-a.json", saved.preview.bytes);
    expect(screen.getByRole("button", { name: "Save as draft" })).toBeEnabled();
    expect(screen.getByText(/Warnings are nonblocking/)).toBeVisible();
    await select("failed-b.json", new TextEncoder().encode("not JSON"));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not import: failed-b.json",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "valid preview of candidate-a.json",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Invalid JSON syntax");
    expect(store.save).not.toHaveBeenCalled();
    expect(screen.getByText(/Saved draft: synthetic-plan.json/)).toBeVisible();
    fireEvent.click(tab("Review"));
    expect(screen.getByText("Reviewing: candidate-a.json")).toBeVisible();
    fireEvent.click(tab("Import"));
    expect(screen.getByRole("alert")).toHaveTextContent("failed-b.json");
    fireEvent.click(tab("Review"));
    fireEvent.click(screen.getByRole("button", { name: "Save as draft" }));
    await screen.findByText(/Draft saved and verified/);
    expect(store.save).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: "candidate-a.json",
        bytes: saved.preview.bytes,
        sourceHash: saved.preview.sourceHash,
      }),
      saved.record,
    );
    expect(JSON.stringify(saved)).toBe(before);
    expect(store.recover).not.toHaveBeenCalled();
  });

  it("identifies blocking semantics separately from schema errors and supports retry of the same filename", async () => {
    const { saved, store } = await setup();
    const plan = JSON.parse(
      new TextDecoder().decode(saved.preview.bytes).replace(/^\uFEFF/, ""),
    );
    plan.calendar.startDate = "2026-02-30";
    await select("retry.json", new TextEncoder().encode(JSON.stringify(plan)));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Blocking validation error",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "real Gregorian calendar date",
    );
    expect(store.save).not.toHaveBeenCalled();
    await select("retry.json", saved.preview.bytes);
    expect(tab("Review")).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
