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
import { createInitialData } from "../domain/seed";
import { reviseSession, type SessionUpdate } from "../domain/rules";
import {
  confirmActivityReview,
  createRevisionDraft,
} from "../domain/activity-review";
import type {
  Activity,
  ActivityReviewDraft,
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
  persistenceState: "idle" | "saving" | "saved" | "error";
  persistenceError?: string;
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
  const saveVersion = useRef(0);

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
