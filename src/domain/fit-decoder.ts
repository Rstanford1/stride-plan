import FitParser, { type ParsedFit } from "fit-file-parser";

type ParsedLap = NonNullable<ParsedFit["laps"]>[number];
type ParsedSession = NonNullable<ParsedFit["sessions"]>[number];
type ParsedRecord = NonNullable<ParsedFit["records"]>[number];

export const FIT_DECODER_ID = "fit-file-parser";
export const FIT_DECODER_VERSION = "6.2.7";

export type FitDecodeErrorCode =
  "invalid-fit" | "integrity-failed" | "no-session" | "decode-failed";

export class FitDecodeError extends Error {
  constructor(
    readonly code: FitDecodeErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "FitDecodeError";
  }
}

export interface DecodedFitLap {
  sourceIndex: number;
  startTime?: string;
  distanceMeters: number;
  durationSeconds: number;
  averageHr?: number;
}

export interface DecodedFitActivity {
  sourceIndex: number;
  occurredAt: string;
  localDate: string;
  sport: string;
  subSport?: string;
  distanceMeters: number;
  durationSeconds?: number;
  averageHr?: number;
  totalAscentMeters?: number;
  recordCount: number;
  laps: DecodedFitLap[];
  samples: DecodedFitSample[];
}

export interface DecodedFitSample {
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

export interface FitDecodeResult {
  decoderId: string;
  decoderVersion: string;
  protocolVersions: number[];
  profileVersions: number[];
  activities: DecodedFitActivity[];
}

export interface FitDecoder {
  decode(bytes: Uint8Array): Promise<FitDecodeResult>;
}

function optionalIso(value: Date | undefined): string | undefined {
  if (!value || Number.isNaN(value.getTime())) return undefined;
  return value.toISOString();
}

function isoCalendarDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function activityLocalDate(
  start: Date,
  localTimestamp?: Date,
  absoluteTimestamp?: Date,
): string {
  if (localTimestamp && absoluteTimestamp) {
    const shifted = new Date(
      start.getTime() + localTimestamp.getTime() - absoluteTimestamp.getTime(),
    );
    return isoCalendarDate(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth() + 1,
      shifted.getUTCDate(),
    );
  }
  return isoCalendarDate(
    start.getFullYear(),
    start.getMonth() + 1,
    start.getDate(),
  );
}

function normalizeLap(lap: ParsedLap, sourceIndex: number): DecodedFitLap {
  return {
    sourceIndex,
    startTime: optionalIso(lap.start_time),
    distanceMeters: lap.total_distance ?? 0,
    durationSeconds: lap.total_timer_time ?? lap.total_elapsed_time ?? 0,
    averageHr: lap.avg_heart_rate,
  };
}

function normalizeSample(
  record: ParsedRecord,
  sourceIndex: number,
  activityStartMilliseconds: number,
): DecodedFitSample {
  const timestampMilliseconds = record.timestamp?.getTime();
  return {
    sourceIndex,
    timestamp: optionalIso(record.timestamp),
    elapsedSeconds:
      timestampMilliseconds === undefined
        ? undefined
        : Math.max(
            0,
            (timestampMilliseconds - activityStartMilliseconds) / 1000,
          ),
    distanceMeters: record.distance,
    speedMetersPerSecond: record.enhanced_speed ?? record.speed,
    heartRate: record.heart_rate,
    altitudeMeters: record.enhanced_altitude ?? record.altitude,
    cadence: record.cadence,
    powerWatts: record.power,
  };
}

function sessionLaps(
  document: ParsedFit,
  session: ParsedSession,
  sessionCount: number,
): ParsedLap[] {
  if (session.laps?.length) return session.laps;
  if (sessionCount === 1) return document.laps ?? [];
  const start = session.start_time?.getTime();
  const duration = session.total_elapsed_time ?? session.total_timer_time;
  if (start === undefined || duration === undefined) return [];
  const end = start + duration * 1000;
  return (document.laps ?? []).filter((lap) => {
    const lapStart = lap.start_time?.getTime();
    return lapStart !== undefined && lapStart >= start && lapStart <= end;
  });
}

function normalizeDocument(
  document: ParsedFit,
  documentIndex: number,
): DecodedFitActivity[] {
  const sessions = document.sessions ?? [];
  return sessions.map((session, sessionIndex) => {
    const start = session.start_time ?? session.timestamp;
    const occurredAt = optionalIso(start);
    if (!occurredAt) {
      throw new FitDecodeError(
        "decode-failed",
        "A FIT session is missing a usable start time.",
      );
    }
    const laps = sessionLaps(document, session, sessions.length);
    const records =
      session.laps?.flatMap((lap) => lap.records ?? []) ??
      (sessions.length === 1 ? (document.records ?? []) : []);
    return {
      sourceIndex: documentIndex * 1000 + sessionIndex,
      occurredAt,
      localDate: activityLocalDate(
        start!,
        document.activity.local_timestamp,
        document.activity.timestamp,
      ),
      sport: String(session.sport ?? "unknown"),
      subSport:
        session.sub_sport === undefined ? undefined : String(session.sub_sport),
      distanceMeters: session.total_distance ?? 0,
      durationSeconds: session.total_timer_time ?? session.total_elapsed_time,
      averageHr: session.avg_heart_rate,
      totalAscentMeters: session.total_ascent,
      recordCount: records.length,
      laps: laps.map(normalizeLap),
      samples: records.map((record, recordIndex) =>
        normalizeSample(record, recordIndex, new Date(occurredAt).getTime()),
      ),
    };
  });
}

function classifyDecodeFailure(error: unknown): FitDecodeError {
  if (error instanceof FitDecodeError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  const code: FitDecodeErrorCode = normalized.includes("crc")
    ? "integrity-failed"
    : normalized.includes("fit") || normalized.includes("header")
      ? "invalid-fit"
      : "decode-failed";
  return new FitDecodeError(code, message, {
    cause: error,
  });
}

export class FitFileParserDecoder implements FitDecoder {
  async decode(bytes: Uint8Array): Promise<FitDecodeResult> {
    if (bytes.byteLength === 0)
      throw new FitDecodeError("invalid-fit", "The FIT file is empty.");
    const parser = new FitParser({
      force: false,
      strict: true,
      lengthUnit: "m",
      speedUnit: "m/s",
      elapsedRecordField: true,
      mode: "both",
    });
    try {
      const input = Uint8Array.from(bytes).buffer;
      const documents = await parser.parseFilesAsync(input);
      const activities = documents.flatMap(normalizeDocument);
      if (activities.length === 0)
        throw new FitDecodeError(
          "no-session",
          "The FIT file does not contain an activity session.",
        );
      return {
        decoderId: FIT_DECODER_ID,
        decoderVersion: FIT_DECODER_VERSION,
        protocolVersions: documents.flatMap((item) =>
          item.protocolVersion === undefined ? [] : [item.protocolVersion],
        ),
        profileVersions: documents.flatMap((item) =>
          item.profileVersion === undefined ? [] : [item.profileVersion],
        ),
        activities,
      };
    } catch (error) {
      throw classifyDecodeFailure(error);
    }
  }
}
