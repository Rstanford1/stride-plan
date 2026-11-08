import { FitBaseType, FitEncoder } from "fit-file-parser/encoder";

const u8 = (number: number, value: number) => ({
  number,
  size: 1,
  baseType: FitBaseType.Uint8,
  value,
});
const enumeration = (number: number, value: number) => ({
  number,
  size: 1,
  baseType: FitBaseType.Enum,
  value,
});
const u16 = (number: number, value: number) => ({
  number,
  size: 2,
  baseType: FitBaseType.Uint16,
  value,
});
const u32 = (number: number, value: number) => ({
  number,
  size: 4,
  baseType: FitBaseType.Uint32,
  value,
});

export function createFitFixture(input?: {
  start?: Date;
  distanceMeters?: number;
  durationSeconds?: number;
  averageHr?: number;
}): Uint8Array {
  const start = input?.start ?? new Date("2026-11-07T14:56:00.000Z");
  const distanceMeters = input?.distanceMeters ?? 5_000;
  const durationSeconds = input?.durationSeconds ?? 1_800;
  const averageHr = input?.averageHr ?? 168;
  const end = new Date(start.getTime() + durationSeconds * 1000);
  const startTimestamp = FitEncoder.toFitTimestamp(start);
  const endTimestamp = FitEncoder.toFitTimestamp(end);
  const encoder = new FitEncoder();
  encoder.writeMessage(0, [
    enumeration(0, 4),
    u16(1, 1),
    u16(2, 1),
    u32(4, startTimestamp),
  ]);
  encoder.writeMessage(
    20,
    [u32(253, startTimestamp), u8(3, averageHr - 10), u32(5, 0)],
    2,
  );
  encoder.writeMessage(
    20,
    [
      u32(253, endTimestamp),
      u8(3, averageHr + 10),
      u32(5, Math.round(distanceMeters * 100)),
    ],
    2,
  );
  encoder.writeMessage(
    19,
    [
      u32(253, endTimestamp),
      u32(2, startTimestamp),
      u32(7, Math.round(durationSeconds * 1000)),
      u32(8, Math.round(durationSeconds * 1000)),
      u32(9, Math.round(distanceMeters * 100)),
      u8(15, averageHr),
    ],
    1,
  );
  encoder.writeMessage(18, [
    u32(253, endTimestamp),
    u32(2, startTimestamp),
    enumeration(5, 1),
    enumeration(6, 0),
    u32(7, Math.round(durationSeconds * 1000)),
    u32(8, Math.round(durationSeconds * 1000)),
    u32(9, Math.round(distanceMeters * 100)),
    u8(16, averageHr),
  ]);
  return encoder.close();
}
