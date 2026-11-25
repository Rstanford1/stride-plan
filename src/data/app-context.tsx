import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useRef,
} from "react";
import type { PropsWithChildren } from "react";
import {
  createRepository,
  RestoreInputError,
  SerializedRepository,
  type AppRepository,
} from "./repository";
import { createInitialData } from "../domain/seed";
import {
  DataIntegrityError,
  storageError,
} from "../domain/snapshot-validation";
import { reviseSession, type SessionUpdate } from "../domain/rules";
import { mergeFitImportBatch } from "./fit-import-commit";
import { activationCandidate, previewActivation } from "../domain/active-plan";
import {
  projectActivePlan,
  type ActivePlanProjection,
} from "../domain/active-plan-projection";
import { parseTrainingPlan } from "../domain/training-plan";
import type { TrainingPlan } from "../domain/training-plan-contract";
import { sha256Hex } from "../domain/fit-hash";
import { validatorFingerprint } from "./plan-validator-registry";
import type { PlanPreview } from "./plan-draft-store";
import type { FitImportBatchResult } from "./fit-import-controller";
import type {
  ConfirmationCommand,
  CorrectionCommand,
} from "../domain/logical-activity";
import type { DurableConfirmationResult } from "./logical-activity-service";
import type {
  Activity,
  AppData,
  AppSettings,
  FitImportBatch,
  FitSourceRecord,
  JournalEntry,
  LapRole,
  PlannedSession,
  Shoe,
} from "../domain/types";

interface AppContextValue {
  data: AppData;
  ready: boolean;
  recoveryError: DataIntegrityError | null;
  retryLoading: () => void;
  restoreBackup: (raw: string) => Promise<void>;
  confirmLogicalActivity: (
    command: ConfirmationCommand,
  ) => Promise<DurableConfirmationResult>;
  correctLogicalActivity: (
    command: CorrectionCommand,
  ) => Promise<DurableConfirmationResult>;
  saveSession: (
    sessionId: string,
    update: SessionUpdate,
    reason: string,
  ) => void;
  moveSession: (sessionId: string, date: string) => string | null;
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
  replaceData: (data: AppData) => void;
  beginFitImportBatch: () => {
    existingSources: FitSourceRecord[];
    commitFitImportBatch: (
      result: FitImportBatchResult,
    ) => FitImportBatch | null;
  };
  resetDemo: () => Promise<void>;
  activePlan: {
    activationId: string;
    source: TrainingPlan;
    effectiveDate: string;
  } | null;
  activeProjection: ActivePlanProjection;
  activatePlan: (preview: PlanPreview) => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({
  children,
  repository: suppliedRepository,
}: PropsWithChildren<{ repository?: AppRepository }>) {
  const repository = useMemo(
    () =>
      suppliedRepository
        ? new SerializedRepository(suppliedRepository)
        : createRepository(),
    [suppliedRepository],
  );
  const [data, publishData] = useState<AppData>({
    schemaVersion: 4,
    sessions: [],
    activities: [],
    journals: [],
    shoes: [],
    fitSources: [],
    fitSourceActivities: [],
    fitImportBatches: [],
    settings: { distanceUnit: "mi" },
    importFingerprints: [],
  });
  const [ready, setReady] = useState(false);
  const [activePlan, setActivePlan] = useState<{
    activationId: string;
    source: TrainingPlan;
    effectiveDate: string;
  } | null>(null);
  const [recoveryError, setRecoveryError] = useState<DataIntegrityError | null>(
    null,
  );
  const [attempt, setAttempt] = useState(0);
  const writable = useRef(false);
  const restoring = useRef(false);
  const confirming = useRef(0);
  const persisted = useRef<AppData | null>(null);
  const currentData = useRef(data);
  const importEpoch = useRef(0);
  const setData = useCallback((update: React.SetStateAction<AppData>) => {
    if (!writable.current || restoring.current) return;
    // Resolve commands synchronously against the latest accepted snapshot.
    // React receives only values; persistence stays in the effect below.
    const next =
      typeof update === "function" ? update(currentData.current) : update;
    currentData.current = next;
    publishData(next);
  }, []);
  const fail = useCallback((error: unknown) => {
    importEpoch.current += 1;
    writable.current = false;
    setRecoveryError(storageError(error));
    setReady(false);
  }, []);
  const retryLoading = useCallback(() => {
    importEpoch.current += 1;
    writable.current = false;
    setRecoveryError(null);
    setReady(false);
    setAttempt((value) => value + 1);
  }, []);
  useEffect(() => {
    let active = true;
    writable.current = false;
    repository
      .load()
      .then(async (loaded) => {
        const activeRecord = (await repository.inspectActive?.()) ?? null;
        let source: TrainingPlan | null = null;
        if (activeRecord) {
          const result = parseTrainingPlan(
            new TextDecoder("utf-8", { fatal: true }).decode(
              activeRecord.sourceBytes,
            ),
          );
          if (!result.ok)
            throw new DataIntegrityError(
              "corrupted",
              "The active plan source no longer validates. Saved data was not changed.",
            );
          source = result.plan;
        }
        if (
          (loaded.schemaVersion === 5 ||
            (loaded.schemaVersion === 7 && loaded.days)) &&
          !source
        )
          throw new DataIntegrityError(
            "corrupted",
            "The active schedule has no verified source record.",
          );
        if (source && activeRecord)
          projectActivePlan(
            loaded,
            source,
            activeRecord.effectiveDate,
            activeRecord.activationId,
          );
        if (!active) return;
        setActivePlan(
          source && activeRecord
            ? {
                activationId: activeRecord.activationId,
                source,
                effectiveDate: activeRecord.effectiveDate,
              }
            : null,
        );
        persisted.current = loaded;
        currentData.current = loaded;
        publishData(loaded);
        writable.current = true;
        setRecoveryError(null);
        setReady(true);
      })
      .catch((error) => {
        if (active) fail(error);
      });
    return () => {
      active = false;
      importEpoch.current += 1;
      writable.current = false;
    };
  }, [repository, attempt, fail]);
  useEffect(() => {
    if (
      !ready ||
      !writable.current ||
      restoring.current ||
      currentData.current !== data ||
      persisted.current === data
    )
      return;
    void repository
      .save(data)
      .then(() => {
        persisted.current = data;
      })
      .catch(fail);
  }, [data, ready, repository, fail]);
  const restoreBackup = useCallback(
    async (raw: string) => {
      if (
        !writable.current ||
        restoring.current ||
        confirming.current ||
        !repository.restore
      )
        throw new DataIntegrityError(
          "inaccessible",
          "Safe restore is unavailable while data is unresolved.",
        );
      restoring.current = true;
      importEpoch.current += 1;
      try {
        // Flush edits before capturing the durable pre-restore snapshot.
        if (persisted.current !== currentData.current) {
          await repository.save(currentData.current);
        }
        const restored = await repository.restore(raw);
        persisted.current = restored;
        currentData.current = restored;
        publishData(restored);
      } catch (error) {
        if (!(error instanceof RestoreInputError)) fail(error);
        throw error;
      } finally {
        restoring.current = false;
      }
    },
    [repository, fail],
  );
  const activatePlan = useCallback(
    async (preview: PlanPreview) => {
      if (!writable.current || restoring.current || confirming.current)
        throw new DataIntegrityError(
          "inaccessible",
          "Plan activation is unavailable while data is being saved or restored.",
        );
      const bytes = Uint8Array.from(preview.bytes);
      const validation = parseTrainingPlan(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
      if (!validation.ok)
        throw new DataIntegrityError(
          "unsupported",
          "The selected plan no longer validates. No schedule was changed.",
        );
      const today = new Date();
      const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      const before = currentData.current;
      const impact = previewActivation(validation.plan, before, date);
      if (impact.diagnostics.length)
        throw new DataIntegrityError(
          "unsupported",
          impact.diagnostics[0].message,
        );
      restoring.current = true;
      importEpoch.current += 1;
      try {
        if (persisted.current !== before) {
          await repository.save(before);
          persisted.current = before;
        }
        const activationId = crypto.randomUUID();
        const after = activationCandidate(
          validation.plan,
          before,
          activationId,
          date,
          new Date().toISOString(),
        );
        if (!repository.activate)
          throw new DataIntegrityError(
            "unsupported",
            "Plan activation requires the Windows app.",
          );
        await repository.activate({
          before,
          after,
          bytes,
          sourceHash: await sha256Hex(bytes),
          validatorFingerprint: await validatorFingerprint(
            validation.plan.schemaVersion,
          ),
          effectiveDate: date,
          activationId,
        });
        persisted.current = after;
        currentData.current = after;
        setActivePlan({
          activationId,
          source: validation.plan,
          effectiveDate: date,
        });
        publishData(after);
      } catch (error) {
        if (!(error instanceof RestoreInputError)) fail(error);
        throw error;
      } finally {
        restoring.current = false;
      }
    },
    [repository, fail],
  );

  const changeLogicalActivity = useCallback(
    async (
      command: ConfirmationCommand | CorrectionCommand,
    ): Promise<DurableConfirmationResult> => {
      if (
        !writable.current ||
        restoring.current ||
        ("eventId" in command
          ? !repository.confirmLogicalActivity
          : !repository.correctLogicalActivity)
      )
        throw new DataIntegrityError(
          "inaccessible",
          "Activity confirmation is unavailable while data is unresolved.",
        );
      confirming.current += 1;
      try {
        // Flush the current optimistic snapshot. The serialized repository merges
        // already-committed identities into any older saves queued during this wait.
        await repository.save(currentData.current);
        const confirmed =
          "eventId" in command
            ? await repository.confirmLogicalActivity!(command)
            : await repository.correctLogicalActivity!(command);
        if (confirmed.result.status === "confirmed") {
          const latest = currentData.current;
          const next =
            latest === persisted.current
              ? confirmed.data
              : {
                  ...latest,
                  schemaVersion: 7,
                  logicalActivities: confirmed.data.logicalActivities,
                };
          persisted.current = confirmed.data;
          currentData.current = next;
          publishData(next);
        }
        return confirmed.result;
      } finally {
        confirming.current -= 1;
      }
    },
    [repository],
  );
  const confirmLogicalActivity = useCallback(
    (command: ConfirmationCommand) => changeLogicalActivity(command),
    [changeLogicalActivity],
  );
  const correctLogicalActivity = useCallback(
    (command: CorrectionCommand) => changeLogicalActivity(command),
    [changeLogicalActivity],
  );

  const beginFitImportBatch = useCallback(() => {
    const epoch = importEpoch.current;
    const allowed = writable.current && !restoring.current;
    return {
      existingSources: currentData.current.fitSources,
      commitFitImportBatch: (result: FitImportBatchResult) => {
        if (
          !allowed ||
          !writable.current ||
          restoring.current ||
          epoch !== importEpoch.current
        )
          return null;
        const merged = mergeFitImportBatch(currentData.current, result);
        setData(merged.data);
        return merged.batch;
      },
    };
  }, [setData]);

  const replaceData = useCallback(
    (replacement: AppData) => {
      if (!writable.current || restoring.current) return;
      importEpoch.current += 1;
      setData(replacement);
    },
    [setData],
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
  const moveSession = useCallback(
    (sessionId: string, date: string): string | null => {
      const current = currentData.current;
      const selected = current.sessions.find(
        (session) => session.id === sessionId && !session.retiredAt,
      );
      if (!selected)
        return "The selected session is unavailable. Reload the plan.";
      if (!selected.sourceSessionId) {
        saveSession(sessionId, { scheduledDate: date }, "Session moved");
        return null;
      }
      if (
        !activePlan ||
        !selected.id.startsWith(`active:${activePlan.activationId}:session:`) ||
        selected.sourcePlanId !== activePlan.source.manifest.planId ||
        selected.sourceVersionId !== activePlan.source.manifest.versionId
      )
        return "This session belongs to an earlier source plan and cannot be moved from the current plan.";
      const week = activePlan.source.weeks.find((item) =>
        item.days.some((day) => day.id === selected.sourceDayId),
      );
      const day = week?.days.find((item) => item.id === selected.sourceDayId);
      const source = day?.sessions.find(
        (item) => item.id === selected.sourceSessionId,
      );
      if (!week || !day || !source)
        return "The plan source mapping is incomplete. No session was moved.";
      const mainId =
        source.role === "double"
          ? source.primarySessionId
          : source.role === "main"
            ? source.id
            : undefined;
      const members = mainId
        ? day.sessions.filter(
            (item) =>
              item.id === mainId ||
              (item.role === "double" && item.primarySessionId === mainId),
          )
        : [source];
      for (const member of members) {
        if (activePlan.source.schemaVersion === "1.2") {
          if (member.schedulingPolicy === "fixed-date" && date !== day.date)
            return `The source fixes ${member.title} to ${day.date}.`;
          if (
            member.schedulingPolicy !== "fixed-date" &&
            (date < week.startDate || date > week.endDate)
          )
            return `The source permits ${member.title} only within ${week.startDate}–${week.endDate}.`;
        }
      }
      if (date < activePlan.effectiveDate)
        return "Active-plan sessions cannot move before the activation date.";
      const ids = new Set(members.map((member) => member.id));
      setData((data) => ({
        ...data,
        sessions: data.sessions.map((session) =>
          session.id.startsWith(`active:${activePlan.activationId}:session:`) &&
          session.sourceDayId === day.id &&
          session.sourcePlanId === selected.sourcePlanId &&
          session.sourceVersionId === selected.sourceVersionId &&
          session.sourceSessionId &&
          ids.has(session.sourceSessionId) &&
          !session.retiredAt
            ? reviseSession(
                session,
                { scheduledDate: date },
                "Source-aware move",
              )
            : session,
        ),
      }));
      return null;
    },
    [activePlan, saveSession, setData],
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

  const activeProjection = useMemo(
    () =>
      projectActivePlan(
        data,
        activePlan?.source ?? null,
        activePlan?.effectiveDate ?? null,
        activePlan?.activationId ?? null,
      ),
    [data, activePlan],
  );

  const value = useMemo(
    () => ({
      data,
      ready,
      recoveryError,
      retryLoading,
      restoreBackup,
      confirmLogicalActivity,
      correctLogicalActivity,
      saveSession,
      moveSession,
      addSession,
      saveJournal,
      saveRunEntry,
      addShoe,
      updateActivity,
      updateLapRole,
      updateSettings,
      replaceData,
      beginFitImportBatch,
      resetDemo: async () => {
        if (!writable.current || restoring.current) return;
        await restoreBackup(JSON.stringify(createInitialData()));
      },
      activePlan,
      activeProjection,
      activatePlan,
    }),
    [
      data,
      ready,
      recoveryError,
      retryLoading,
      restoreBackup,
      confirmLogicalActivity,
      correctLogicalActivity,
      saveSession,
      moveSession,
      addSession,
      saveJournal,
      saveRunEntry,
      addShoe,
      updateActivity,
      updateLapRole,
      updateSettings,
      replaceData,
      beginFitImportBatch,
      activePlan,
      activeProjection,
      activatePlan,
    ],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppData(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error("useAppData must be used within AppProvider");
  return value;
}
