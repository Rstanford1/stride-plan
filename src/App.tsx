import {
  Activity,
  CalendarRange,
  ChartNoAxesCombined,
  Database,
  Footprints,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
} from "lucide-react";
import { useEffect, useState } from "react";
import { TodayScreen } from "./screens/TodayScreen";
import { PlanScreen } from "./screens/PlanScreen";
import { ActivityReviewScreen } from "./screens/ActivityReviewScreen";
import { WeeklyReviewScreen } from "./screens/WeeklyReviewScreen";
import { TrendsScreen } from "./screens/TrendsScreen";
import { DataScreen } from "./screens/DataScreen";
import { useAppData } from "./data/app-context";

type Screen = "today" | "plan" | "activities" | "review" | "trends" | "data";

const nav = [
  { id: "today", label: "Today", icon: Sun },
  { id: "plan", label: "Plan", icon: CalendarRange },
  { id: "activities", label: "Activities", icon: Activity },
  { id: "review", label: "Weekly review", icon: Footprints },
  { id: "trends", label: "Trends", icon: ChartNoAxesCombined },
  { id: "data", label: "Data & settings", icon: Database },
] as const;

export default function App() {
  const { ready } = useAppData();
  const [screen, setScreen] = useState<Screen>("today");
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.altKey && /^[1-6]$/.test(event.key))
        setScreen(nav[Number(event.key) - 1].id);
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  if (!ready)
    return (
      <div className="loading">
        <Footprints size={28} />
        <span>Opening your plan…</span>
      </div>
    );
  return (
    <div className={collapsed ? "app-shell sidebar-collapsed" : "app-shell"}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Footprints size={21} />
          </span>
          <div>
            <strong>Stride Plan</strong>
            <small>Personal running journal</small>
          </div>
        </div>
        <nav aria-label="Main navigation">
          {nav.map((item, index) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={screen === item.id ? "nav-item active" : "nav-item"}
                onClick={() => setScreen(item.id)}
                aria-current={screen === item.id ? "page" : undefined}
                title={`${item.label} (Alt+${index + 1})`}
              >
                <Icon size={19} />
                <span>{item.label}</span>
                <kbd>Alt {index + 1}</kbd>
              </button>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <p>
            <strong>Local only</strong>
            <span>Data stays on this device.</span>
          </p>
          <button
            className="collapse-button"
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <PanelLeftOpen size={18} />
            ) : (
              <PanelLeftClose size={18} />
            )}
            <span>Collapse</span>
          </button>
        </div>
      </aside>
      <main id="main-content" tabIndex={-1}>
        {screen === "today" && (
          <TodayScreen
            openActivityReview={() => setScreen("activities")}
            openPlan={() => setScreen("plan")}
          />
        )}
        {screen === "plan" && <PlanScreen />}
        {screen === "activities" && <ActivityReviewScreen />}
        {screen === "review" && <WeeklyReviewScreen />}
        {screen === "trends" && <TrendsScreen />}
        {screen === "data" && <DataScreen />}
      </main>
    </div>
  );
}
