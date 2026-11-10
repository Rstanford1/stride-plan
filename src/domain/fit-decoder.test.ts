import { describe, expect, it } from "vitest";
import { createFitFixture } from "../test/fit-fixture";
import {
  activityLocalDate,
  FitDecodeError,
  FitFileParserDecoder,
} from "./fit-decoder";

describe("FIT decoder", () => {
  it("decodes a generated running activity without relying on personal data", async () => {
    const result = await new FitFileParserDecoder().decode(createFitFixture());
    expect(result.decoderId).toBe("fit-file-parser");
    expect(result.activities).toHaveLength(1);
    expect(result.activities[0]).toMatchObject({
      occurredAt: "2026-11-07T14:56:00.000Z",
      localDate: "2026-11-07",
      sport: "running",
      distanceMeters: 5_000,
      durationSeconds: 1_800,
      averageHr: 168,
      recordCount: 2,
    });
    expect(result.activities[0].laps[0]).toMatchObject({
      distanceMeters: 5_000,
      durationSeconds: 1_800,
      averageHr: 168,
    });
    expect(result.activities[0].samples).toHaveLength(2);
    expect(result.activities[0].samples[1]).toMatchObject({
      distanceMeters: 5_000,
      heartRate: 178,
    });
  });

  it("derives the activity calendar date from the FIT local-time offset", () => {
    expect(
      activityLocalDate(
        new Date("2026-11-08T01:30:00.000Z"),
        new Date("2026-11-07T17:30:00.000Z"),
        new Date("2026-11-08T01:30:00.000Z"),
      ),
    ).toBe("2026-11-07");
  });

  it("rejects empty input with a typed error", async () => {
    await expect(
      new FitFileParserDecoder().decode(new Uint8Array()),
    ).rejects.toMatchObject({
      code: "invalid-fit",
    } satisfies Partial<FitDecodeError>);
  });

  it("rejects a file whose checksum has been changed", async () => {
    const bytes = createFitFixture();
    bytes[bytes.length - 1] ^= 0xff;
    await expect(
      new FitFileParserDecoder().decode(bytes),
    ).rejects.toMatchObject({
      code: "integrity-failed",
    } satisfies Partial<FitDecodeError>);
  });
});
