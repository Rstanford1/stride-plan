import { sha256Hex } from "../domain/fit-hash";
import type { FitDecoder } from "../domain/fit-decoder";
import type { FitSourceActivity, FitSourceRecord } from "../domain/types";
import type { FitSourceStore } from "./fit-source-store";

export type FitImportInspection =
  | { status: "exact-duplicate"; sourceId: string; sourceHash: string }
  | {
      status: "decoded";
      source: FitSourceRecord;
      activities: FitSourceActivity[];
    };

export class FitImportService {
  constructor(
    private readonly decoder: FitDecoder,
    private readonly sourceStore: FitSourceStore,
  ) {}

  async inspect(input: {
    fileName: string;
    bytes: Uint8Array;
    importedAt: string;
    existingSources: FitSourceRecord[];
  }): Promise<FitImportInspection> {
    const sourceHash = await sha256Hex(input.bytes);
    const duplicate = input.existingSources.find(
      (source) =>
        source.sourceHash === sourceHash &&
        source.preservationStatus !== "failed" &&
        source.preservationStatus !== "pending",
    );
    if (duplicate) {
      return { status: "exact-duplicate", sourceId: duplicate.id, sourceHash };
    }

    const decoded = await this.decoder.decode(input.bytes);
    let preservation: FitSourceRecord["preservationStatus"] = "pending";
    let storedRelativePath: string | undefined;
    let preservationError: string | undefined;
    try {
      const result = await this.sourceStore.preserve(sourceHash, input.bytes);
      preservation = result.status;
      storedRelativePath = result.storedRelativePath;
    } catch (error) {
      preservation = "failed";
      preservationError =
        error instanceof Error ? error.message : "Source preservation failed.";
    }

    const sourceId = `fit-source:${sourceHash}`;
    const source: FitSourceRecord = {
      id: sourceId,
      sourceHash,
      originalFileName: input.fileName,
      byteLength: input.bytes.byteLength,
      importedAt: input.importedAt,
      decoderId: decoded.decoderId,
      decoderVersion: decoded.decoderVersion,
      preservationStatus: preservation,
      storedRelativePath,
      preservationError,
    };
    const activities: FitSourceActivity[] = decoded.activities.map(
      (activity) => ({
        id: `fit-activity:${sourceHash}:${activity.sourceIndex}`,
        sourceId,
        sourceIndex: activity.sourceIndex,
        occurredAt: activity.occurredAt,
        sport: activity.sport,
        subSport: activity.subSport,
        distanceMeters: activity.distanceMeters,
        durationSeconds: activity.durationSeconds,
        averageHr: activity.averageHr,
        totalAscentMeters: activity.totalAscentMeters,
        recordCount: activity.recordCount,
        laps: activity.laps.map((lap) => ({
          id: `fit-lap:${sourceHash}:${activity.sourceIndex}:${lap.sourceIndex}`,
          sourceIndex: lap.sourceIndex,
          startTime: lap.startTime,
          distanceMeters: lap.distanceMeters,
          durationSeconds: lap.durationSeconds,
          averageHr: lap.averageHr,
        })),
        samples: activity.samples.map((sample) => ({
          id: `fit-sample:${sourceHash}:${activity.sourceIndex}:${sample.sourceIndex}`,
          sourceIndex: sample.sourceIndex,
          timestamp: sample.timestamp,
          elapsedSeconds: sample.elapsedSeconds,
          distanceMeters: sample.distanceMeters,
          speedMetersPerSecond: sample.speedMetersPerSecond,
          heartRate: sample.heartRate,
          altitudeMeters: sample.altitudeMeters,
          cadence: sample.cadence,
          powerWatts: sample.powerWatts,
        })),
      }),
    );
    return { status: "decoded", source, activities };
  }
}
