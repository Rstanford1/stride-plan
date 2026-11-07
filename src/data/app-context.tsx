import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { PropsWithChildren } from "react";
import { createRepository } from "./repository";
import { createInitialData } from "../domain/seed";
import { reviseSession, type SessionUpdate } from "../domain/rules";
import type {
  Activity,
  AppData,
  AppSettings,
  JournalEntry,
  LapRole,
  PlannedSession,
} from "../domain/types";

interface AppContextValue {
  data: AppData;
  ready: boolean;
  saveSession: (
    sessionId: string,
    update: SessionUpdate,
    reason: string,
  ) => void;
  addSession: (session: PlannedSession) => void;
  saveJournal: (entry: JournalEntry) => void;
  updateActivity: (activityId: string, update: Partial<Activity>) => void;
  updateLapRole: (activityId: string, lapId: string, role: LapRole) => void;
  updateSettings: (update: Partial<AppSettings>) => void;
  replaceData: (data: AppData) => void;
  resetDemo: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: PropsWithChildren) {
  const repository = useMemo(() => createRepository(), []);
  const [data, setData] = useState<AppData>(createInitialData);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    repository.load().then((loaded) => {
      setData(loaded);
      setReady(true);
    });
  }, [repository]);

  useEffect(() => {
    if (ready) void repository.save(data);
  }, [data, ready, repository]);

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
      saveSession,
      addSession,
      saveJournal,
      updateActivity,
      updateLapRole,
      updateSettings,
      replaceData: setData,
      resetDemo: () => setData(createInitialData()),
    }),
    [
      data,
      ready,
      saveSession,
      addSession,
      saveJournal,
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
