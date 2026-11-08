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
  | "supporting-recovery"
  | "unrelated";

export type LapRole = "work" | "recovery" | "warm-up" | "cooldown" | "other";
export type ActivitySegmentRole =
  "warm-up" | "work" | "recovery" | "cooldown" | "strides" | "other";

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
  sourceActivityId?: string;
  reviewId?: string;
  shoeId?: string;
  shoeAllocations?: Array<{ shoeId: string; distanceMiles: number }>;
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

export interface ActivityReviewDecision {
  sourceActivityId: string;
  plannedSessionId?: string;
  role?: ActivityRole;
  isPrimary: boolean;
  shoeId?: string;
  lapRoles: Record<string, LapRole>;
  segments: ActivityReviewSegment[];
  segmentUndoStack: ActivityReviewSegment[][];
  segmentRedoStack: ActivityReviewSegment[][];
  duplicateCandidates: PossibleDuplicateCandidate[];
  duplicateChoice?:
    { kind: "use-imported" } | { kind: "use-existing"; activityId: string };
  suggestionEvidence: string[];
}

export interface ActivityReviewSegment {
  id: string;
  startSeconds: number;
  endSeconds: number;
  role: ActivitySegmentRole;
  shoeId?: string;
}

export interface PossibleDuplicateCandidate {
  activityId: string;
  comparisonVersion: 1;
  evidence: string[];
}

export interface ActivityReviewDraft {
  id: string;
  batchId: string;
  createdAt: string;
  updatedAt: string;
  selectedSourceActivityId?: string;
  decisions: ActivityReviewDecision[];
}

export interface ActivityReviewConfirmation {
  id: string;
  batchId: string;
  bundleId: string;
  revisionNumber: number;
  confirmedAt: string;
  decisions: ActivityReviewDecision[];
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
  sessions: PlannedSession[];
  activities: Activity[];
  fitSources: FitSourceRecord[];
  fitSourceActivities: FitSourceActivity[];
  fitImportBatches: FitImportBatch[];
  activityReviewDrafts: ActivityReviewDraft[];
  activityReviewConfirmations: ActivityReviewConfirmation[];
  journals: JournalEntry[];
  shoes: Shoe[];
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
