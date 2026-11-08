import type {
  PaceUnit,
  PlannedSession,
  SessionStatus,
  SleepChoice,
  SleepEntryMode,
  SorenessChoice,
  TimeEntryMode,
} from "./types";

export interface DurationInterpretation {
  id: string;
  label: string;
  seconds: number;
}

export interface RunEntryDraft {
  status: Extract<SessionStatus, "completed" | "modified" | "skipped">;
  modification: string;
  distanceMiles?: number;
  averageHr?: number;
  timeEntryMode: TimeEntryMode;
  durationSeconds?: number;
  paceSecondsPerUnit?: number;
  paceUnit: PaceUnit;
  rpe?: number;
  soreness: SorenessChoice;
  sorenessLocation: string;
  sleepEntryMode: SleepEntryMode;
  sleep?: SleepChoice;
  sleepScore?: number;
  sleepDurationMinutes?: number;
  shoeId?: string;
  note: string;
}

function numericParts(value: string): number[] | null {
  const trimmed = value.trim();
  if (!trimmed || !/^\d+(?::\d+){0,2}$/.test(trimmed)) return null;
  return trimmed.split(":").map(Number);
}

export function parseDurationInput(value: string): DurationInterpretation[] {
  const parts = numericParts(value);
  if (!parts) return [];
  if (parts.length === 1) {
    const [amount] = parts;
    return [
      {
        id: "minutes",
        label: `${amount} min`,
        seconds: amount * 60,
      },
      { id: "seconds", label: `${amount} sec`, seconds: amount },
    ];
  }
  if (parts.length === 2) {
    const [first, second] = parts;
    if (second >= 60) return [];
    return [
      {
        id: "hours-minutes",
        label: `${first} hr ${second} min`,
        seconds: first * 3600 + second * 60,
      },
      {
        id: "minutes-seconds",
        label: `${first} min ${second} sec`,
        seconds: first * 60 + second,
      },
    ];
  }
  const [hours, minutes, seconds] = parts;
  if (minutes >= 60 || seconds >= 60) return [];
  return [
    {
      id: "hours-minutes-seconds",
      label: `${hours} hr ${minutes} min ${seconds} sec`,
      seconds: hours * 3600 + minutes * 60 + seconds,
    },
  ];
}

export function proposeDurationInterpretation(
  interpretations: DurationInterpretation[],
  distanceMiles?: number,
): DurationInterpretation | undefined {
  if (interpretations.length <= 1) return interpretations[0];
  if (!distanceMiles || distanceMiles <= 0) return interpretations[0];
  return (
    interpretations.find((item) => {
      const secondsPerMile = item.seconds / distanceMiles;
      return secondsPerMile >= 180 && secondsPerMile <= 1800;
    }) ?? interpretations[0]
  );
}

export function parsePaceInput(value: string): number | undefined {
  const parts = numericParts(value);
  if (!parts || parts.length !== 2 || parts[1] >= 60) return undefined;
  return parts[0] * 60 + parts[1];
}

export function durationFromPace(
  distanceMiles: number,
  paceSecondsPerUnit: number,
  unit: PaceUnit,
): number {
  const distanceInUnit =
    unit === "min-mi" ? distanceMiles : distanceMiles * 1.609344;
  return Math.round(distanceInUnit * paceSecondsPerUnit);
}

export function formatDuration(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainder = rounded % 60;
  if (hours > 0)
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export function validateRunEntry(
  session: PlannedSession,
  draft: RunEntryDraft,
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (session.kind === "rest" && draft.status === "completed")
    errors.status = "Rest days cannot be recorded as completed planned runs.";
  if (draft.status === "modified" && !draft.modification.trim())
    errors.modification = "Describe what changed from the original plan.";
  if (draft.status !== "skipped") {
    if (draft.distanceMiles === undefined)
      errors.distanceMiles = "Enter the distance completed.";
    else if (draft.distanceMiles < 0 || draft.distanceMiles > 100)
      errors.distanceMiles = "Distance must be between 0 and 100 miles.";
    if (draft.durationSeconds === undefined || draft.durationSeconds <= 0)
      errors.time = "Enter a valid duration or average pace.";
  }
  if (
    draft.averageHr !== undefined &&
    (draft.averageHr < 30 || draft.averageHr > 240)
  )
    errors.averageHr = "Average heart rate must be between 30 and 240 bpm.";
  if (draft.rpe !== undefined && (draft.rpe < 1 || draft.rpe > 10))
    errors.rpe = "RPE must be between 1 and 10.";
  if (draft.soreness !== "none" && !draft.sorenessLocation.trim())
    errors.sorenessLocation = "Add the location or choose None.";
  if (draft.sleepEntryMode === "subjective" && !draft.sleep)
    errors.sleep = "Choose a subjective sleep description.";
  if (draft.sleepEntryMode === "garmin") {
    if (
      draft.sleepScore !== undefined &&
      (draft.sleepScore < 0 || draft.sleepScore > 100)
    )
      errors.sleepScore = "Sleep score must be between 0 and 100.";
    if (
      draft.sleepDurationMinutes !== undefined &&
      (draft.sleepDurationMinutes < 0 || draft.sleepDurationMinutes > 1440)
    )
      errors.sleepDuration = "Sleep duration must be between 0 and 24 hours.";
  }
  return errors;
}
