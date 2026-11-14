import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { AppProvider, useAppData } from "./app-context";
import {
  BrowserRepository,
  SerializedRepository,
  STORAGE_KEY,
  type AppRepository,
} from "./repository";
import App from "../App";
import { DataScreen } from "../screens/DataScreen";
import { createInitialData } from "../domain/seed";

beforeEach(() => {
  localStorage.clear();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(() => cleanup());
const old = () => JSON.stringify(createInitialData());
const candidate = () => {
  const data = createInitialData();
  data.sessions = [];
  return JSON.stringify(data);
};
function file(raw: string) {
  return { name: "synthetic.json", text: async () => raw };
}
async function preview(raw = candidate()) {
  fireEvent.change(screen.getByLabelText("Legacy JSON backup file"), {
    target: { files: [file(raw)] },
  });
  return screen.findByRole("dialog", { name: "Replace local data?" });
}
function DataHarness() {
  const { ready } = useAppData();
  return ready ? <DataScreen /> : <span>Opening</span>;
}

describe("loading recovery", () => {
  it.each([
    "{bad",
    JSON.stringify({ ...createInitialData(), schemaVersion: 6 }),
  ])("shows recovery, prevents all writes, and retries safely", async (raw) => {
    localStorage.setItem(STORAGE_KEY, raw);
    const storage = {
      getItem: vi.fn((key: string) => localStorage.getItem(key)),
      setItem: vi.fn((key: string, value: string) =>
        localStorage.setItem(key, value),
      ),
      removeItem: (key: string) => localStorage.removeItem(key),
    };
    let actions: ReturnType<typeof useAppData> | undefined;
    function Capture() {
      actions = useAppData();
      return <App />;
    }
    render(
      <AppProvider
        repository={new SerializedRepository(new BrowserRepository(storage))}
      >
        <Capture />
      </AppProvider>,
    );
    expect(
      await screen.findByRole("heading", {
        name: "Your saved data needs attention",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Opening your plan…")).not.toBeInTheDocument();
    act(() => {
      actions?.resetDemo();
      actions?.updateSettings({ easyHrHigh: 180 });
      actions?.replaceData(createInitialData());
    });
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(localStorage.getItem(STORAGE_KEY)).toBe(raw);
    localStorage.setItem(STORAGE_KEY, old());
    const retry = screen.getByRole("button", { name: "Retry loading" });
    retry.focus();
    expect(retry).toHaveFocus();
    fireEvent.click(retry);
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", {
          name: "Your saved data needs attention",
        }),
      ).not.toBeInTheDocument(),
    );
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});

describe("legacy restore confirmation", () => {
  function mount(
    repository: AppRepository = new SerializedRepository(
      new BrowserRepository(),
    ),
  ) {
    localStorage.setItem(STORAGE_KEY, old());
    render(
      <AppProvider repository={repository}>
        <DataHarness />
      </AppProvider>,
    );
    return screen.findByRole("heading", { name: "Data & settings" });
  }
  it("previews counts and incomplete-backup warning; cancellation changes nothing", async () => {
    await mount();
    const dialog = await preview();
    expect(
      within(dialog).getByText(/Legacy snapshot version 4/),
    ).toHaveTextContent("0 sessions");
    expect(
      within(dialog).getByText(/incomplete JSON backup/),
    ).toBeInTheDocument();
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    cancel.focus();
    expect(cancel).toHaveFocus();
    fireEvent.click(cancel);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEY)).toBe(old());
    expect(localStorage.length).toBe(1);
  });
  it("Escape cancels without replacing data", async () => {
    await mount();
    const dialog = await preview();
    fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEY)).toBe(old());
  });
  it("does not report success until persistence completes; busy dialog cannot be cancelled", async () => {
    let release: () => void = () => {};
    const repository: AppRepository = {
      load: async () => createInitialData(),
      save: async () => {},
      restore: vi.fn(async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return JSON.parse(candidate());
      }),
    };
    await mount(repository);
    const dialog = await preview();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Replace local data" }),
    );
    await waitFor(() => expect(repository.restore).toHaveBeenCalledOnce());
    expect(
      within(dialog).getByRole("button", { name: "Cancel" }),
    ).toBeDisabled();
    expect(
      screen.queryByText(/Legacy snapshot restored and saved/),
    ).not.toBeInTheDocument();
    fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
    expect(dialog).toHaveAttribute("open");
    await act(async () => release());
    expect(
      await screen.findByText(/Legacy snapshot restored and saved/),
    ).toBeInTheDocument();
  });
  it("invalid backup reports an error without replacement", async () => {
    await mount();
    fireEvent.change(screen.getByLabelText("Legacy JSON backup file"), {
      target: { files: [file("{bad")] },
    });
    expect(await screen.findByText(/not valid JSON/)).toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEY)).toBe(old());
  });
  it("missing original FIT files disable replacement", async () => {
    await mount();
    const data = createInitialData();
    data.fitSources = [
      {
        id: "s",
        sourceHash: "a".repeat(64),
        byteLength: 3,
        originalFileName: "synthetic.fit",
        importedAt: "2026-11-03T12:00:00Z",
        decoderId: "test",
        decoderVersion: "1",
        preservationStatus: "verified",
      },
    ];
    const dialog = await preview(JSON.stringify(data));
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "synthetic.fit",
    );
    expect(
      within(dialog).getByRole("button", { name: "Replace local data" }),
    ).toBeDisabled();
    expect(localStorage.getItem(STORAGE_KEY)).toBe(old());
  });
  it("successful confirmed replacement survives repository restart", async () => {
    await mount();
    const dialog = await preview();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Replace local data" }),
    );
    expect(
      await screen.findByText(/Legacy snapshot restored and saved/),
    ).toBeInTheDocument();
    expect((await new BrowserRepository().load()).sessions).toEqual([]);
  });
});

it("confirmation preserves exact already-durable bytes without a redundant pre-restore rewrite", async () => {
  const original = JSON.stringify(createInitialData(), null, 2);
  localStorage.setItem(STORAGE_KEY, original);
  render(
    <AppProvider repository={new SerializedRepository(new BrowserRepository())}>
      <DataHarness />
    </AppProvider>,
  );
  await screen.findByRole("heading", { name: "Data & settings" });
  const dialog = await preview();
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Replace local data" }),
  );
  await screen.findByText(/Legacy snapshot restored and saved/);
  const keys = Array.from({ length: localStorage.length }, (_, i) =>
    localStorage.key(i),
  );
  const safetyKey = keys.find((key) => key?.includes(":before-restore:"));
  expect(localStorage.getItem(safetyKey!)).toBe(original);
});
