import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PropsWithChildren } from "react";
import { createRepository, type AppRepository } from "./repository";
import { runFitImportBatch } from "./fit-import-controller";
import { createFitSourceStore } from "./fit-source-store";
import { createInitialData } from "../domain/seed";
import { FitFileParserDecoder } from "../domain/fit-decoder";
import { reviseSession, type SessionUpdate } from "../domain/rules";
import {
  confirmActivityReview,
  createActivityReviewDraft,
  createRevisionDraft,
  findPossibleDuplicates,
} from "../domain/activity-review";
import type {
  Activity,
  ActivityRole,
  ActivityReviewDraft,
  AppData,
  AppSettings,
  JournalEntry,
  LapRole,
  PlannedSession,
  Shoe,
} from "../domain/types";

export interface FitImportFileSummary {
  fileName: string;
  sourceId: string;
  status:
    "ready" | "exact-duplicate" | "possible-duplicate" | "failed" | "canceled";
  activityIds: string[];
  errorMessage?: string;
  startTime?: string;
  distanceMeters?: number;
  durationSeconds?: number;
  lapCount?: number;
  proposedRole?: ActivityRole;
}

export interface FitImportResult {
  batchId: string;
  reviewableActivities: number;
  summary: string;
  files: FitImportFileSummary[];
}

interface AppContextValue {
  data: AppData;
  ready: boolean;
  persistenceState: "idle" | "saving" | "saved" | "error";
  persistenceError?: string;
  fitImportProgress?: { completed: number; total: number };
  importFitFiles: (
    files: File[],
    appendToBatchId?: string,
  ) => Promise<FitImportResult>;
  prepareActivityReview: (
    batchId: string,
    includedActivityIds: string[],
    roleOverrides: Record<string, ActivityRole>,
  ) => void;
  cancelFitImport: () => void;
  saveSession: (
    sessionId: string,
    update: SessionUpdate,
    reason: string,
  ) => void;
  addSession: (session: PlannedSession) => void;
  saveJournal: (entry: JournalEntry) => void;
  saveRunEntry: (
    sessionId: string,
    update: SessionUpdate,
    entry: JournalEntry,
  ) => void;
  addShoe: (shoe: Shoe) => void;
  updateActivity: (activityId: string, update: Partial<Activity>) => void;
  updateLapRole: (activityId: string, lapId: string, role: LapRole) => void;
  updateSettings: (update: Partial<AppSettings>) => void;
  saveActivityReviewDraft: (draft: ActivityReviewDraft) => void;
  confirmActivityReviewDraft: (draft: ActivityReviewDraft) => void;
  reviseActivityReview: (batchId: string) => void;
  retryPersistence: () => void;
  replaceData: (data: AppData) => void;
  resetDemo: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({
  children,
  repositoryOverride,
}: PropsWithChildren<{ repositoryOverride?: AppRepository }>) {
  const repository = useMemo(
    () => repositoryOverride ?? createRepository(),
    [repositoryOverride],
  );
  const [data, setData] = useState<AppData>(createInitialData);
  const [ready, setReady] = useState(false);
  const [persistenceState, setPersistenceState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [persistenceError, setPersistenceError] = useState<string>();
  const [fitImportProgress, setFitImportProgress] = useState<{
    completed: number;
    total: number;
  }>();
  const saveVersion = useRef(0);
  const dataRef = useRef(data);
  const fitImportController = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    repository.load().then((loaded) => {
      setData(loaded);
      setReady(true);
    });
  }, [repository]);

  useEffect(() => {
    if (!ready) return;
    const version = ++saveVersion.current;
    setPersistenceState("saving");
    setPersistenceError(undefined);
    void repository
      .save(data)
      .then(() => {
        if (saveVersion.current === version) setPersistenceState("saved");
      })
      .catch((error: unknown) => {
        if (saveVersion.current !== version) return;
        setPersistenceState("error");
        setPersistenceError(
          error instanceof Error ? error.message : "Local save failed.",
        );
      });
  }, [data, ready, repository]);

  const retryPersistence = useCallback(() => {
    const version = ++saveVersion.current;
    setPersistenceState("saving");
    setPersistenceError(undefined);
    void repository
      .save(data)
      .then(() => {
        if (saveVersion.current === version) setPersistenceState("saved");
      })
      .catch((error: unknown) => {
        if (saveVersion.current !== version) return;
        setPersistenceState("error");
        setPersistenceError(
          error instanceof Error ? error.message : "Local save failed.",
        );
      });
  }, [data, repository]);

  const importFitFiles = useCallback(
    async (files: File[], appendToBatchId?: string) => {
      if (!files.length) throw new Error("Choose at least one FIT file.");
      if (fitImportController.current)
        throw new Error("Another FIT import is already running.");
      const controller = new AbortController();
      fitImportController.current = controller;
      setFitImportProgress({ completed: 0, total: files.length });
      try {
        const result = await runFitImportBatch({
          files: files.map((file) => ({
            name: file.name,
            loadBytes: async () => new Uint8Array(await file.arrayBuffer()),
          })),
          existingSources: dataRef.current.fitSources,
          decoder: new FitFileParserDecoder(),
          sourceStore: createFitSourceStore(),
          createdAt: new Date().toISOString(),
          signal: controller.signal,
          onProgress: (completed, total) =>
            setFitImportProgress({ completed, total }),
        });
        const snapshot = dataRef.current;
        const reviewedSourceResults = result.batch.sourceResults.map(
          (sourceResult) => {
            if (sourceResult.status !== "decoded") return sourceResult;
            const possible = sourceResult.activityIds.some((activityId) => {
              const activity = result.activities.find(
                (item) => item.id === activityId,
              );
              return (
                activity &&
                findPossibleDuplicates(activity, snapshot.activities).length > 0
              );
            });
            return possible
              ? { ...sourceResult, status: "possible-duplicate" as const }
              : sourceResult;
          },
        );
        const appendBatch = appendToBatchId
          ? snapshot.fitImportBatches.find(
              (item) => item.id === appendToBatchId,
            )
          : undefined;
        const reviewedBatch = {
          ...result.batch,
          id: appendBatch?.id ?? result.batch.id,
          createdAt: appendBatch?.createdAt ?? result.batch.createdAt,
          sourceResults: [
            ...(appendBatch?.sourceResults ?? []),
            ...reviewedSourceResults,
          ],
        };
        const previewDraft = createActivityReviewDraft(
          reviewedBatch,
          [...snapshot.fitSourceActivities, ...result.activities],
          snapshot.sessions,
          snapshot.shoes,
          result.batch.createdAt,
          snapshot.activities,
        );
        setData((current) => ({
          ...current,
          fitSources: [
            ...current.fitSources.filter(
              (source) =>
                !result.sources.some(
                  (replacement) => replacement.id === source.id,
                ),
            ),
            ...result.sources,
          ],
          fitSourceActivities: [
            ...current.fitSourceActivities.filter(
              (activity) =>
                !result.activities.some(
                  (replacement) => replacement.id === activity.id,
                ),
            ),
            ...result.activities,
          ],
          fitImportBatches: [
            ...current.fitImportBatches.filter(
              (batch) => batch.id !== reviewedBatch.id,
            ),
            reviewedBatch,
          ],
        }));
        const counts = reviewedSourceResults.reduce<Record<string, number>>(
          (current, item) => ({
            ...current,
            [item.status]: (current[item.status] ?? 0) + 1,
          }),
          {},
        );
        const summary = [
          counts.decoded && `${counts.decoded} ready to review`,
          counts["exact-duplicate"] &&
            `${counts["exact-duplicate"]} exact duplicate(s) skipped`,
          counts.failed && `${counts.failed} failed`,
          counts.cancelled && `${counts.cancelled} cancelled`,
        ]
          .filter(Boolean)
          .join(" · ");
        return {
          batchId: reviewedBatch.id,
          reviewableActivities: result.activities.length,
          summary: summary || "No new activities were imported.",
          files: reviewedSourceResults.map((sourceResult, index) => {
            const activity = result.activities.find((item) =>
              sourceResult.activityIds.includes(item.id),
            );
            const decision = previewDraft.decisions.find((item) =>
              sourceResult.activityIds.includes(item.sourceActivityId),
            );
            const status =
              sourceResult.status === "decoded"
                ? "ready"
                : sourceResult.status === "possible-duplicate"
                  ? "possible-duplicate"
                  : sourceResult.status === "exact-duplicate"
                    ? "exact-duplicate"
                    : sourceResult.status === "cancelled"
                      ? "canceled"
                      : "failed";
            return {
              fileName: files[index]?.name ?? "FIT file",
              sourceId: sourceResult.sourceId,
              status,
              activityIds: sourceResult.activityIds,
              errorMessage: sourceResult.errorMessage,
              startTime: activity?.occurredAt,
              distanceMeters: activity?.distanceMeters,
              durationSeconds: activity?.durationSeconds,
              lapCount: activity?.laps.length,
              proposedRole: decision?.role,
            } satisfies FitImportFileSummary;
          }),
        };
      } finally {
        fitImportController.current = undefined;
        setFitImportProgress(undefined);
      }
    },
    [],
  );

  const cancelFitImport = useCallback(() => {
    fitImportController.current?.abort();
  }, []);

  const prepareActivityReview = useCallback(
    (
      batchId: string,
      includedActivityIds: string[],
      roleOverrides: Record<string, ActivityRole>,
    ) => {
      const included = new Set(includedActivityIds);
      setData((current) => {
        const batch = current.fitImportBatches.find(
          (item) => item.id === batchId,
        );
        if (!batch) return current;
        const existing = current.activityReviewDrafts.find(
          (item) => item.batchId === batchId,
        );
        const generated = createActivityReviewDraft(
          batch,
          current.fitSourceActivities,
          current.sessions,
          current.shoes,
          new Date().toISOString(),
          current.activities,
        );
        const existingByActivity = new Map(
          existing?.decisions.map((decision) => [
            decision.sourceActivityId,
            decision,
          ]),
        );
        const base = existing ?? generated;
        const decisions = generated.decisions
          .map(
            (decision) =>
              existingByActivity.get(decision.sourceActivityId) ?? decision,
          )
          .filter((decision) => included.has(decision.sourceActivityId))
          .map((decision) => {
            const role = roleOverrides[decision.sourceActivityId];
            return role
              ? {
                  ...decision,
                  role,
                  isPrimary: role.startsWith("primary-"),
                }
              : decision;
          });
        const draft = {
          ...base,
          selectedSourceActivityId:
            decisions.find(
              (decision) =>
                decision.duplicateCandidates.length > 0 &&
                !decision.duplicateChoice,
            )?.sourceActivityId ?? decisions[0]?.sourceActivityId,
          decisions,
          updatedAt: new Date().toISOString(),
        };
        return {
          ...current,
          activityReviewDrafts: [
            ...current.activityReviewDrafts.filter(
              (item) => item.batchId !== batchId,
            ),
            draft,
          ],
        };
      });
    },
    [],
  );

  const saveSession = useCallback(
    (sessionId: string, update: SessionUpdate, reason: string) => {
      setData((current) => ({
        ...current,
        sessions: current.sessions.map((session) =>
          session.id === sessionId
            ? reviseSession(session, update, reason)
            : session,
        ),
      }));
    },
    [],
  );

  const saveJournal = useCallback((entry: JournalEntry) => {
    setData((current) => ({
      ...current,
      journals: [
        ...current.journals.filter((item) => item.id !== entry.id),
        entry,
      ],
    }));
  }, []);

  const saveRunEntry = useCallback(
    (sessionId: string, update: SessionUpdate, entry: JournalEntry) => {
      setData((current) => {
        const previous = current.journals.find((item) => item.id === entry.id);
        const previousMiles = previous?.actualDistanceMiles ?? 0;
        const nextMiles = entry.actualDistanceMiles ?? 0;
        const shoes = current.shoes.map((shoe) => {
          let mileage = shoe.mileageMiles;
          if (previous?.shoeId === shoe.id) mileage -= previousMiles;
          if (entry.shoeId === shoe.id) mileage += nextMiles;
          return { ...shoe, mileageMiles: Math.max(0, mileage) };
        });
        return {
          ...current,
          sessions: current.sessions.map((session) =>
            session.id === sessionId
              ? reviseSession(session, update, "Daily review")
              : session,
          ),
          journals: [
            ...current.journals.filter((item) => item.id !== entry.id),
            entry,
          ],
          shoes,
        };
      });
    },
    [],
  );

  const addShoe = useCallback((shoe: Shoe) => {
    setData((current) => ({ ...current, shoes: [...current.shoes, shoe] }));
  }, []);

  const addSession = useCallback((session: PlannedSession) => {
    setData((current) => ({
      ...current,
      sessions: [...current.sessions, session],
    }));
  }, []);

  const updateActivity = useCallback(
    (activityId: string, update: Partial<Activity>) => {
      setData((current) => ({
        ...current,
        activities: current.activities.map((activity) =>
          activity.id === activityId ? { ...activity, ...update } : activity,
        ),
      }));
    },
    [],
  );

  const updateLapRole = useCallback(
    (activityId: string, lapId: string, role: LapRole) => {
      setData((current) => ({
        ...current,
        activities: current.activities.map((activity) =>
          activity.id === activityId
            ? {
                ...activity,
                laps: activity.laps.map((lap) =>
                  lap.id === lapId ? { ...lap, role } : lap,
                ),
              }
            : activity,
        ),
      }));
    },
    [],
  );

  const updateSettings = useCallback((update: Partial<AppSettings>) => {
    setData((current) => ({
      ...current,
      settings: { ...current.settings, ...update },
    }));
  }, []);

  const saveActivityReviewDraft = useCallback((draft: ActivityReviewDraft) => {
    setData((current) => ({
      ...current,
      activityReviewDrafts: [
        ...current.activityReviewDrafts.filter((item) => item.id !== draft.id),
        draft,
      ],
    }));
  }, []);

  const confirmActivityReviewDraft = useCallback(
    (draft: ActivityReviewDraft) => {
      setData((current) => confirmActivityReview(current, draft));
    },
    [],
  );

  const reviseActivityReview = useCallback((batchId: string) => {
    setData((current) => {
      const draft = createRevisionDraft(current, batchId);
      if (!draft) return current;
      return {
        ...current,
        activityReviewDrafts: [
          ...current.activityReviewDrafts.filter(
            (item) => item.batchId !== batchId,
          ),
          draft,
        ],
      };
    });
  }, []);

  const value = useMemo(
    () => ({
      data,
      ready,
      persistenceState,
      persistenceError,
      fitImportProgress,
      importFitFiles,
      prepareActivityReview,
      cancelFitImport,
      saveSession,
      addSession,
      saveJournal,
      saveRunEntry,
      addShoe,
      updateActivity,
      updateLapRole,
      updateSettings,
      saveActivityReviewDraft,
      confirmActivityReviewDraft,
      reviseActivityReview,
      retryPersistence,
      replaceData: setData,
      resetDemo: () => setData(createInitialData()),
    }),
    [
      data,
      ready,
      persistenceState,
      persistenceError,
      fitImportProgress,
      importFitFiles,
      prepareActivityReview,
      cancelFitImport,
      saveSession,
      addSession,
      saveJournal,
      saveRunEntry,
      addShoe,
      updateActivity,
      updateLapRole,
      updateSettings,
      saveActivityReviewDraft,
      confirmActivityReviewDraft,
      reviseActivityReview,
      retryPersistence,
    ],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppData(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error("useAppData must be used within AppProvider");
  return value;
}
