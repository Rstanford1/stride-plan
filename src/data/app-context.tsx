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
import { createRepository, type AppRepository } from "./repository";
import { createInitialData } from "../domain/seed";
import {
  DataIntegrityError,
  storageError,
} from "../domain/snapshot-validation";
import { reviseSession, type SessionUpdate } from "../domain/rules";
import type {
  Activity,
  AppData,
  AppSettings,
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
  replaceData: (data: AppData) => void;
  resetDemo: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({
  children,
  repository: suppliedRepository,
}: PropsWithChildren<{ repository?: AppRepository }>) {
  const repository = useMemo(
    () => suppliedRepository ?? createRepository(),
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
  const [recoveryError, setRecoveryError] = useState<DataIntegrityError | null>(
    null,
  );
  const [attempt, setAttempt] = useState(0);
  const writable = useRef(false);
  const restoring = useRef(false);
  const persisted = useRef<AppData | null>(null);
  const currentData = useRef(data);
  currentData.current = data;
  const setData = useCallback((update: React.SetStateAction<AppData>) => {
    if (!writable.current || restoring.current) return;
    publishData(update);
  }, []);
  const fail = useCallback((error: unknown) => {
    writable.current = false;
    setRecoveryError(storageError(error));
    setReady(false);
  }, []);
  const retryLoading = useCallback(() => {
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
      .then((loaded) => {
        if (!active) return;
        persisted.current = loaded;
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
      writable.current = false;
    };
  }, [repository, attempt, fail]);
  useEffect(() => {
    if (
      !ready ||
      !writable.current ||
      restoring.current ||
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
      if (!writable.current || restoring.current || !repository.restore)
        throw new DataIntegrityError(
          "inaccessible",
          "Safe restore is unavailable while data is unresolved.",
        );
      restoring.current = true;
      try {
        // Flush edits before capturing the durable pre-restore snapshot.
        if (persisted.current !== currentData.current) {
          await repository.save(currentData.current);
        }
        const restored = await repository.restore(raw);
        persisted.current = restored;
        publishData(restored);
      } catch (error) {
        fail(error);
        throw error;
      } finally {
        restoring.current = false;
      }
    },
    [repository, fail],
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

  const value = useMemo(
    () => ({
      data,
      ready,
      recoveryError,
      retryLoading,
      restoreBackup,
      saveSession,
      addSession,
      saveJournal,
      saveRunEntry,
      addShoe,
      updateActivity,
      updateLapRole,
      updateSettings,
      replaceData: setData,
      resetDemo: () => setData(createInitialData()),
    }),
    [
      data,
      ready,
      recoveryError,
      retryLoading,
      restoreBackup,
      saveSession,
      addSession,
      saveJournal,
      saveRunEntry,
      addShoe,
      updateActivity,
      updateLapRole,
      updateSettings,
    ],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppData(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error("useAppData must be used within AppProvider");
  return value;
}
