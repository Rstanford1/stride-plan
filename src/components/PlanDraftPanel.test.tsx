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
    recover: vi.fn().mockResolvedValue(saved),
  };
  return { saved, store };
}
async function select(bytes: Uint8Array) {
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
  await screen.findByText("Validation preview");
}
describe("T05 focused Data workflow", () => {
  it("previews errors and warnings, disables invalid save and exposes original instructions", async () => {
    const { saved, store } = await fixture();
    render(<PlanDraftPanel store={store} />);
    await screen.findByText("No draft saved.");
    await select(new TextEncoder().encode("not JSON"));
    expect(
      screen.getByRole("button", { name: "Save as draft" }),
    ).toBeDisabled();
    expect(screen.getByText(/not valid JSON/)).toBeVisible();
    await select(saved.preview.bytes);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Save as draft" }),
      ).toBeEnabled(),
    );
    expect(screen.getAllByText(/Warning ·/).length).toBeGreaterThan(0);
    expect(
      screen.getByText("Original JSON and raw instructions"),
    ).toHaveProperty("tagName", "SUMMARY");
    expect(store.save).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Select JSON plan file" }),
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
      screen.getByRole("button", { name: "Select JSON plan file" }),
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
});
