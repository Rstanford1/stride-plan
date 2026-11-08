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
  Shoe,
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
