import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlanDraftPanel } from "./PlanDraftPanel";
import type { DraftStore } from "../data/plan-draft-store";
import { syntheticDraft } from "../test/plan-draft-fixture";
afterEach(cleanup);
async function fixture() {
  const saved = await syntheticDraft();
  const store: DraftStore = {
    inspect: vi.fn().mockResolvedValue({
      contractVersion: 1,
      snapshot: "synthetic",
      draft: null,
    }),
    save: vi.fn().mockResolvedValue(saved),
    read: vi.fn().mockResolvedValue(saved),
    exportRecovery: vi.fn(),
    saveRecovery: vi
      .fn()
      .mockResolvedValue({ contractVersion: 1, status: "cancelled" }),
    recover: vi.fn().mockResolvedValue(saved),
  };
  return { saved, store };
}
async function select(bytes: Uint8Array) {
  fireEvent.click(screen.getByRole("tab", { name: "Import" }));
  fireEvent.change(screen.getByLabelText("JSON training-plan file"), {
    target: {
      files: [
        {
          name: "synthetic-plan.json",
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
describe("T05 focused Data workflow", () => {
  it.each(["coach.xlsx", "coach.xls", "coach.csv", "coach.PDF", "coach.ods"])(
    "rejects unsupported %s before reading bytes and retains a prior valid preview",
    async (name) => {
      const { saved, store } = await fixture();
      render(<PlanDraftPanel store={store} />);
      await screen.findByText("No draft saved.");
      await select(saved.preview.bytes);
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Save as draft" }),
        ).toBeEnabled(),
      );
      fireEvent.click(screen.getByRole("tab", { name: "Import" }));
      const arrayBuffer = vi.fn();
      fireEvent.change(screen.getByLabelText("JSON training-plan file"), {
        target: { files: [{ name, size: 100, arrayBuffer }] },
      });
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Unsupported plan format. Stride Plan accepts Training Plan JSON 1.1 files (.json).",
      );
      expect(screen.getByRole("alert")).toHaveTextContent("external AI agent");
      expect(screen.getByRole("alert")).toHaveTextContent(
        "PDF conversion guidance remains pending provenance review",
      );
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Do not mislabel a PDF or invent provenance.",
      );
      expect(arrayBuffer).not.toHaveBeenCalled();
      expect(store.save).not.toHaveBeenCalled();
      expect(screen.getByText("Validation preview")).not.toBeVisible();
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Select JSON plan file" }),
        ).toHaveFocus(),
      );
      fireEvent.click(screen.getByRole("tab", { name: "Review" }));
      expect(screen.getByText("Validation preview")).toBeVisible();
      await select(saved.preview.bytes);
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Save as draft" }),
        ).toBeEnabled(),
      );
      expect(screen.queryByRole("alert")).toBeNull();
    },
  );

  it("accepts uppercase JSON filenames even with an unspecified MIME type", async () => {
    const { saved, store } = await fixture();
    render(<PlanDraftPanel store={store} />);
    await screen.findByText("No draft saved.");
    fireEvent.click(screen.getByRole("tab", { name: "Import" }));
    fireEvent.change(screen.getByLabelText("JSON training-plan file"), {
      target: {
        files: [
          {
            name: "COACH.JSON",
            size: saved.preview.bytes.length,
            type: "",
            arrayBuffer: async () =>
              Uint8Array.from(saved.preview.bytes).buffer,
          },
        ],
      },
    });
    await screen.findByText("Validation preview");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Save as draft" }),
      ).toBeEnabled(),
    );
  });

  it("previews errors and warnings, disables invalid save and exposes original instructions", async () => {
    const { saved, store } = await fixture();
    render(<PlanDraftPanel store={store} />);
    await screen.findByText("No draft saved.");
    await select(new TextEncoder().encode("not JSON"));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "cannot be read as JSON",
    );
    fireEvent.click(screen.getByRole("tab", { name: "Review" }));
    expect(
      screen.getByRole("button", { name: "Save as draft" }),
    ).toBeDisabled();
    await select(saved.preview.bytes);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Save as draft" }),
      ).toBeEnabled(),
    );
    expect(
      screen.getAllByText("Warning", { exact: true }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText("Original JSON and raw instructions"),
    ).toHaveProperty("tagName", "SUMMARY");
    expect(store.save).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Review & Save Draft" }),
      ).toHaveFocus(),
    );
  });
  it("keeps keyboard focus on save, blocks repeated actions until acknowledgement, and reopens after remount", async () => {
    const { saved, store } = await fixture();
    const presence = vi.fn();
    let finish: (value: typeof saved) => void = () => {};
    vi.mocked(store.save).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(<PlanDraftPanel store={store} onPresence={presence} />);
    await screen.findByText("No draft saved.");
    await select(saved.preview.bytes);
    const button = screen.getByRole("button", { name: "Save as draft" });
    await waitFor(() => expect(button).toBeEnabled());
    button.focus();
    expect(button).toHaveFocus();
    fireEvent.click(button);
    expect(
      screen.getByRole("button", { name: "Save as draft" }),
    ).toBeDisabled();
    expect(screen.getByText("Saving and verifying draft…")).toBeVisible();
    expect(screen.queryByText(/Draft saved and verified/)).toBeNull();
    await act(async () => {
      finish(saved);
    });
    expect(presence).toHaveBeenLastCalledWith(true);
    view.unmount();
    vi.mocked(store.inspect).mockResolvedValue({
      contractVersion: 1,
      snapshot: "synthetic",
      draft: saved.record,
    });
    render(<PlanDraftPanel store={store} />);
    await screen.findByText("A saved draft is available to reopen.");
    fireEvent.click(screen.getByRole("button", { name: "Reopen saved draft" }));
    await screen.findByText("Saved draft reopened and verified.");
    expect(store.read).toHaveBeenCalledOnce();
  });
  it.each([
    "A different draft is already saved. Nothing was overwritten.",
    "The pre-migration safety copy could not be verified. Migration stopped.",
  ])(
    "shows readable failure and leaves retry available: %s",
    async (message) => {
      const { saved, store } = await fixture();
      vi.mocked(store.save).mockRejectedValue(new Error(message));
      render(<PlanDraftPanel store={store} />);
      await screen.findByText("No draft saved.");
      await select(saved.preview.bytes);
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Save as draft" }),
        ).toBeEnabled(),
      );
      fireEvent.click(screen.getByRole("button", { name: "Save as draft" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      expect(
        screen.getByRole("button", { name: "Save as draft" }),
      ).toBeEnabled();
    },
  );
  it("offers browser preview without claiming native persistence", async () => {
    const { saved } = await fixture();
    render(<PlanDraftPanel store={null} />);
    await select(saved.preview.bytes);
    expect(screen.getByText(/Browser preview only/)).toBeVisible();
    for (const name of [
      "Save as draft",
      "Reopen saved draft",
      "Export draft recovery",
      "Import draft recovery",
    ])
      expect(screen.getByRole("button", { name })).toBeDisabled();
  });
  it("shows a nearby saved location only after native acknowledgement and restores focus", async () => {
    const { saved, store } = await fixture();
    vi.mocked(store.inspect).mockResolvedValue({
      contractVersion: 1,
      snapshot: "synthetic",
      draft: saved.record,
    });
    let finish: (
      value: Awaited<ReturnType<DraftStore["saveRecovery"]>>,
    ) => void = () => {};
    vi.mocked(store.saveRecovery).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<PlanDraftPanel store={store} />);
    const button = await screen.findByRole("button", {
      name: "Export draft recovery",
    });
    await waitFor(() => expect(button).toBeEnabled());
    button.focus();
    fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(screen.queryByText(/Recovery saved to/)).toBeNull();
    expect(
      screen.getByText("Choose where to save the recovery file…"),
    ).toBeVisible();
    await act(async () => {
      finish({
        contractVersion: 1,
        status: "saved",
        path: "D:\\Synthetic exports\\chosen-name.json",
      });
    });
    const confirmation = screen.getByText(
      "Recovery saved to D:\\Synthetic exports\\chosen-name.json",
    );
    expect(confirmation.parentElement).toContainElement(button);
    expect(button).toHaveAttribute("aria-describedby", confirmation.id);
    await waitFor(() => expect(button).toHaveFocus());
    expect(store.exportRecovery).not.toHaveBeenCalled();
  });
  it("clears earlier success when another export is cancelled", async () => {
    const { saved, store } = await fixture();
    vi.mocked(store.inspect).mockResolvedValue({
      contractVersion: 1,
      snapshot: "synthetic",
      draft: saved.record,
    });
    vi.mocked(store.saveRecovery)
      .mockResolvedValueOnce({
        contractVersion: 1,
        status: "saved",
        path: "D:\\synthetic.json",
      })
      .mockResolvedValueOnce({ contractVersion: 1, status: "cancelled" });
    render(<PlanDraftPanel store={store} />);
    const button = screen.getByRole("button", {
      name: "Export draft recovery",
    });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await screen.findByText(/Recovery saved to/);
    fireEvent.click(button);
    await screen.findByText("Export cancelled. No recovery file was saved.");
    expect(screen.queryByText(/Recovery saved to/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it.each([
    "Recovery could not be saved and verified. Check folder permissions and free disk space, then retry.",
    "The recovery file could not be verified. A file may exist at the selected location; no successful save was confirmed.",
  ])(
    "shows export failure beside its control without false success: %s",
    async (message) => {
      const { saved, store } = await fixture();
      vi.mocked(store.inspect).mockResolvedValue({
        contractVersion: 1,
        snapshot: "synthetic",
        draft: saved.record,
      });
      vi.mocked(store.saveRecovery).mockRejectedValue(new Error(message));
      render(<PlanDraftPanel store={store} />);
      const button = screen.getByRole("button", {
        name: "Export draft recovery",
      });
      await waitFor(() => expect(button).toBeEnabled());
      fireEvent.click(button);
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(message);
      expect(alert.parentElement).toContainElement(button);
      expect(screen.queryByText(/Recovery saved to/)).toBeNull();
      expect(button).toBeEnabled();
    },
  );
});
