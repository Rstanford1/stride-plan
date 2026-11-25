export type SessionStatus =
  "planned" | "completed" | "modified" | "skipped" | "moved";

export type SessionKind =
  "rest" | "easy" | "recovery" | "workout" | "long" | "race" | "other";

export type PlanQuantity =
  | { kind: "exact"; value: number; unit: "m" | "km" | "mi" | "s" | "min" }
  | {
      kind: "range";
      min: number;
      max: number;
      unit: "m" | "km" | "mi" | "s" | "min";
    };

export interface PlannedDay {
  id: string;
  sourceDayId?: string;
  sourcePlanId?: string;
  sourceVersionId?: string;
  originalDate: string;
  kind: "training" | "rest" | "unspecified";
  retiredAt?: string;
}

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
  originalDistanceMiles: number | null;
  plannedDistanceMiles: number | null;
  originalDistance?: PlanQuantity;
  plannedDistance?: PlanQuantity;
  originalDuration?: PlanQuantity;
  plannedDuration?: PlanQuantity;
  sourceSessionId?: string;
  sourceDayId?: string;
  sourcePlanId?: string;
  sourceVersionId?: string;
  retiredAt?: string;
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

export type FitPreservationStatus =
  "pending" | "verified" | "unavailable" | "failed";

export type FitImportSourceStatus =
  | "decoded"
  | "failed"
  | "cancelled"
  | "exact-duplicate"
  | "possible-duplicate"
  | "excluded"
  | "unresolved";

export interface FitSourceRecord {
  id: string;
  sourceHash: string;
  originalFileName: string;
  byteLength: number;
  importedAt: string;
  decoderId: string;
  decoderVersion: string;
  preservationStatus: FitPreservationStatus;
  storedRelativePath?: string;
  preservationError?: string;
}

export interface FitSourceLap {
  id: string;
  sourceIndex: number;
  startTime?: string;
  distanceMeters: number;
  durationSeconds: number;
  averageHr?: number;
}

export interface FitSourceSample {
  id: string;
  sourceIndex: number;
  timestamp?: string;
  elapsedSeconds?: number;
  distanceMeters?: number;
  speedMetersPerSecond?: number;
  heartRate?: number;
  altitudeMeters?: number;
  cadence?: number;
  powerWatts?: number;
}

export interface FitSourceActivity {
  id: string;
  sourceId: string;
  sourceIndex: number;
  occurredAt: string;
  localDate?: string;
  sport: string;
  subSport?: string;
  distanceMeters: number;
  durationSeconds?: number;
  averageHr?: number;
  totalAscentMeters?: number;
  recordCount: number;
  laps: FitSourceLap[];
  samples: FitSourceSample[];
}

export interface FitImportSourceResult {
  sourceId: string;
  status: FitImportSourceStatus;
  activityIds: string[];
  errorCode?: string;
  errorMessage?: string;
}

export interface FitImportBatch {
  id: string;
  createdAt: string;
  completedAt?: string;
  sourceResults: FitImportSourceResult[];
}

export type SleepChoice =
  "restorative" | "adequate" | "limited" | "severely-limited";
export type SorenessChoice = "none" | "mild" | "moderate" | "severe";

export type TimeEntryMode = "duration" | "pace";
export type PaceUnit = "min-mi" | "min-km";
export type SleepEntryMode = "subjective" | "garmin";

export interface Shoe {
  id: string;
  name: string;
  mileageMiles: number;
  isDefault: boolean;
  retired?: boolean;
}

export interface JournalEntry {
  id: string;
  sessionId?: string;
  date: string;
  actualDistanceMiles?: number;
  durationSeconds?: number;
  timeEntryMode?: TimeEntryMode;
  paceSecondsPerUnit?: number;
  paceUnit?: PaceUnit;
  averageHr?: number;
  rpe?: number;
  sleep?: SleepChoice;
  sleepEntryMode?: SleepEntryMode;
  sleepScore?: number;
  sleepDurationMinutes?: number;
  soreness?: SorenessChoice;
  sorenessLocation?: string;
  shoeId?: string;
  note?: string;
  createdAt?: string;
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
  days?: PlannedDay[];
  sessions: PlannedSession[];
  activities: Activity[];
  fitSources: FitSourceRecord[];
  fitSourceActivities: FitSourceActivity[];
  fitImportBatches: FitImportBatch[];
  journals: JournalEntry[];
  shoes: Shoe[];
  settings: AppSettings;
  importFingerprints: string[];
  logicalActivities?: import("./logical-activity").LogicalActivityState;
}

export interface WeeklyMetrics {
  week: number;
  corePlannedMiles: number | null;
  flexiblePlannedMiles: number | null;
  corePlannedRange: { min: number; max: number } | null;
  flexiblePlannedRange: { min: number; max: number } | null;
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
