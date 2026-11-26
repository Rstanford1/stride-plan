import { z } from "zod";

const text = z.string();
const id = text.min(1);
const number = z.number().finite();
const positive = number.nonnegative();
const integer = positive.int();
const date = text.regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T12:00:00Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
});
const time = text.refine(
  (value) =>
    /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)),
);
const hr = positive.max(300).optional();

export const journalSchema = z
  .object({
    id,
    sessionId: id.optional(),
    date,
    actualDistanceMiles: positive.optional(),
    durationSeconds: positive.optional(),
    timeEntryMode: z.enum(["duration", "pace"]).optional(),
    paceSecondsPerUnit: positive.optional(),
    paceUnit: z.enum(["min-mi", "min-km"]).optional(),
    averageHr: hr,
    rpe: integer.min(1).max(10).optional(),
    sleep: z
      .enum(["restorative", "adequate", "limited", "severely-limited"])
      .optional(),
    sleepEntryMode: z.enum(["subjective", "garmin"]).optional(),
    sleepScore: integer.max(100).optional(),
    sleepDurationMinutes: positive.max(1440).optional(),
    soreness: z.enum(["none", "mild", "moderate", "severe"]).optional(),
    sorenessLocation: text.optional(),
    shoeId: id.optional(),
    note: text.optional(),
    createdAt: time.optional(),
    updatedAt: time,
  })
  .strict();
