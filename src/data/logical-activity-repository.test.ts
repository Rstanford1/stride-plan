import { describe, expect, it, vi } from "vitest";
import { createInitialData } from "../domain/seed";
import type { ConfirmationCommand } from "../domain/logical-activity";
import {
  BrowserRepository,
  SerializedRepository,
  STORAGE_KEY,
} from "./repository";

const command: ConfirmationCommand = {
  commandId: "command",
  activityId: "activity",
  eventId: "event",
  expectedRevision: null,
  assignedDate: "2026-11-24",
  plannedSessionId: null,
  sources: [
    {
      kind: "manual",
      sourceId: "manual",
      original: {
        id: "manual",
        date: "2026-11-24",
        updatedAt: "2026-11-24T12:00:00Z",
      },
      occurredAt: null,
      localDate: null,
      timezone: null,
    },
  ],
  recorded: {
    distanceMiles: 4,
    durationSeconds: 2400,
    averageHr: null,
    outcome: "unplanned",
    note: null,
    shoeAllocations: [],
  },
  duplicateDecisions: [],
};
function fixture() {
  const initial = createInitialData();
  const values = new Map([[STORAGE_KEY, JSON.stringify(initial)]]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  const base = new BrowserRepository(storage);
  return { initial, values, base, repository: new SerializedRepository(base) };
}
describe("confirmed activities in the canonical snapshot", () => {
  it("reopens the receipt and preserves it through a stale queued save", async () => {
    const f = fixture();
    const original = await f.repository.load();
    const result = await f.repository.confirmLogicalActivity(command);
    expect(result.result.status).toBe("confirmed");
    await f.repository.save({
      ...original,
      settings: { ...original.settings, easyHrHigh: 145 },
    });
    const reopened = await new BrowserRepository({
      getItem: (key) => f.values.get(key) ?? null,
      setItem: (key, value) => {
        f.values.set(key, value);
      },
      removeItem: (key) => {
        f.values.delete(key);
      },
    }).load();
    expect(reopened.schemaVersion).toBe(7);
    expect(reopened.settings.easyHrHigh).toBe(145);
    expect(reopened.logicalActivities?.commands[0].receipt).toEqual(
      result.result.status === "confirmed" && result.result.receipt,
    );
    const retried = await f.repository.confirmLogicalActivity(command);
    expect(retried.result).toEqual(result.result);
  });
  it("does not confirm or change a snapshot when a write fails", async () => {
    const f = fixture();
    await f.repository.load();
    const commit = vi
      .spyOn(
        f.base as unknown as { commitLogical: () => Promise<null> },
        "commitLogical",
      )
      .mockRejectedValueOnce(new Error("disk full"));
    await expect(f.repository.confirmLogicalActivity(command)).rejects.toThrow(
      "disk full",
    );
    expect(JSON.parse(f.values.get(STORAGE_KEY)!).schemaVersion).toBe(4);
    commit.mockRestore();
  });
  it("does not adopt another window's unrelated edits during a command retry", async () => {
    const f = fixture();
    await f.repository.load();
    await f.repository.confirmLogicalActivity(command);
    const other = new BrowserRepository({
      getItem: (key) => f.values.get(key) ?? null,
      setItem: (key, value) => {
        f.values.set(key, value);
      },
      removeItem: (key) => {
        f.values.delete(key);
      },
    });
    const current = await other.load();
    await other.save({
      ...current,
      settings: { ...current.settings, easyHrHigh: 170 },
    });
    await expect(f.repository.confirmLogicalActivity(command)).rejects.toThrow(
      /Reload/,
    );
    expect(JSON.parse(f.values.get(STORAGE_KEY)!).settings.easyHrHigh).toBe(
      170,
    );
    expect(
      JSON.parse(f.values.get(STORAGE_KEY)!).logicalActivities.commands,
    ).toHaveLength(1);
  });
  it("recovers the original receipt after the committed acknowledgement is lost", async () => {
    const f = fixture();
    await f.repository.load();
    const target = f.base as unknown as {
      commitLogical: (before: string, after: string) => Promise<null>;
    };
    const actual = target.commitLogical.bind(f.base);
    vi.spyOn(target, "commitLogical").mockImplementationOnce(
      async (before, after) => {
        await actual(before, after);
        throw new Error("acknowledgement lost");
      },
    );
    const recovered = await f.repository.confirmLogicalActivity(command);
    expect(recovered.result.status).toBe("confirmed");
    const retried = await f.repository.confirmLogicalActivity(command);
    expect(retried.result).toEqual(recovered.result);
    expect(retried.result).toMatchObject({
      status: "confirmed",
      receipt: { commandId: "command", committedRevision: 1 },
    });
    expect(
      JSON.parse(f.values.get(STORAGE_KEY)!).logicalActivities.activities,
    ).toHaveLength(1);
  });
  it("blocks legacy reset after confirmation", async () => {
    const f = fixture();
    await f.repository.load();
    await f.repository.confirmLogicalActivity(command);
    await expect(
      f.repository.restore(JSON.stringify(f.initial)),
    ).rejects.toThrow(/Legacy restore/);
    expect(JSON.parse(f.values.get(STORAGE_KEY)!).schemaVersion).toBe(7);
  });
  it("rejects attempts to erase confirmed history through a generic save", async () => {
    const f = fixture();
    await f.repository.load();
    const confirmed = await f.repository.confirmLogicalActivity(command);
    await expect(
      f.base.save({
        ...confirmed.data,
        logicalActivities: { activities: [], commands: [] },
      }),
    ).rejects.toThrow(/acknowledged activity command/);
    expect(
      JSON.parse(f.values.get(STORAGE_KEY)!).logicalActivities.activities,
    ).toHaveLength(1);
  });
  it("preserves confirmation time and earlier values after an acknowledged correction", async () => {
    const f = fixture();
    await f.repository.load();
    const first = await f.repository.confirmLogicalActivity(command);
    if (first.result.status !== "confirmed")
      throw new Error("Expected a confirmation");
    const correction = {
      commandId: "correction",
      activityId: "activity",
      expectedRevision: 1,
      assignedDate: "2026-11-25",
      plannedSessionId: null,
      recorded: { ...command.recorded, distanceMiles: 5, note: "Corrected" },
      reason: "Distance correction",
    };
    const changed = await f.repository.correctLogicalActivity(correction);
    if (changed.result.status !== "confirmed")
      throw new Error("Expected a correction");
    expect(changed.result.receipt.confirmedAt).toBe(
      first.result.receipt.confirmedAt,
    );
    expect(changed.result.receipt.confirmationEventId).toBe(
      first.result.receipt.confirmationEventId,
    );
    expect(
      changed.data.logicalActivities?.activities[0].versions.map(
        (version) => version.recorded.distanceMiles,
      ),
    ).toEqual([4, 5]);
    expect(
      (await f.repository.correctLogicalActivity(correction)).result,
    ).toEqual(changed.result);
  });
  it("preserves a linked legacy journal against later ordinary saves", async () => {
    const f = fixture();
    const original = command.sources[0];
    if (original.kind !== "manual") throw new Error("Expected manual source");
    f.initial.journals = [original.original];
    f.values.set(STORAGE_KEY, JSON.stringify(f.initial));
    await f.repository.load();
    const confirmed = await f.repository.confirmLogicalActivity({
      ...command,
      legacyDuplicateDecisions: [
        { candidateId: "journal:manual", decision: "merge" },
      ],
    });
    const changed = {
      ...confirmed.data,
      journals: [{ ...original.original, note: "overwritten" }],
    };
    await expect(f.repository.save(changed)).rejects.toThrow(/source evidence/);
    expect(
      JSON.parse(f.values.get(STORAGE_KEY)!).journals[0].note,
    ).toBeUndefined();
  });
  it("refuses to associate a manual identity with different original journal facts", async () => {
    const f = fixture();
    const source = command.sources[0];
    if (source.kind !== "manual") throw new Error("Expected manual source");
    f.initial.journals = [{ ...source.original, note: "original note" }];
    f.values.set(STORAGE_KEY, JSON.stringify(f.initial));
    await f.repository.load();
    await expect(
      f.repository.confirmLogicalActivity({
        ...command,
        legacyDuplicateDecisions: [
          { candidateId: "journal:manual", decision: "merge" },
        ],
      }),
    ).rejects.toThrow(/does not match/);
    expect(JSON.parse(f.values.get(STORAGE_KEY)!).schemaVersion).toBe(4);
  });
  it("durably saves review-later evidence without credit, then confirms it after review", async () => {
    const f = fixture();
    f.initial.journals = [
      {
        id: "older",
        date: "2026-11-24",
        actualDistanceMiles: 4,
        updatedAt: "2026-11-24T12:00:00Z",
      },
    ];
    f.values.set(STORAGE_KEY, JSON.stringify(f.initial));
    await f.repository.load();
    const deferred = {
      ...command,
      legacyDuplicateDecisions: [
        { candidateId: "journal:older", decision: "review-later" as const },
      ],
    };
    const result = await f.repository.confirmLogicalActivity(deferred);
    expect(result.result.status).toBe("review-later");
    const reopened = await new BrowserRepository({
      getItem: (key) => f.values.get(key) ?? null,
      setItem: (key, value) => {
        f.values.set(key, value);
      },
      removeItem: (key) => {
        f.values.delete(key);
      },
    }).load();
    expect(reopened.logicalActivities?.activities).toHaveLength(0);
    expect(reopened.logicalActivities?.pending?.[0].command.sources).toEqual(
      command.sources,
    );
    expect(
      (await f.repository.confirmLogicalActivity(deferred)).result.status,
    ).toBe("review-later");
    const competing = {
      ...command,
      commandId: "another-command",
      activityId: "another-activity",
      eventId: "another-event",
      sources: [
        {
          kind: "manual" as const,
          sourceId: "another",
          original: {
            id: "another",
            date: "2026-11-24",
            updatedAt: "2026-11-24T12:00:00Z",
          },
          occurredAt: null,
          localDate: "2026-11-24",
          timezone: null,
        },
      ],
    };
    expect(
      (await f.repository.confirmLogicalActivity(competing)).result,
    ).toEqual({ status: "review-required", candidates: ["pending:command"] });
    expect(
      JSON.parse(f.values.get(STORAGE_KEY)!).logicalActivities.activities,
    ).toHaveLength(0);
    const confirmed = await f.repository.confirmLogicalActivity({
      ...command,
      legacyDuplicateDecisions: [
        { candidateId: "journal:older", decision: "keep-both" },
      ],
    });
    expect(confirmed.result.status).toBe("confirmed");
    expect(confirmed.data.logicalActivities?.pending).toHaveLength(0);
    expect(confirmed.data.logicalActivities?.activities).toHaveLength(1);
  });
  it("protects an older source while its duplicate review is deferred", async () => {
    const f = fixture();
    const source = command.sources[0];
    if (source.kind !== "manual") throw new Error("Expected manual source");
    f.initial.journals = [source.original];
    f.values.set(STORAGE_KEY, JSON.stringify(f.initial));
    await f.repository.load();
    const deferred = await f.repository.confirmLogicalActivity({
      ...command,
      legacyDuplicateDecisions: [
        { candidateId: "journal:manual", decision: "review-later" },
      ],
    });
    expect(deferred.result.status).toBe("review-later");
    await expect(
      f.repository.save({
        ...deferred.data,
        journals: [{ ...source.original, note: "changed" }],
      }),
    ).rejects.toThrow(/source evidence/);
    expect(
      JSON.parse(f.values.get(STORAGE_KEY)!).journals[0].note,
    ).toBeUndefined();
  });
});
