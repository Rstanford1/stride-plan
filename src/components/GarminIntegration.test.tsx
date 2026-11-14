import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GarminIntegration } from "./GarminIntegration";
import { garmin, garminError } from "../data/garmin";

vi.mock("../data/garmin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../data/garmin")>();
  return {
    ...actual,
    garmin: {
      available: vi.fn(),
      openKeyPage: vi.fn(),
      status: vi.fn(),
      connect: vi.fn(),
      verify: vi.fn(),
      disconnect: vi.fn(),
      list: vi.fn(),
      retrieve: vi.fn(),
      cancel: vi.fn(),
    },
  };
});
const disconnected = {
  credentialStored: false,
  lastVerifiedAt: null,
  verifiedThisSession: false,
};
const connected = {
  credentialStored: true,
  lastVerifiedAt: 1794672000,
  verifiedThisSession: true,
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(garmin.available).mockReturnValue(true);
  vi.mocked(garmin.status).mockResolvedValue(disconnected);
  vi.mocked(garmin.cancel).mockResolvedValue();
  vi.mocked(garmin.openKeyPage).mockResolvedValue();
});
afterEach(cleanup);
async function ready() {
  render(<GarminIntegration />);
  await screen.findByText("Disconnected");
}

describe("Garmin connection", () => {
  it("opens only the fixed official key page through the desktop command", async () => {
    await ready();
    fireEvent.click(
      screen.getByRole("link", { name: /Create a Garmin Personal API key/ }),
    );
    expect(garmin.openKeyPage).toHaveBeenCalledWith();
  });
  it("does not connect from browser development or perform startup network verification", () => {
    vi.mocked(garmin.available).mockReturnValue(false);
    render(<GarminIntegration />);
    expect(
      screen.getByText(/Available in the Windows desktop app/),
    ).toBeVisible();
    expect(garmin.status).not.toHaveBeenCalled();
    expect(garmin.verify).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Personal API key")).not.toBeInTheDocument();
  });
  it("masks, toggles and immediately clears keys before a failed request; raw errors never render", async () => {
    await ready();
    const input = screen.getByLabelText("Personal API key");
    expect(input).toHaveAttribute("type", "password");
    expect(
      screen.getByRole("button", { name: "Connect and Verify" }),
    ).toBeDisabled();
    fireEvent.change(input, { target: { value: "SYNTHETIC-KEY" } });
    fireEvent.click(screen.getByRole("button", { name: "Show key" }));
    expect(input).toHaveAttribute("type", "text");
    let reject!: (error: unknown) => void;
    vi.mocked(garmin.connect).mockImplementation(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        }),
    );
    fireEvent.submit(input.closest("form")!);
    expect(input).toHaveValue("");
    expect(input).toHaveAttribute("type", "password");
    expect(garmin.connect).toHaveBeenCalledWith("SYNTHETIC-KEY");
    expect(
      screen.getByRole("button", { name: "Connect and Verify" }),
    ).toBeDisabled();
    reject({
      code: "authentication",
      body: "PRIVATE KEY Authorization Bearer secret",
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Garmin rejected",
    );
    expect(document.body.textContent).not.toContain("PRIVATE KEY");
    expect(input).toHaveValue("");
    expect(localStorage.length).toBe(0);
  });
  it("connects, lists an empty response, retrieves one selected source and reports preservation", async () => {
    await ready();
    vi.mocked(garmin.connect).mockResolvedValue(connected);
    fireEvent.change(screen.getByLabelText("Personal API key"), {
      target: { value: "SYNTHETIC-KEY" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect and Verify" }));
    await screen.findByText("Connected · credential stored");
    expect(garmin.list).not.toHaveBeenCalled();
    vi.mocked(garmin.list)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ activityId: "123", date: "2026-11-14" }]);
    fireEvent.click(
      screen.getByRole("button", { name: "List recent activities" }),
    );
    await screen.findByText("No recent running activities were returned.");
    fireEvent.click(
      screen.getByRole("button", { name: "List recent activities" }),
    );
    const select = await screen.findByLabelText("Activity to retrieve");
    const retrieve = screen.getByRole("button", {
      name: "Retrieve selected activity",
    });
    expect(retrieve).toBeDisabled();
    fireEvent.change(select, { target: { value: "123" } });
    vi.mocked(garmin.retrieve).mockResolvedValue({
      provider: "garmin",
      activityId: "123",
      source: {
        contractVersion: 1,
        sourceHash: "a".repeat(64),
        sourceId: `fit-source:${"a".repeat(64)}`,
        byteLength: 25,
        storedRelativePath: `fit-sources/aa/${"a".repeat(64)}.fit`,
      },
    });
    fireEvent.click(retrieve);
    await screen.findByText(/Original FIT preserved and verified/);
    expect(garmin.retrieve).toHaveBeenCalledWith("123");
    expect(screen.getByText(/No workout was created/)).toBeVisible();
  });
  it("confirms disconnect and preserves stored-key status across restart until verification", async () => {
    vi.mocked(garmin.status).mockResolvedValue({
      ...connected,
      verifiedThisSession: false,
    });
    render(<GarminIntegration />);
    await screen.findByText(/stored; verify to check access/);
    expect(garmin.verify).not.toHaveBeenCalled();
    const confirm = vi
      .spyOn(window, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    vi.mocked(garmin.disconnect).mockResolvedValue(disconnected);
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(garmin.disconnect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    await screen.findByText("Disconnected");
    expect(garmin.disconnect).toHaveBeenCalledTimes(1);
    confirm.mockRestore();
  });
  it("can cancel pending work and retry local credential lookup", async () => {
    vi.mocked(garmin.status)
      .mockRejectedValueOnce({ code: "credential_store" })
      .mockResolvedValueOnce(disconnected);
    render(<GarminIntegration />);
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Retry local status" }));
    await screen.findByText("Disconnected");
    vi.mocked(garmin.connect).mockImplementation(() => new Promise(() => {}));
    fireEvent.change(screen.getByLabelText("Personal API key"), {
      target: { value: "SYNTHETIC" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect and Verify" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel operation" }));
    await waitFor(() => expect(garmin.cancel).toHaveBeenCalled());
  });
  it("distinguishes network, storage, authentication and rate limits without echoing provider content", () => {
    for (const [code, expected] of [
      ["network", "connection"],
      ["storage", "local storage"],
      ["authentication", "rejected"],
      ["timeout", "30 seconds"],
    ])
      expect(garminError({ code, message: "PRIVATE" })).toContain(expected);
    expect(
      garminError({ code: "rate_limited", retryAfterSeconds: 120 }),
    ).toContain("Retry after 120 seconds");
    expect(
      garminError({ code: "rate_limited", retryAfterSeconds: "SECRET" }),
    ).not.toContain("SECRET");
    expect(garminError({ code: "toString", message: "PRIVATE" })).toBe(
      "The Garmin operation failed. Try again.",
    );
    expect(garminError("Authorization Bearer PRIVATE")).not.toContain(
      "PRIVATE",
    );
  });
});
