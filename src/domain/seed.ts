import type { AppData, PlannedSession, SessionKind } from "./types";

const START_DATE = new Date("2026-11-02T12:00:00");
const phases = [
  "1 Base (no workouts)",
  "1 Base (no workouts)",
  "1 Base (no workouts)",
  "1 Base (no workouts)",
  "1 Base (no workouts)",
  "2 Threshold intro",
  "2 Threshold intro",
  "2 Threshold intro",
  "2 Threshold intro",
  "3 Threshold build",
  "3 Threshold build",
  "3 Threshold build",
  "3 Threshold build",
];
const weeklyMiles = [
  [3.5, 4, 5, 4, 0, 4, 7],
  [3.5, 4.5, 5.5, 4.5, 0, 4.5, 8],
  [4, 5, 6, 5, 0, 5, 9],
  [3, 4, 5, 4, 0, 4, 7],
  [4, 5.5, 6.5, 5.5, 0, 5.5, 10],
  [4, 6, 8, 6, 0, 6, 11],
  [4.5, 6, 8.5, 6.5, 0, 6.5, 12],
  [3.5, 5, 7, 5, 0, 5, 9],
  [5, 6.5, 9, 6.5, 0, 7, 12],
  [5, 7, 9.5, 7, 0, 7, 12.5],
  [5.5, 7, 10, 7, 0, 7.5, 13],
  [4, 5.5, 8, 5.5, 0, 5.5, 10],
  [5, 6.5, 9, 6.5, 0, 6.5, 11],
];
const thresholdDetails = [
  "",
  "",
  "",
  "",
  "",
  "2.5 mi warm-up with 4 strides; 4 × 5 min @ 6:55–7:05 (90 s easy jog); 2.0 mi cool-down.",
  "2.0 mi warm-up; 3 × 10 min @ 6:55–7:05 (2 min jog); 1.7 mi cool-down.",
  "1.75 mi warm-up; 5 × 4 min @ 6:55–7:05 (90 s jog); 1.7 mi cool-down.",
  "2.25 mi warm-up; 2 × 15 min @ 6:55–7:05 (3 min jog); 2.1 mi cool-down.",
  "2.0 mi warm-up; 5 × 7 min @ 6:55–7:05 (90 s jog); 1.8 mi cool-down.",
  "2.25 mi warm-up; 3 × 12 min @ 6:55–7:05 (2 min jog); 2.1 mi cool-down.",
  "2.0 mi warm-up; 4 × 6 min @ 6:55–7:05 (90 s jog); 2.0 mi cool-down.",
  "2.25 mi warm-up; 6 × 5 min @ 6:55–7:05 (1 min jog); 1.9 mi cool-down.",
];

function isoDate(dayOffset: number): string {
  const date = new Date(START_DATE);
  date.setDate(date.getDate() + dayOffset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function strideCount(week: number): string {
  if (week <= 3) return "4–5";
  if (week <= 9) return "5–6";
  return "6–8";
}

function sessionDefinition(week: number, day: number, miles: number) {
  if (day === 0)
    return {
      title: "Recovery run",
      kind: "recovery" as SessionKind,
      guidance: "8:30–9:15/mi · HR ≤145 bpm",
      instructions:
        "Flexible recovery run. Monday is a class day, so this is the first run to drop when the week is disrupted.",
      flexible: true,
    };
  if (day === 1)
    return {
      title: "Easy + strides",
      kind: "easy" as SessionKind,
      guidance: "8:10–8:40/mi · HR ≤157 bpm after 10 min",
      instructions: `Easy run, then ${strideCount(week)} × 20-sec strides at 5:00–5:25/mi with 60–90 sec walk or jog recovery.`,
      flexible: false,
    };
  if (day === 2 && week <= 5)
    return {
      title: "Easy: mid-week medium run",
      kind: "easy" as SessionKind,
      guidance: "8:10–8:40/mi · HR ≤157 bpm after 10 min",
      instructions:
        "Longest weekday run. Easy and relaxed; no workout in this phase.",
      flexible: false,
    };
  if (day === 2)
    return {
      title: `Quality: threshold${week === 8 || week === 12 ? " (cutback)" : ""}`,
      kind: "workout" as SessionKind,
      guidance: "6:55–7:05/mi · HR 170–178 bpm (cap about 180)",
      instructions: thresholdDetails[week - 1],
      flexible: false,
    };
  if (day === 3)
    return {
      title: "Easy",
      kind: "easy" as SessionKind,
      guidance: "8:15–8:45/mi · HR ≤157 bpm after 10 min",
      instructions: "Easy run at a relaxed, conversational effort.",
      flexible: false,
    };
  if (day === 4)
    return {
      title: "Rest",
      kind: "rest" as SessionKind,
      guidance: "Rest day",
      instructions: "Full rest. Walking or mobility only.",
      flexible: false,
    };
  if (day === 5)
    return {
      title: "Easy + strides",
      kind: "easy" as SessionKind,
      guidance: "8:10–8:40/mi · HR ≤157 bpm after 10 min",
      instructions: `Easy run, then ${strideCount(week)} × 20-sec strides. Keep it easy before the long run.`,
      flexible: false,
    };
  return {
    title: "Long run",
    kind: "long" as SessionKind,
    guidance: "8:15–8:45/mi · HR ≤157 bpm until the last third",
    instructions: `Start at the slow end and slow down rather than chase pace.${miles > 10 ? " Carry water and carbohydrates for runs over about 90 minutes." : ""}`,
    flexible: false,
  };
}

export function createSeedSessions(): PlannedSession[] {
  return weeklyMiles.flatMap((miles, weekIndex) => {
    const week = weekIndex + 1;
    return miles.map((distance, day) => {
      const definition = sessionDefinition(week, day, distance);
      const date = isoDate(weekIndex * 7 + day);
      return {
        id: `plan-w${week}-d${day + 1}`,
        sourceKey: `plan:${date}:${definition.title.trim().toLowerCase()}`,
        week,
        originalDate: date,
        scheduledDate: date,
        originalDistanceMiles: distance,
        plannedDistanceMiles: distance,
        title: definition.title,
        kind: definition.kind,
        instructions: definition.instructions,
        guidance: definition.guidance,
        flexible: definition.flexible,
        phase: phases[weekIndex],
        status: "planned" as const,
        revisions: [],
      };
    });
  });
}

export function createInitialData(): AppData {
  return {
    schemaVersion: 5,
    sessions: createSeedSessions(),
    activities: [],
    fitSources: [],
    fitSourceActivities: [],
    fitImportBatches: [],
    activityReviewDrafts: [],
    activityReviewConfirmations: [],
    journals: [],
    shoes: [
      {
        id: "shoe-daily-trainer",
        name: "Daily trainer",
        mileageMiles: 0,
        isDefault: true,
      },
      {
        id: "shoe-workout",
        name: "Workout shoe",
        mileageMiles: 0,
        isDefault: false,
      },
    ],
    settings: {
      distanceUnit: "mi",
      easyHrLow: 146,
      easyHrHigh: 156,
      recoveryHrHigh: 145,
    },
    importFingerprints: [
      "a251d2fcc8944b99542be3051003c809a02d42c45799787affcc3deb64f5d1e8",
    ],
  };
}
