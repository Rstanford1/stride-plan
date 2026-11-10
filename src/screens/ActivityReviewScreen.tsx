import {
  AlertCircle,
  Check,
  FileClock,
  Link2,
  Route,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAppData } from "../data/app-context";
import {
  calculateShoeAllocations,
  createActivityReviewDraft,
  validateActivityReview,
} from "../domain/activity-review";
import type {
  ActivityReviewDecision,
  ActivityReviewDraft,
  ActivityReviewSegment,
  ActivityRole,
  ActivitySegmentRole,
  FitSourceActivity,
  LapRole,
} from "../domain/types";
import {
  formatDate,
  formatDuration,
  formatMiles,
  paceFrom,
} from "../utils/format";

const METERS_PER_MILE = 1609.344;
type TimelineOverlay = "none" | "heartRate" | "elevation" | "cadence" | "power";
const roles: { value: ActivityRole; label: string }[] = [
  { value: "primary-easy", label: "Primary easy / recovery" },
  { value: "primary-long", label: "Primary long run" },
  { value: "primary-workout", label: "Primary workout" },
  { value: "warm-up", label: "Warm-up" },
  { value: "cooldown", label: "Cooldown" },
  { value: "strides", label: "Strides" },
  { value: "supporting-recovery", label: "Supporting recovery" },
  { value: "unrelated", label: "Unrelated" },
];
const segmentRoles: { value: ActivitySegmentRole; label: string }[] = [
  { value: "warm-up", label: "Warm-up" },
  { value: "work", label: "Work" },
  { value: "recovery", label: "Recovery" },
  { value: "cooldown", label: "Cooldown" },
  { value: "strides", label: "Strides" },
  { value: "other", label: "Other" },
];

function roleLabel(role?: ActivityRole) {
  return roles.find((item) => item.value === role)?.label ?? "Choose role";
}

function PaceTimeline({
  activity,
  segments,
  overlay,
  selectedSegmentId,
  onSelectSegment,
  placingBoundary,
  onPlaceBoundary,
  onMoveBoundary,
}: {
  activity: FitSourceActivity;
  segments: ActivityReviewSegment[];
  overlay: TimelineOverlay;
  selectedSegmentId?: string;
  onSelectSegment: (segmentId: string) => void;
  placingBoundary: boolean;
  onPlaceBoundary: (seconds: number) => void;
  onMoveBoundary: (index: number, seconds: number) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState(0);
  const [dragBoundaryIndex, setDragBoundaryIndex] = useState<number>();
  const samples = activity.samples.filter(
    (sample) =>
      sample.distanceMeters !== undefined &&
      sample.speedMetersPerSecond !== undefined &&
      sample.speedMetersPerSecond > 0,
  );
  if (samples.length < 2)
    return (
      <div className="empty-state compact-empty">
        <p>Pace samples were not recorded.</p>
        <span>Source laps remain available below.</span>
      </div>
    );
  const paces = samples.map(
    (sample) => METERS_PER_MILE / (sample.speedMetersPerSecond ?? 1),
  );
  const slow = Math.max(...paces);
  const fast = Math.min(...paces);
  const distance = Math.max(
    activity.distanceMeters,
    ...samples.map((sample) => sample.distanceMeters ?? 0),
  );
  const points = samples
    .map((sample, index) => {
      const x =
        ((sample.distanceMeters ?? 0) / Math.max(distance, 1)) * 760 + 20;
      const y = ((paces[index] - fast) / Math.max(slow - fast, 1)) * 120 + 20;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const overlayValues = samples.map((sample) => {
    if (overlay === "heartRate") return sample.heartRate;
    if (overlay === "elevation") return sample.altitudeMeters;
    if (overlay === "cadence") return sample.cadence;
    if (overlay === "power") return sample.powerWatts;
    return undefined;
  });
  const recordedOverlayValues = overlayValues.filter(
    (value): value is number => value !== undefined,
  );
  const overlayMinimum = recordedOverlayValues.length
    ? Math.min(...recordedOverlayValues)
    : 0;
  const overlayMaximum = recordedOverlayValues.length
    ? Math.max(...recordedOverlayValues)
    : 1;
  const overlayPoints = samples
    .flatMap((sample, index) => {
      const value = overlayValues[index];
      if (value === undefined) return [];
      const x =
        ((sample.distanceMeters ?? 0) / Math.max(distance, 1)) * 760 + 20;
      const y =
        140 -
        ((value - overlayMinimum) /
          Math.max(overlayMaximum - overlayMinimum, 1)) *
          120;
      return [`${x.toFixed(1)},${y.toFixed(1)}`];
    })
    .join(" ");
  const distanceAtElapsed = (seconds: number) => {
    const timedSamples = samples.filter(
      (sample) => sample.elapsedSeconds !== undefined,
    );
    if (!timedSamples.length || !activity.durationSeconds) {
      return (
        activity.distanceMeters *
        (seconds / Math.max(activity.durationSeconds ?? 1, 1))
      );
    }
    if (seconds <= 0) return 0;
    if (seconds >= activity.durationSeconds) return activity.distanceMeters;
    for (let index = 1; index < timedSamples.length; index += 1) {
      const left = timedSamples[index - 1];
      const right = timedSamples[index];
      if (seconds <= right.elapsedSeconds!) {
        const elapsedRange = right.elapsedSeconds! - left.elapsedSeconds!;
        const ratio = elapsedRange
          ? (seconds - left.elapsedSeconds!) / elapsedRange
          : 0;
        return (
          (left.distanceMeters ?? 0) +
          ((right.distanceMeters ?? 0) - (left.distanceMeters ?? 0)) * ratio
        );
      }
    }
    return activity.distanceMeters;
  };
  const elapsedAtDistance = (meters: number) => {
    const timedSamples = samples.filter(
      (sample) =>
        sample.elapsedSeconds !== undefined &&
        sample.distanceMeters !== undefined,
    );
    if (!timedSamples.length || !activity.durationSeconds) {
      return (
        (meters / Math.max(activity.distanceMeters, 1)) *
        (activity.durationSeconds ?? 0)
      );
    }
    for (let index = 1; index < timedSamples.length; index += 1) {
      const left = timedSamples[index - 1];
      const right = timedSamples[index];
      if (meters <= right.distanceMeters!) {
        const distanceRange = right.distanceMeters! - left.distanceMeters!;
        const ratio = distanceRange
          ? (meters - left.distanceMeters!) / distanceRange
          : 0;
        return (
          left.elapsedSeconds! +
          (right.elapsedSeconds! - left.elapsedSeconds!) * ratio
        );
      }
    }
    return activity.durationSeconds;
  };
  const viewWidth = 800 / zoom;
  const viewStart = pan * (800 - viewWidth);
  const elapsedForPointer = (element: SVGSVGElement, clientX: number) => {
    const bounds = element.getBoundingClientRect();
    const viewX =
      viewStart + ((clientX - bounds.left) / bounds.width) * viewWidth;
    const meters = ((Math.min(780, Math.max(20, viewX)) - 20) / 760) * distance;
    return elapsedAtDistance(meters);
  };
  let lapDistance = 0;
  return (
    <figure className="pace-timeline">
      <svg
        viewBox={`${viewStart} 0 ${viewWidth} 165`}
        role="img"
        aria-label="Recorded pace by distance; faster pace appears higher"
        className={placingBoundary ? "placing-boundary" : undefined}
        onClick={(event) => {
          if (!placingBoundary) return;
          onPlaceBoundary(
            elapsedForPointer(event.currentTarget, event.clientX),
          );
        }}
        onPointerUp={(event) => {
          if (dragBoundaryIndex === undefined) return;
          onMoveBoundary(
            dragBoundaryIndex,
            elapsedForPointer(event.currentTarget, event.clientX),
          );
          setDragBoundaryIndex(undefined);
        }}
        onPointerCancel={() => setDragBoundaryIndex(undefined)}
      >
        <title>Recorded pace by distance</title>
        {segments.map((segment, index) => {
          const startDistance = distanceAtElapsed(segment.startSeconds);
          const endDistance = distanceAtElapsed(segment.endSeconds);
          const x = (startDistance / Math.max(distance, 1)) * 760 + 20;
          const width =
            ((endDistance - startDistance) / Math.max(distance, 1)) * 760;
          return (
            <rect
              key={segment.id}
              className={`segment-region segment-region-${index % 2}${selectedSegmentId === segment.id ? " selected" : ""}`}
              x={x}
              y="14"
              width={Math.max(width, 1)}
              height="126"
              role="button"
              tabIndex={0}
              aria-label={`Select segment ${index + 1}`}
              onClick={(event) => {
                if (placingBoundary) return;
                event.stopPropagation();
                onSelectSegment(segment.id);
              }}
              onKeyDown={(event) => {
                if (
                  !placingBoundary &&
                  (event.key === "Enter" || event.key === " ")
                ) {
                  event.preventDefault();
                  onSelectSegment(segment.id);
                }
              }}
            />
          );
        })}
        {segments.slice(0, -1).map((segment, index) => {
          const boundaryDistance = distanceAtElapsed(segment.endSeconds);
          const x = (boundaryDistance / Math.max(distance, 1)) * 760 + 20;
          return (
            <g key={`boundary:${segment.id}`}>
              <line
                className="segment-boundary"
                x1={x}
                y1="14"
                x2={x}
                y2="140"
              />
              <line
                className="segment-boundary-hitbox"
                x1={x}
                y1="14"
                x2={x}
                y2="140"
                role="slider"
                tabIndex={0}
                aria-label={`Boundary ${index + 1} on graph`}
                aria-valuemin={Math.ceil(segment.startSeconds + 1)}
                aria-valuemax={Math.floor(segments[index + 1].endSeconds - 1)}
                aria-valuenow={Math.round(segment.endSeconds)}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setDragBoundaryIndex(index);
                }}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  const change = event.shiftKey ? 5 : 1;
                  if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
                    event.preventDefault();
                    onMoveBoundary(index, segment.endSeconds - change);
                  }
                  if (event.key === "ArrowRight" || event.key === "ArrowUp") {
                    event.preventDefault();
                    onMoveBoundary(index, segment.endSeconds + change);
                  }
                }}
              />
            </g>
          );
        })}
        <line x1="20" y1="140" x2="780" y2="140" />
        {activity.laps.map((lap, index) => {
          lapDistance += lap.distanceMeters;
          const x = (lapDistance / Math.max(distance, 1)) * 760 + 20;
          return (
            <g key={lap.id}>
              <line className="lap-landmark" x1={x} y1="14" x2={x} y2="140" />
              <text x={Math.min(x + 4, 760)} y="158">
                Lap {index + 1}
              </text>
            </g>
          );
        })}
        <polyline points={points} />
        {overlay !== "none" && overlayPoints && (
          <polyline className="metric-overlay" points={overlayPoints} />
        )}
      </svg>
      <div
        className="timeline-zoom-controls"
        aria-label="Timeline view controls"
      >
        <button
          type="button"
          disabled={zoom === 1}
          onClick={() => setPan((value) => Math.max(0, value - 0.2))}
        >
          Pan left
        </button>
        <button
          type="button"
          disabled={zoom === 1}
          onClick={() => setPan((value) => Math.min(1, value + 0.2))}
        >
          Pan right
        </button>
        <button
          type="button"
          disabled={zoom <= 1}
          onClick={() => {
            setZoom((value) => Math.max(1, value / 2));
            setPan(0);
          }}
        >
          Zoom out
        </button>
        <button
          type="button"
          disabled={zoom >= 4}
          onClick={() => setZoom((value) => Math.min(4, value * 2))}
        >
          Zoom in
        </button>
      </div>
      <figcaption>
        Pace is primary. Dashed lines are recorded FIT laps, not automatic
        workout segments.
        {overlay !== "none" &&
          ` The dotted ${overlay} line uses its own scale.`}
      </figcaption>
    </figure>
  );
}

export function ActivityReviewScreen({
  requestedBatchId,
}: {
  requestedBatchId?: string;
}) {
  const {
    data,
    saveActivityReviewDraft,
    confirmActivityReviewDraft,
    reviseActivityReview,
    persistenceState,
    persistenceError,
    retryPersistence,
    importFitFiles,
    prepareActivityReview,
    fitImportProgress,
    cancelFitImport,
  } = useAppData();
  const batches = data.fitImportBatches.filter((batch) =>
    batch.sourceResults.some((result) => result.activityIds.length),
  );
  const initial =
    [...batches]
      .reverse()
      .find(
        (batch) =>
          !data.activityReviewConfirmations.some(
            (confirmation) => confirmation.batchId === batch.id,
          ),
      ) ?? batches.at(-1);
  const [batchId, setBatchId] = useState(initial?.id ?? "");
  const [overlay, setOverlay] = useState<TimelineOverlay>("none");
  const [selectedSegmentId, setSelectedSegmentId] = useState<string>();
  const [segmentAnnouncement, setSegmentAnnouncement] = useState("");
  const [placingBoundary, setPlacingBoundary] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const batch = batches.find((item) => item.id === batchId);
  const draft = data.activityReviewDrafts.find(
    (item) => item.batchId === batchId,
  );
  const latestConfirmation = data.activityReviewConfirmations
    .filter((item) => item.batchId === batchId)
    .sort((left, right) => right.revisionNumber - left.revisionNumber)[0];

  useEffect(() => {
    if (
      requestedBatchId &&
      batches.some((item) => item.id === requestedBatchId)
    )
      setBatchId(requestedBatchId);
  }, [batches, requestedBatchId]);

  useEffect(() => {
    if (!batch || draft || latestConfirmation) return;
    saveActivityReviewDraft(
      createActivityReviewDraft(
        batch,
        data.fitSourceActivities,
        data.sessions,
        data.shoes,
        new Date().toISOString(),
        data.activities,
      ),
    );
  }, [
    batch,
    data.fitSourceActivities,
    data.activities,
    data.sessions,
    data.shoes,
    draft,
    latestConfirmation,
    saveActivityReviewDraft,
  ]);

  const decisions = draft?.decisions ?? latestConfirmation?.decisions ?? [];
  const selectedId =
    draft?.selectedSourceActivityId ?? decisions[0]?.sourceActivityId;
  const selected = data.fitSourceActivities.find(
    (item) => item.id === selectedId,
  );
  const decision = decisions.find(
    (item) => item.sourceActivityId === selectedId,
  );
  const source = data.fitSources.find((item) => item.id === selected?.sourceId);
  const issues = useMemo(
    () => (draft ? validateActivityReview(draft, data) : []),
    [data, draft],
  );
  const included = decisions.filter(
    (item) =>
      item.role !== "unrelated" &&
      item.duplicateChoice?.kind !== "use-existing",
  );
  const totalMiles = included.reduce(
    (sum, item) =>
      sum +
      (data.fitSourceActivities.find(
        (sourceItem) => sourceItem.id === item.sourceActivityId,
      )?.distanceMeters ?? 0) /
        METERS_PER_MILE,
    0,
  );
  const totalDuration = included.reduce(
    (sum, item) =>
      sum +
      (data.fitSourceActivities.find(
        (sourceItem) => sourceItem.id === item.sourceActivityId,
      )?.durationSeconds ?? 0),
    0,
  );
  const session = data.sessions.find(
    (item) => item.id === decision?.plannedSessionId,
  );
  const confirmationShoeMileage = new Map<string, number>();
  for (const item of decisions) {
    if (item.duplicateChoice?.kind === "use-existing") continue;
    const activity = data.fitSourceActivities.find(
      (sourceItem) => sourceItem.id === item.sourceActivityId,
    );
    if (!activity) continue;
    for (const allocation of calculateShoeAllocations(item, activity)) {
      confirmationShoeMileage.set(
        allocation.shoeId,
        (confirmationShoeMileage.get(allocation.shoeId) ?? 0) +
          allocation.distanceMiles,
      );
    }
  }
  const availableOverlays = selected
    ? [
        selected.samples.some((sample) => sample.heartRate !== undefined) &&
          ("heartRate" as const),
        selected.samples.some(
          (sample) => sample.altitudeMeters !== undefined,
        ) && ("elevation" as const),
        selected.samples.some((sample) => sample.cadence !== undefined) &&
          ("cadence" as const),
        selected.samples.some((sample) => sample.powerWatts !== undefined) &&
          ("power" as const),
      ].filter((item): item is Exclude<TimelineOverlay, "none"> =>
        Boolean(item),
      )
    : [];

  useEffect(() => setSelectedSegmentId(undefined), [selectedId]);

  useEffect(() => {
    if (overlay !== "none" && !availableOverlays.includes(overlay)) {
      setOverlay("none");
    }
  }, [availableOverlays, overlay]);

  function saveDraft(next: ActivityReviewDraft) {
    saveActivityReviewDraft({ ...next, updatedAt: new Date().toISOString() });
  }
  function selectActivity(sourceActivityId: string) {
    if (draft)
      saveDraft({ ...draft, selectedSourceActivityId: sourceActivityId });
  }
  function updateDecision(
    sourceActivityId: string,
    update: Partial<ActivityReviewDecision>,
  ) {
    if (!draft) return;
    const requestedPrimary = update.role?.startsWith("primary-");
    const target = draft.decisions.find(
      (item) => item.sourceActivityId === sourceActivityId,
    );
    saveDraft({
      ...draft,
      decisions: draft.decisions.map((item) => {
        if (
          requestedPrimary &&
          target?.plannedSessionId &&
          item.sourceActivityId !== sourceActivityId &&
          item.plannedSessionId === target.plannedSessionId &&
          item.isPrimary
        ) {
          return { ...item, role: "supporting-recovery", isPrimary: false };
        }
        if (item.sourceActivityId !== sourceActivityId) return item;
        return {
          ...item,
          ...update,
          isPrimary:
            update.role === undefined
              ? (update.isPrimary ?? item.isPrimary)
              : Boolean(requestedPrimary),
        };
      }),
    });
  }

  function commitSegments(
    nextSegments: ActivityReviewSegment[],
    announcement: string,
  ) {
    if (!decision) return;
    updateDecision(decision.sourceActivityId, {
      segments: nextSegments,
      segmentUndoStack: [
        ...decision.segmentUndoStack,
        structuredClone(decision.segments),
      ].slice(-30),
      segmentRedoStack: [],
    });
    setSegmentAnnouncement(announcement);
  }

  function createSegments() {
    if (!selected?.durationSeconds || !decision) return;
    commitSegments(
      [
        {
          id: `segment:${selected.id}:1`,
          startSeconds: 0,
          endSeconds: selected.durationSeconds,
          role: "other",
        },
      ],
      "Created one segment covering the complete activity.",
    );
  }

  function createSegmentsFromLaps() {
    if (!selected?.durationSeconds || !decision || !selected.laps.length)
      return;
    const usableLaps = selected.laps.filter((lap) => lap.durationSeconds > 0);
    if (!usableLaps.length) return;
    const recordedDuration = usableLaps.reduce(
      (sum, lap) => sum + lap.durationSeconds,
      0,
    );
    let elapsed = 0;
    let recordedElapsed = 0;
    const next = usableLaps.map((lap, index) => {
      const startSeconds = elapsed;
      recordedElapsed += lap.durationSeconds;
      elapsed =
        index === usableLaps.length - 1
          ? selected.durationSeconds!
          : (recordedElapsed / recordedDuration) * selected.durationSeconds!;
      return {
        id: `segment:${selected.id}:${index + 1}`,
        startSeconds,
        endSeconds: elapsed,
        role: (decision.lapRoles[lap.id] ?? "other") as ActivitySegmentRole,
      };
    });
    commitSegments(next, `Created ${next.length} segments from recorded laps.`);
  }

  function moveBoundary(index: number, requestedSeconds: number) {
    if (!decision || index >= decision.segments.length - 1) return;
    const next = structuredClone(decision.segments);
    const minimum = next[index].startSeconds + 1;
    const maximum = next[index + 1].endSeconds - 1;
    const seconds = Math.min(maximum, Math.max(minimum, requestedSeconds));
    next[index].endSeconds = seconds;
    next[index + 1].startSeconds = seconds;
    commitSegments(
      next,
      `Boundary ${index + 1} moved to ${formatDuration(seconds)}.`,
    );
  }

  function splitSegment(index: number) {
    if (!decision) return;
    const current = decision.segments[index];
    if (current.endSeconds - current.startSeconds < 2) return;
    const boundary = Math.round(
      (current.startSeconds + current.endSeconds) / 2,
    );
    const next = [...decision.segments];
    next.splice(
      index,
      1,
      { ...current, endSeconds: boundary },
      {
        ...current,
        id: `segment:${selected?.id}:${crypto.randomUUID()}`,
        startSeconds: boundary,
      },
    );
    commitSegments(
      next,
      `Segment ${index + 1} split at ${formatDuration(boundary)}.`,
    );
  }

  function placeBoundary(seconds: number) {
    if (!decision || !selected?.durationSeconds || !draft) return;
    const base = decision.segments.length
      ? decision.segments
      : [
          {
            id: `segment:${selected.id}:1`,
            startSeconds: 0,
            endSeconds: selected.durationSeconds,
            role: "other" as const,
          },
        ];
    const boundary = Math.round(seconds);
    const index = base.findIndex(
      (segment) =>
        boundary > segment.startSeconds && boundary < segment.endSeconds,
    );
    if (index < 0) {
      setSegmentAnnouncement("Choose a point inside a segment.");
      return;
    }
    const current = base[index];
    const next = [...base];
    const created = {
      ...current,
      id: `segment:${selected.id}:${crypto.randomUUID()}`,
      startSeconds: boundary,
    };
    next.splice(index, 1, { ...current, endSeconds: boundary }, created);
    commitSegments(next, `Boundary added at ${formatDuration(boundary)}.`);
    setSelectedSegmentId(created.id);
    setPlacingBoundary(false);
  }

  function mergeWithNext(index: number) {
    if (!decision || index >= decision.segments.length - 1) return;
    const next = [...decision.segments];
    next.splice(index, 2, {
      ...next[index],
      endSeconds: next[index + 1].endSeconds,
    });
    commitSegments(next, `Merged segments ${index + 1} and ${index + 2}.`);
  }

  function updateSegment(
    index: number,
    update: Partial<ActivityReviewSegment>,
  ) {
    if (!decision) return;
    const next = decision.segments.map((segment, segmentIndex) =>
      segmentIndex === index ? { ...segment, ...update } : segment,
    );
    commitSegments(next, `Updated segment ${index + 1}.`);
  }

  function undoSegments() {
    if (!decision?.segmentUndoStack.length) return;
    const previous = decision.segmentUndoStack.at(-1)!;
    updateDecision(decision.sourceActivityId, {
      segments: previous,
      segmentUndoStack: decision.segmentUndoStack.slice(0, -1),
      segmentRedoStack: [
        ...decision.segmentRedoStack,
        structuredClone(decision.segments),
      ],
    });
    setSegmentAnnouncement("Undid the last segment change.");
  }

  function redoSegments() {
    if (!decision?.segmentRedoStack.length) return;
    const next = decision.segmentRedoStack.at(-1)!;
    updateDecision(decision.sourceActivityId, {
      segments: next,
      segmentUndoStack: [
        ...decision.segmentUndoStack,
        structuredClone(decision.segments),
      ],
      segmentRedoStack: decision.segmentRedoStack.slice(0, -1),
    });
    setSegmentAnnouncement("Redid the segment change.");
  }

  async function addFiles(files: File[]) {
    if (!files.length || !batch) return;
    setImportMessage("");
    try {
      const result = await importFitFiles(files, batch.id);
      const existingIds = batch.sourceResults.flatMap(
        (item) => item.activityIds,
      );
      const newIds = result.files.flatMap((item) => item.activityIds);
      prepareActivityReview(batch.id, [...existingIds, ...newIds], {});
      setImportMessage(result.summary);
    } catch (error) {
      setImportMessage(
        error instanceof Error
          ? error.message
          : "The FIT files could not be read.",
      );
    }
  }

  const activeSegmentIndex = Math.max(
    0,
    decision?.segments.findIndex((item) => item.id === selectedSegmentId) ?? 0,
  );
  const selectedDecisionIndex = decisions.findIndex(
    (item) => item.sourceActivityId === selectedId,
  );
  const nextDecision = decisions[selectedDecisionIndex + 1];

  if (!batches.length)
    return (
      <div className="screen">
        <header className="page-header">
          <div>
            <p className="eyebrow">Imported activities</p>
            <h1>Activity review</h1>
            <p>Confirm how imported runs correspond to the plan.</p>
          </div>
        </header>
        <div className="panel empty-state activity-empty">
          <Route size={28} />
          <p>No imported activities to review.</p>
          <span>Import FIT files from Data & settings when you are ready.</span>
        </div>
      </div>
    );

  return (
    <div className="screen activity-review-screen">
      <header className="page-header review-page-header">
        <div>
          <p className="eyebrow">Imported activities</p>
          <h1>Activity review</h1>
          <p>
            Confirm the plan match and meaning without changing source data.
          </p>
        </div>
        {batches.length > 1 && (
          <label className="review-batch-picker">
            Import batch
            <select
              value={batchId}
              onChange={(event) => setBatchId(event.target.value)}
            >
              {batches.map((item, index) => (
                <option value={item.id} key={item.id}>
                  Import {index + 1} · {formatDate(item.createdAt.slice(0, 10))}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>

      <section
        className="panel review-overview"
        aria-labelledby="review-summary-title"
      >
        <div>
          <p className="eyebrow">Review summary</p>
          <h2 id="review-summary-title">
            {latestConfirmation && !draft ? "Reviewed import" : "Draft import"}
          </h2>
          <p>
            {decisions.length} source{" "}
            {decisions.length === 1 ? "activity" : "activities"} ·{" "}
            {formatMiles(totalMiles)} · {formatDuration(totalDuration)}
          </p>
        </div>
        <div className="review-overview-status">
          {draft ? (
            <>
              <strong>
                {issues.length
                  ? `${issues.length} need attention`
                  : "Ready to confirm"}
              </strong>
              <span>
                {persistenceState === "saving"
                  ? "Saving draft…"
                  : persistenceState === "error"
                    ? "Draft save failed"
                    : "Draft saved locally"}
              </span>
              {persistenceState === "error" && (
                <div className="persistence-error" role="alert">
                  <span>
                    {persistenceError ?? "The local save did not finish."}
                  </span>
                  <button className="text-button" onClick={retryPersistence}>
                    Retry save
                  </button>
                </div>
              )}
            </>
          ) : latestConfirmation ? (
            <>
              <strong>Reviewed</strong>
              <span>
                {persistenceState === "error"
                  ? "Confirmation is not saved yet."
                  : "Source facts are read only."}
              </span>
              {persistenceState === "error" && (
                <button className="text-button" onClick={retryPersistence}>
                  Retry save
                </button>
              )}
            </>
          ) : (
            <>
              <strong>Preparing review…</strong>
              <span>Building reversible suggestions.</span>
            </>
          )}
        </div>
      </section>

      {issues.length > 0 && (
        <section
          className="review-issues"
          aria-labelledby="review-issues-title"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">Needs attention</p>
              <h2 id="review-issues-title">Resolve before confirming</h2>
            </div>
            <AlertCircle size={19} />
          </div>
          <ul>
            {issues.map((issue) => (
              <li key={issue.id}>
                <button
                  className="text-button"
                  onClick={() =>
                    issue.sourceActivityId &&
                    selectActivity(issue.sourceActivityId)
                  }
                >
                  {issue.message}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="review-layout">
        <aside className="activity-list" aria-label="Imported activities">
          <div className="activity-list-actions">
            <strong>Source activities</strong>
            <label className="text-button add-source-files">
              <Upload size={15} /> Add FIT files
              <input
                className="sr-only"
                type="file"
                accept=".fit"
                multiple
                disabled={Boolean(fitImportProgress)}
                onChange={(event) => {
                  void addFiles(Array.from(event.target.files ?? []));
                  event.target.value = "";
                }}
              />
            </label>
            {fitImportProgress && (
              <button className="text-button" onClick={cancelFitImport}>
                Stop import ({fitImportProgress.completed}/
                {fitImportProgress.total})
              </button>
            )}
            {importMessage && <small role="status">{importMessage}</small>}
          </div>
          {decisions.map((item) => {
            const activity = data.fitSourceActivities.find(
              (sourceItem) => sourceItem.id === item.sourceActivityId,
            );
            if (!activity) return null;
            const matched = data.sessions.find(
              (sessionItem) => sessionItem.id === item.plannedSessionId,
            );
            const hasIssue = issues.some(
              (issue) => issue.sourceActivityId === activity.id,
            );
            return (
              <button
                key={activity.id}
                className={
                  activity.id === selectedId
                    ? "activity-item selected"
                    : "activity-item"
                }
                onClick={() => selectActivity(activity.id)}
                aria-pressed={activity.id === selectedId}
              >
                <span className="activity-icon">
                  <Route size={18} />
                </span>
                <span>
                  <strong>
                    {formatMiles(activity.distanceMeters / METERS_PER_MILE)} ·{" "}
                    {new Date(activity.occurredAt).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </strong>
                  <small>{matched?.title ?? "No plan match"}</small>
                  <small>{roleLabel(item.role)}</small>
                  {item.duplicateCandidates.length > 0 && (
                    <small className="duplicate-rail-warning">
                      {item.duplicateChoice
                        ? "Possible duplicate resolved"
                        : "Possible duplicate · choose record"}
                    </small>
                  )}
                </span>
                <i
                  className={hasIssue ? "needs-attention" : "ready"}
                  aria-label={hasIssue ? "Needs attention" : "Ready"}
                />
              </button>
            );
          })}
        </aside>

        {selected && decision && (
          <section className="activity-detail">
            <div className="activity-summary">
              <div>
                <p className="eyebrow">
                  {source?.originalFileName ?? "Imported FIT"}
                </p>
                <h2>
                  {formatMiles(selected.distanceMeters / METERS_PER_MILE)} run
                </h2>
                <span>
                  {formatDuration(selected.durationSeconds)} ·{" "}
                  {paceFrom(
                    selected.distanceMeters / METERS_PER_MILE,
                    selected.durationSeconds,
                  )}{" "}
                  ·{" "}
                  {selected.averageHr
                    ? `${selected.averageHr} bpm`
                    : "HR not recorded"}
                  {selected.totalAscentMeters !== undefined
                    ? ` · ${Math.round(selected.totalAscentMeters)} m ascent`
                    : ""}
                </span>
              </div>
              <span className="match-confidence">
                {draft ? "Suggested · editable" : "Confirmed"}
              </span>
            </div>

            {decision.suggestionEvidence.length > 0 && (
              <div className="match-evidence">
                <strong>Why this match was suggested</strong>
                <ul>
                  {decision.suggestionEvidence.map((evidence) => (
                    <li key={evidence}>{evidence}</li>
                  ))}
                </ul>
              </div>
            )}

            {decision.duplicateCandidates.length > 0 && (
              <section
                className="possible-duplicate"
                aria-labelledby="possible-duplicate-title"
              >
                <div>
                  <p className="eyebrow">Possible duplicate</p>
                  <h3 id="possible-duplicate-title">
                    Choose which record represents this run
                  </h3>
                  <p>
                    This warning does not delete either source. Your choice
                    controls which activity contributes to the plan, totals, and
                    shoe mileage.
                  </p>
                </div>
                {decision.duplicateCandidates.map((candidate) => {
                  const existing = data.activities.find(
                    (activity) => activity.id === candidate.activityId,
                  );
                  return (
                    <div
                      className="duplicate-candidate"
                      key={candidate.activityId}
                    >
                      <strong>
                        Existing activity ·{" "}
                        {existing
                          ? formatMiles(existing.distanceMiles)
                          : "Unavailable"}
                      </strong>
                      <ul>
                        {candidate.evidence.map((evidence) => (
                          <li key={evidence}>{evidence}</li>
                        ))}
                      </ul>
                      <button
                        className={
                          decision.duplicateChoice?.kind === "use-existing" &&
                          decision.duplicateChoice.activityId ===
                            candidate.activityId
                            ? "button primary"
                            : "button secondary"
                        }
                        disabled={!draft}
                        onClick={() =>
                          updateDecision(selected.id, {
                            duplicateChoice: {
                              kind: "use-existing",
                              activityId: candidate.activityId,
                            },
                          })
                        }
                      >
                        Use existing activity
                      </button>
                    </div>
                  );
                })}
                <div className="duplicate-import-choice">
                  <span>
                    Use the newly imported record and its current match, role,
                    segments, and shoe allocation.
                  </span>
                  <button
                    className={
                      decision.duplicateChoice?.kind === "use-imported"
                        ? "button primary"
                        : "button secondary"
                    }
                    disabled={!draft}
                    onClick={() =>
                      updateDecision(selected.id, {
                        duplicateChoice: { kind: "use-imported" },
                      })
                    }
                  >
                    Use imported activity
                  </button>
                </div>
              </section>
            )}

            <div className="match-grid">
              <label>
                Planned session
                <select
                  disabled={
                    !draft || decision.duplicateChoice?.kind === "use-existing"
                  }
                  value={decision.plannedSessionId ?? ""}
                  onChange={(event) =>
                    updateDecision(selected.id, {
                      plannedSessionId: event.target.value || undefined,
                    })
                  }
                >
                  <option value="">Unplanned activity</option>
                  {data.sessions
                    .filter((item) => item.kind !== "rest")
                    .map((item) => (
                      <option value={item.id} key={item.id}>
                        {item.scheduledDate} · {item.title} ·{" "}
                        {formatMiles(item.plannedDistanceMiles)}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Activity role
                <select
                  disabled={
                    !draft || decision.duplicateChoice?.kind === "use-existing"
                  }
                  value={decision.role ?? ""}
                  onChange={(event) =>
                    updateDecision(selected.id, {
                      role: (event.target.value || undefined) as
                        ActivityRole | undefined,
                    })
                  }
                >
                  <option value="">Choose role</option>
                  {roles.map((role) => (
                    <option key={role.value} value={role.value}>
                      {role.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Shoe
                <select
                  disabled={
                    !draft ||
                    decision.role === "unrelated" ||
                    decision.duplicateChoice?.kind === "use-existing"
                  }
                  value={decision.shoeId ?? ""}
                  onChange={(event) =>
                    updateDecision(selected.id, {
                      shoeId: event.target.value || undefined,
                    })
                  }
                >
                  <option value="">Choose shoe</option>
                  {data.shoes
                    .filter((shoe) => !shoe.retired)
                    .map((shoe) => (
                      <option value={shoe.id} key={shoe.id}>
                        {shoe.name} · {formatMiles(shoe.mileageMiles)}
                      </option>
                    ))}
                </select>
              </label>
            </div>

            <div className="bundle-note">
              <Link2 size={18} />
              <div>
                <strong>
                  {session
                    ? `Attached to ${session.title}`
                    : "Unplanned activity"}
                </strong>
                <span>
                  {session
                    ? `Original prescription: ${formatMiles(session.originalDistanceMiles)} on ${formatDate(session.originalDate)}. Confirmation records the result without rewriting it.`
                    : "Choose a primary role to retain this as an unplanned run, or mark it unrelated to exclude it from running metrics."}
                </span>
              </div>
            </div>

            <div className="activity-review-details">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Source detail</p>
                  <h3>Pace and recorded laps</h3>
                </div>
                <FileClock size={19} />
              </div>
              <div className="timeline-toolbar">
                <label>
                  Optional overlay
                  <select
                    value={overlay}
                    onChange={(event) =>
                      setOverlay(event.target.value as TimelineOverlay)
                    }
                  >
                    <option value="none">Pace only</option>
                    {availableOverlays.includes("heartRate") && (
                      <option value="heartRate">Heart rate</option>
                    )}
                    {availableOverlays.includes("elevation") && (
                      <option value="elevation">Elevation</option>
                    )}
                    {availableOverlays.includes("cadence") && (
                      <option value="cadence">Cadence</option>
                    )}
                    {availableOverlays.includes("power") && (
                      <option value="power">Power</option>
                    )}
                  </select>
                </label>
                <div className="timeline-actions">
                  <button
                    className={
                      placingBoundary ? "button primary" : "button secondary"
                    }
                    disabled={!draft || !selected.durationSeconds}
                    onClick={() => setPlacingBoundary((active) => !active)}
                  >
                    {placingBoundary
                      ? "Click graph to place split"
                      : "Add split on graph"}
                  </button>
                  <button
                    className="button secondary"
                    disabled={!draft || !decision.segmentUndoStack.length}
                    onClick={undoSegments}
                  >
                    Undo
                  </button>
                  <button
                    className="button secondary"
                    disabled={!draft || !decision.segmentRedoStack.length}
                    onClick={redoSegments}
                  >
                    Redo
                  </button>
                </div>
              </div>
              <PaceTimeline
                activity={selected}
                segments={decision.segments}
                overlay={overlay}
                selectedSegmentId={selectedSegmentId}
                onSelectSegment={setSelectedSegmentId}
                placingBoundary={placingBoundary}
                onPlaceBoundary={placeBoundary}
                onMoveBoundary={moveBoundary}
              />
              {selected.laps.length ? (
                <div
                  className="table-scroll"
                  tabIndex={0}
                  aria-label="Recorded laps and classifications"
                >
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Lap</th>
                        <th>Distance</th>
                        <th>Time</th>
                        <th>Avg HR</th>
                        <th>Classification</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.laps.map((lap, index) => (
                        <tr key={lap.id}>
                          <td>{index + 1}</td>
                          <td>
                            {formatMiles(lap.distanceMeters / METERS_PER_MILE)}
                          </td>
                          <td>{formatDuration(lap.durationSeconds)}</td>
                          <td>{lap.averageHr ?? "Not recorded"}</td>
                          <td>
                            <select
                              aria-label={`Lap ${index + 1} classification`}
                              disabled={!draft}
                              value={decision.lapRoles[lap.id] ?? "other"}
                              onChange={(event) =>
                                updateDecision(selected.id, {
                                  lapRoles: {
                                    ...decision.lapRoles,
                                    [lap.id]: event.target.value as LapRole,
                                  },
                                })
                              }
                            >
                              <option value="work">Work</option>
                              <option value="recovery">Recovery</option>
                              <option value="warm-up">Warm-up</option>
                              <option value="cooldown">Cooldown</option>
                              <option value="other">Other</option>
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty-state compact-empty">
                  <p>No recorded laps in this source activity.</p>
                </div>
              )}

              <section
                className="segment-editor"
                aria-labelledby="segment-editor-title"
              >
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Optional interpretation</p>
                    <h3 id="segment-editor-title">User-created segments</h3>
                  </div>
                </div>
                <p className="segment-editor-help">
                  Segments interpret the continuous recording; they never
                  rewrite FIT samples or recorded laps. Boundary inputs and
                  buttons provide the complete keyboard path.
                </p>
                {!decision.segments.length ? (
                  <div className="segment-empty-actions">
                    <button
                      className="button secondary"
                      disabled={!draft || !selected.durationSeconds}
                      onClick={createSegments}
                    >
                      Create one segment
                    </button>
                    {selected.laps.length > 0 && (
                      <button
                        className="button secondary"
                        disabled={!draft || !selected.durationSeconds}
                        onClick={createSegmentsFromLaps}
                      >
                        Start from recorded laps
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                    <div
                      className="segment-strip"
                      aria-label="Logical segments"
                    >
                      {decision.segments.map((segment, index) => (
                        <button
                          type="button"
                          key={segment.id}
                          className={
                            index === activeSegmentIndex ? "selected" : ""
                          }
                          style={{
                            flexGrow: Math.max(
                              1,
                              segment.endSeconds - segment.startSeconds,
                            ),
                          }}
                          onClick={() => setSelectedSegmentId(segment.id)}
                        >
                          <strong>{index + 1}</strong>
                          <span>
                            {
                              segmentRoles.find(
                                (item) => item.value === segment.role,
                              )?.label
                            }
                          </span>
                        </button>
                      ))}
                    </div>
                    <div
                      className="segment-card-list"
                      aria-label="User-created segment editor"
                    >
                      {decision.segments.map((segment, index) =>
                        index === activeSegmentIndex ? (
                          <section
                            className={`segment-card${selectedSegmentId === segment.id ? " selected" : ""}`}
                            key={segment.id}
                          >
                            <div className="segment-card-heading">
                              <button
                                className="text-button"
                                onClick={() => setSelectedSegmentId(segment.id)}
                              >
                                Segment {index + 1}
                              </button>
                              <span>
                                {formatDuration(segment.startSeconds)}–
                                {formatDuration(segment.endSeconds)} ·{" "}
                                {formatDuration(
                                  segment.endSeconds - segment.startSeconds,
                                )}
                              </span>
                            </div>
                            <div className="segment-card-fields">
                              {index < decision.segments.length - 1 && (
                                <label>
                                  End boundary (seconds)
                                  <div className="boundary-control">
                                    <button
                                      aria-label={`Move boundary ${index + 1} back 5 seconds`}
                                      disabled={!draft}
                                      onClick={() =>
                                        moveBoundary(
                                          index,
                                          segment.endSeconds - 5,
                                        )
                                      }
                                    >
                                      −5
                                    </button>
                                    <input
                                      aria-label={`Boundary ${index + 1} time in seconds`}
                                      type="number"
                                      min={segment.startSeconds + 1}
                                      max={
                                        decision.segments[index + 1]
                                          .endSeconds - 1
                                      }
                                      disabled={!draft}
                                      value={Math.round(segment.endSeconds)}
                                      onChange={(event) =>
                                        moveBoundary(
                                          index,
                                          Number(event.target.value),
                                        )
                                      }
                                    />
                                    <button
                                      aria-label={`Move boundary ${index + 1} forward 5 seconds`}
                                      disabled={!draft}
                                      onClick={() =>
                                        moveBoundary(
                                          index,
                                          segment.endSeconds + 5,
                                        )
                                      }
                                    >
                                      +5
                                    </button>
                                  </div>
                                </label>
                              )}
                              <label>
                                Classification
                                <select
                                  aria-label={`Segment ${index + 1} classification`}
                                  disabled={!draft}
                                  value={segment.role}
                                  onChange={(event) =>
                                    updateSegment(index, {
                                      role: event.target
                                        .value as ActivitySegmentRole,
                                    })
                                  }
                                >
                                  {segmentRoles.map((role) => (
                                    <option value={role.value} key={role.value}>
                                      {role.label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label>
                                Shoe override
                                <select
                                  aria-label={`Segment ${index + 1} shoe override`}
                                  disabled={!draft}
                                  value={segment.shoeId ?? ""}
                                  onChange={(event) =>
                                    updateSegment(index, {
                                      shoeId: event.target.value || undefined,
                                    })
                                  }
                                >
                                  <option value="">Use activity shoe</option>
                                  {data.shoes
                                    .filter((shoe) => !shoe.retired)
                                    .map((shoe) => (
                                      <option value={shoe.id} key={shoe.id}>
                                        {shoe.name}
                                      </option>
                                    ))}
                                </select>
                              </label>
                            </div>
                            <div className="segment-card-actions">
                              <button
                                className="text-button"
                                disabled={
                                  !draft ||
                                  segment.endSeconds - segment.startSeconds < 2
                                }
                                onClick={() => splitSegment(index)}
                              >
                                Split segment
                              </button>
                              {index < decision.segments.length - 1 && (
                                <button
                                  className="text-button"
                                  disabled={!draft}
                                  onClick={() => mergeWithNext(index)}
                                >
                                  Merge with next
                                </button>
                              )}
                            </div>
                          </section>
                        ) : null,
                      )}
                    </div>
                    <details className="segment-table-alternative">
                      <summary>Segment table alternative</summary>
                      <div className="table-scroll" tabIndex={0}>
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>Segment</th>
                              <th>Start</th>
                              <th>End</th>
                              <th>Duration</th>
                              <th>Classification</th>
                              <th>Shoe</th>
                            </tr>
                          </thead>
                          <tbody>
                            {decision.segments.map((segment, index) => {
                              const segmentShoe = data.shoes.find(
                                (shoe) => shoe.id === segment.shoeId,
                              );
                              return (
                                <tr key={segment.id}>
                                  <td>{index + 1}</td>
                                  <td>
                                    {formatDuration(segment.startSeconds)}
                                  </td>
                                  <td>{formatDuration(segment.endSeconds)}</td>
                                  <td>
                                    {formatDuration(
                                      segment.endSeconds - segment.startSeconds,
                                    )}
                                  </td>
                                  <td>
                                    {
                                      segmentRoles.find(
                                        (role) => role.value === segment.role,
                                      )?.label
                                    }
                                  </td>
                                  <td>
                                    {segmentShoe?.name ?? "Activity shoe"}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  </>
                )}
                <p className="sr-only" aria-live="polite">
                  {segmentAnnouncement}
                </p>
              </section>
            </div>
          </section>
        )}
      </div>
      <section
        className="panel final-bundle-summary"
        aria-labelledby="final-bundle-title"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">Review outcome</p>
            <h2 id="final-bundle-title">Activities ready to save</h2>
          </div>
          <span>
            {issues.length
              ? `${issues.length} unresolved`
              : "No unresolved blockers"}
          </span>
        </div>
        <ul className="bundle-activity-summary">
          {decisions.map((item) => {
            const activity = data.fitSourceActivities.find(
              (sourceItem) => sourceItem.id === item.sourceActivityId,
            );
            const matchedSession = data.sessions.find(
              (sessionItem) => sessionItem.id === item.plannedSessionId,
            );
            const shoe = data.shoes.find(
              (shoeItem) => shoeItem.id === item.shoeId,
            );
            return (
              <li key={item.sourceActivityId}>
                <strong>
                  {activity
                    ? formatMiles(activity.distanceMeters / METERS_PER_MILE)
                    : "Missing source"}
                </strong>
                <span>
                  {item.duplicateChoice?.kind === "use-existing"
                    ? "Use existing activity"
                    : roleLabel(item.role)}
                </span>
                <span>{matchedSession?.title ?? "Unplanned"}</span>
                <span>
                  {shoe?.name ??
                    (item.role === "unrelated"
                      ? "No shoe allocation"
                      : "Shoe required")}
                </span>
              </li>
            );
          })}
        </ul>
        <div className="bundle-confirmation-copy">
          <div>
            <strong>
              {formatMiles(totalMiles)} · {formatDuration(totalDuration)}
            </strong>
            <span>New imported mileage included by this review</span>
          </div>
          <div>
            <strong>Shoe mileage on confirmation</strong>
            <span>
              {Array.from(confirmationShoeMileage, ([shoeId, miles]) => {
                const shoe = data.shoes.find((item) => item.id === shoeId);
                return `${shoe?.name ?? "Unknown shoe"} +${miles.toFixed(2)} mi`;
              }).join(" · ") || "No new shoe mileage"}
            </span>
          </div>
        </div>
        <p className="original-plan-reminder">
          Primary matches complete their planned sessions. Supporting mileage
          remains secondary, unrelated activities stay out of running metrics,
          and original prescriptions are never rewritten.
        </p>
        <div className="review-confirmation-actions">
          <span>
            {persistenceState === "saving"
              ? "Saving locally…"
              : persistenceState === "error"
                ? "Local save needs attention"
                : draft
                  ? `${decisions.length} ${decisions.length === 1 ? "activity" : "activities"} in this review`
                  : "Review saved locally"}
          </span>
          {draft ? (
            <div className="button-row">
              {nextDecision && (
                <button
                  className="button secondary"
                  onClick={() => selectActivity(nextDecision.sourceActivityId)}
                >
                  Next activity
                </button>
              )}
              <button
                className="button primary"
                disabled={issues.length > 0}
                onClick={() => confirmActivityReviewDraft(draft)}
              >
                <Check size={17} /> Confirm all {decisions.length}
              </button>
            </div>
          ) : latestConfirmation ? (
            <button
              className="button secondary"
              onClick={() => reviseActivityReview(batchId)}
            >
              Revise review
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
