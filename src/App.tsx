import {
  Activity,
  CalendarRange,
  ChartNoAxesCombined,
  Footprints,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sun,
} from "lucide-react";
import { useEffect, useState } from "react";
import { TodayDashboard } from "./screens/TodayDashboard";
import { PlanScreen } from "./screens/PlanScreen";
import { ActivityReviewScreen } from "./screens/ActivityReviewScreen";
import { WeeklyReviewScreen } from "./screens/WeeklyReviewScreen";
import { TrendsScreen } from "./screens/TrendsScreen";
import { DataScreen } from "./screens/DataScreen";
import { ShoesScreen } from "./screens/ShoesScreen";
import { useAppData } from "./data/app-context";

type Screen =
  "today" | "training" | "activities" | "analytics" | "shoes" | "settings";
type TrainingView = "plan" | "review";

const nav = [
  { id: "today", label: "Today", icon: Sun },
  { id: "training", label: "Training", icon: CalendarRange },
  { id: "activities", label: "Activities", icon: Activity },
  { id: "analytics", label: "Analytics", icon: ChartNoAxesCombined },
  { id: "shoes", label: "Shoes", icon: Footprints },
  { id: "settings", label: "Settings", icon: Settings },
] as const;

export default function App() {
  const { ready, recoveryError, retryLoading } = useAppData();
  const [screen, setScreen] = useState<Screen>("today");
  const [trainingView, setTrainingView] = useState<TrainingView>("plan");
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.altKey && /^[1-6]$/.test(event.key)) {
        setScreen(nav[Number(event.key) - 1].id);
        document.getElementById("main-content")?.focus();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  if (recoveryError)
    return (
      <main className="screen" id="main-content">
        <section
          className="panel"
          role="alert"
          aria-labelledby="recovery-title"
        >
          <h1 id="recovery-title">Your saved data needs attention</h1>
          <p>
            <strong>
              {recoveryError.kind === "unsupported"
                ? "Unsupported data version"
                : recoveryError.kind === "corrupted"
                  ? "Invalid saved data"
                  : "Storage unavailable"}
            </strong>
          </p>
          <p>{recoveryError.message}</p>
          <p>
            Application writes are disabled. Your stored data and any safety
            copies are retained. Do not reset or delete your profile. Use the
            application version that created it, or correct the storage problem
            before retrying.
          </p>
          <button className="button primary" onClick={retryLoading}>
            Retry loading
          </button>
        </section>
      </main>
    );
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
          <span className="brand-mark" aria-hidden="true">
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
                aria-label={`${item.label}, Alt+${index + 1}`}
              >
                <Icon size={19} aria-hidden="true" />
                <span>{item.label}</span>
                <kbd aria-hidden="true">Alt {index + 1}</kbd>
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
            aria-expanded={!collapsed}
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
          <TodayDashboard
            openActivityReview={() => setScreen("activities")}
            openPlan={() => {
              setTrainingView("plan");
              setScreen("training");
            }}
          />
        )}
        {screen === "training" && (
          <div className="training-content">
            <div className="training-nav screen">
              <div>
                <p className="eyebrow">Plan and progress</p>
                <h1>Training</h1>
              </div>
              <nav aria-label="Training views">
                <button
                  className={trainingView === "plan" ? "active" : ""}
                  aria-current={trainingView === "plan" ? "page" : undefined}
                  onClick={() => setTrainingView("plan")}
                >
                  Plan
                </button>
                <button
                  className={trainingView === "review" ? "active" : ""}
                  aria-current={trainingView === "review" ? "page" : undefined}
                  onClick={() => setTrainingView("review")}
                >
                  Weekly Review
                </button>
              </nav>
            </div>
            {trainingView === "plan" ? <PlanScreen /> : <WeeklyReviewScreen />}
          </div>
        )}
        {screen === "activities" && <ActivityReviewScreen />}
        {screen === "analytics" && <TrendsScreen />}
        {screen === "shoes" && <ShoesScreen />}
        {screen === "settings" && <DataScreen />}
      </main>
    </div>
  );
}
