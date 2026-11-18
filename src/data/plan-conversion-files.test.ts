import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { conversionFiles, saveConversionFile } from "./plan-conversion-files";
import schemaText from "../../schemas/training-plan/1.2.schema.json?raw";
import exampleText from "../domain/__fixtures__/training-plan/valid-1.2-75plus.json?raw";
import { parseTrainingPlan } from "../domain/training-plan";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("T07 offline conversion downloads", () => {
  it("bundles exactly the canonical schema bytes and a structurally/semantically valid synthetic example", () => {
    expect(Object.keys(conversionFiles)).toEqual(["schema", "example"]);
    expect(conversionFiles.schema.contents).toBe(schemaText);
    expect(conversionFiles.example.contents).toBe(exampleText);
    const validation = parseTrainingPlan(conversionFiles.example.contents);
    expect(validation.ok).toBe(true);
    expect(
      validation.diagnostics.filter((issue) => issue.severity === "error"),
    ).toEqual([]);
    if (validation.ok)
      expect(validation.plan.manifest.title).toContain("Synthetic");
  });
  it.each(["schema", "example"] as const)(
    "requests only bundled %s from native Save As, without paths or contents",
    async (kind) => {
      vi.stubGlobal("__TAURI_INTERNALS__", {});
      vi.mocked(invoke).mockResolvedValue({
        contractVersion: 1,
        status: "saved",
        path: "D:\\synthetic.json",
      });
      expect(await saveConversionFile(kind)).toBe(
        "File saved and verified: D:\\synthetic.json",
      );
      expect(invoke).toHaveBeenLastCalledWith("save_plan_conversion_file", {
        request: { contractVersion: 1, kind },
      });
    },
  );
  it("handles cancellation, rejects malformed acknowledgements, and never exposes raw native failures", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    vi.mocked(invoke).mockResolvedValue({
      contractVersion: 1,
      status: "cancelled",
    });
    expect(await saveConversionFile("schema")).toBe(
      "Download cancelled. No file was saved.",
    );
    for (const value of [
      null,
      { contractVersion: 1, status: "saved" },
      { contractVersion: 2, status: "saved", path: "private" },
      { contractVersion: 1, status: "saved", path: "" },
    ]) {
      vi.mocked(invoke).mockResolvedValue(value);
      await expect(saveConversionFile("schema")).rejects.toThrow(
        "could not be verified",
      );
    }
    vi.mocked(invoke).mockRejectedValue(new Error("C:\\private\\error"));
    await expect(saveConversionFile("schema")).rejects.toThrow(
      "Choose a regular file outside application storage",
    );
  });
  it.each(["schema", "example"] as const)(
    "downloads exact %s content in browser preview without a network call",
    async (kind) => {
      const network = vi.fn();
      vi.stubGlobal("fetch", network);
      let downloaded: Blob | undefined;
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        value: (blob: Blob) => {
          downloaded = blob;
          return "blob:synthetic";
        },
      });
      Object.defineProperty(URL, "revokeObjectURL", {
        configurable: true,
        value: vi.fn(),
      });
      const click = vi
        .spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(function (this: HTMLAnchorElement) {
          expect(this.download).toBe(conversionFiles[kind].name);
          expect(this.href).toBe("blob:synthetic");
        });
      await expect(saveConversionFile(kind)).resolves.toContain(
        "Download requested",
      );
      const reader = new FileReader();
      const text = await new Promise((resolve) => {
        reader.onload = () => resolve(reader.result);
        reader.readAsText(downloaded!);
      });
      expect(text).toBe(conversionFiles[kind].contents);
      expect(click).toHaveBeenCalledOnce();
      expect(network).not.toHaveBeenCalled();
    },
  );
});
