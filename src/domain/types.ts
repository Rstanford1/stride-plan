export type SessionStatus =
  "planned" | "completed" | "modified" | "skipped" | "moved";

export type SessionKind = "rest" | "easy" | "recovery" | "workout" | "long";

export type ActivityRole =
  | "primary-easy"
  | "primary-long"
  | "primary-workout"
  | "warm-up"
  | "cooldown"
  | "strides"
  | "unrelated";

export type LapRole = "work" | "recovery" | "warm-up" | "cooldown" | "other";

export interface SessionRevision {
  id: string;
  changedAt: string;
  field: string;
  from: string | number | boolean | null;
  to: string | number | boolean | null;
  reason: string;
}

export interface PlannedSession {
  id: string;
  sourceKey: string;
  week: number;
  originalDate: string;
  scheduledDate: string;
  originalDistanceMiles: number;
  plannedDistanceMiles: number;
  title: string;
  kind: SessionKind;
  instructions: string;
  guidance: string;
  flexible: boolean;
  phase: string;
  status: SessionStatus;
  outcomeNote?: string;
  replacementDescription?: string;
  revisions: SessionRevision[];
}

export interface Lap {
  id: string;
  distanceMiles: number;
  durationSeconds: number;
  averageHr?: number;
  role: LapRole;
}

export interface Activity {
  id: string;
  sourceHash: string;
  fileName: string;
  occurredAt: string;
  distanceMiles: number;
  durationSeconds?: number;
  averageHr?: number;
  role: ActivityRole;
  plannedSessionId?: string;
  bundleId?: string;
  isPrimary: boolean;
  importedAt: string;
  laps: Lap[];
}

export type SleepChoice = "a-lot" | "normal" | "a-little" | "barely";
export type SorenessChoice = "none" | "mild" | "moderate" | "severe";

export interface JournalEntry {
  id: string;
  sessionId?: string;
  date: string;
  actualDistanceMiles?: number;
  durationSeconds?: number;
  averageHr?: number;
  rpe?: number;
  sleep?: SleepChoice;
  soreness?: SorenessChoice;
  sorenessLocation?: string;
  note?: string;
  updatedAt: string;
}

export interface AppSettings {
  distanceUnit: "mi" | "km";
  easyHrLow?: number;
  easyHrHigh?: number;
  recoveryHrHigh?: number;
}

export interface AppData {
  schemaVersion: number;
  sessions: PlannedSession[];
  activities: Activity[];
  journals: JournalEntry[];
  settings: AppSettings;
  importFingerprints: string[];
}

export interface WeeklyMetrics {
  week: number;
  corePlannedMiles: number;
  flexiblePlannedMiles: number;
  actualMiles: number;
  coreCompleted: number;
  coreTotal: number;
  coreCompletionRate: number | null;
  longRunMiles: number;
  runDays: number;
  outcomes: Record<SessionStatus, number>;
}

export interface ObservationEvidence {
  label: string;
  recordIds: string[];
  detail: string;
}

export interface Observation {
  id: string;
  title: string;
  summary: string;
  evidence: ObservationEvidence[];
  missingData: string[];
}
