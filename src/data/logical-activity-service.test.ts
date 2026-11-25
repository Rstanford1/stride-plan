import { describe, expect, it } from "vitest";
import {
  LogicalActivityService,
  type AtomicActivityStore,
} from "./logical-activity-service";
import type {
  ConfirmationCommand,
  LogicalActivityState,
} from "../domain/logical-activity";

type Snapshot = { unrelated: string; logical: LogicalActivityState };
const request: ConfirmationCommand = {
  commandId: "command-1",
  activityId: "activity-1",
  eventId: "event-1",
  expectedRevision: null,
  assignedDate: "2026-11-24",
  plannedSessionId: null,
  sources: [
    {
      kind: "manual",
      sourceId: "manual-1",
      original: {
        id: "manual-1",
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
  let snapshot: Snapshot = {
    unrelated: "original",
    logical: { activities: [], commands: [] },
  };
  const adapter: AtomicActivityStore<Snapshot> = {
    read: async () => snapshot,
    activities: (value) => value.logical,
    withActivities: (value, logical) => ({ ...value, logical }),
    compareAndCommit: async (before, after) => {
      if (snapshot !== before) return false;
      snapshot = after;
      return true;
    },
  };
  return {
    adapter,
    get: () => snapshot,
    set: (value: Snapshot) => {
      snapshot = value;
    },
  };
}
const now = () => "2026-11-24T12:00:00Z";

describe("activity confirmation service", () => {
  it("waits for a successful commit before acknowledging", async () => {
    const f = fixture();
    const commit = f.adapter.compareAndCommit;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.adapter.compareAndCommit = async (before, after) => {
      await gate;
      return commit(before, after);
    };
    let acknowledged = false;
    const pending = new LogicalActivityService(f.adapter, now)
      .confirm(request)
      .then((result) => {
        acknowledged = true;
        return result;
      });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(acknowledged).toBe(false);
    expect(f.get().logical.activities).toHaveLength(0);
    release();
    expect(await pending).toMatchObject({
      status: "confirmed",
      receipt: { confirmedAt: now() },
    });
    expect(f.get().logical.activities).toHaveLength(1);
  });
  it("never publishes a receipt or confirmed state on a failed commit", async () => {
    const f = fixture();
    f.adapter.compareAndCommit = async () => {
      throw new Error("disk full");
    };
    await expect(
      new LogicalActivityService(f.adapter, now).confirm(request),
    ).rejects.toThrow("disk full");
    expect(f.get().logical.activities).toHaveLength(0);
  });
  it("retries a lost acknowledgement without creating another record", async () => {
    const f = fixture();
    const commit = f.adapter.compareAndCommit;
    f.adapter.compareAndCommit = async (before, after) => {
      await commit(before, after);
      throw new Error("ack lost");
    };
    const service = new LogicalActivityService(f.adapter, now);
    await expect(service.confirm(request)).rejects.toThrow("ack lost");
    const result = await service.confirm(request);
    expect(result).toMatchObject({
      status: "confirmed",
      receipt: { confirmedAt: now(), committedRevision: 1 },
    });
    expect(f.get().logical.activities).toHaveLength(1);
    expect(f.get().logical.commands).toHaveLength(1);
  });
  it("recomputes a candidate against concurrent unrelated edits", async () => {
    const f = fixture();
    const commit = f.adapter.compareAndCommit;
    let first = true;
    f.adapter.compareAndCommit = async (before, after) => {
      if (first) {
        first = false;
        f.set({ ...before, unrelated: "changed" });
      }
      return commit(before, after);
    };
    expect(
      await new LogicalActivityService(f.adapter, now).confirm(request),
    ).toMatchObject({ status: "confirmed" });
    expect(f.get().unrelated).toBe("changed");
  });
  it("rechecks possible duplicates after a concurrent confirmation wins", async () => {
    const f = fixture();
    const commit = f.adapter.compareAndCommit;
    let first = true;
    const concurrent = new LogicalActivityService(f.adapter, now);
    f.adapter.compareAndCommit = async (before, after) => {
      if (first) {
        first = false;
        await concurrent.confirm({
          ...request,
          commandId: "other-command",
          activityId: "other-activity",
          eventId: "other-event",
          sources: [
            {
              kind: "manual",
              sourceId: "other-source",
              original: {
                id: "other-source",
                date: "2026-11-24",
                updatedAt: "2026-11-24T12:00:00Z",
              },
              occurredAt: null,
              localDate: null,
              timezone: null,
            },
          ],
        });
      }
      return commit(before, after);
    };
    const result = await new LogicalActivityService(f.adapter, now).confirm(
      request,
    );
    expect(result).toEqual({
      status: "review-required",
      candidates: ["other-activity"],
    });
    expect(f.get().logical.activities).toHaveLength(1);
  });
});
