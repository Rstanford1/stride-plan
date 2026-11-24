import { useRef, useState } from "react";
import { useAppData } from "../data/app-context";
import {
  NativeDraftStore,
  nativeDraftsAvailable,
  previewPlan,
  type PlanPreview,
} from "../data/plan-draft-store";
import { previewActivation } from "../domain/active-plan";

function localDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function PlanActivationPanel() {
  const { data, activePlan, activatePlan } = useAppData();
  const [preview, setPreview] = useState<PlanPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const today = localDate();
  const impact = preview?.validation.ok
    ? previewActivation(preview.validation.plan, data, today)
    : null;
  const diagnostics = preview?.validation.ok
    ? (impact?.diagnostics ?? [])
    : (preview?.validation.diagnostics ?? []);

  async function selectFile(selected: File) {
    setBusy(true);
    setMessage("");
    try {
      if (!/\.json$/i.test(selected.name))
        throw new Error("Choose a Training Plan JSON 1.1 or 1.2 file.");
      setPreview(
        await previewPlan(
          new Uint8Array(await selected.arrayBuffer()),
          selected.name,
        ),
      );
    } catch (error) {
      setPreview(null);
      setMessage(
        error instanceof Error ? error.message : "The plan could not be read.",
      );
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  }

  async function selectDraft() {
    setBusy(true);
    setMessage("");
    try {
      const saved = await new NativeDraftStore().read();
      if (!saved) throw new Error("No saved draft is available.");
      setPreview(saved.preview);
    } catch (error) {
      setPreview(null);
      setMessage(
        error instanceof Error
          ? error.message
          : "The saved draft could not be read.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!preview || !preview.validation.ok || diagnostics.length || busy)
      return;
    setBusy(true);
    setMessage("");
    try {
      await activatePlan(preview);
      setPreview(null);
      setMessage(
        "Plan activated and saved. Earlier sessions and results remain in history.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Activation did not complete. Reload saved data before retrying.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" aria-labelledby="activation-title">
      <h3 id="activation-title">Active training plan</h3>
      <p>
        {activePlan
          ? `${activePlan.source.manifest.planId} · effective ${activePlan.effectiveDate}`
          : "No validated JSON plan is active."}
      </p>
      <p>
        Activation applies the selected plan from today forward. Past sessions
        and recorded results stay in history.
      </p>
      <div className="button-row">
        <button
          type="button"
          className="button secondary"
          disabled={busy || !nativeDraftsAvailable()}
          onClick={() => file.current?.click()}
        >
          Choose plan JSON
        </button>
        <button
          type="button"
          className="button secondary"
          disabled={busy || !nativeDraftsAvailable()}
          onClick={() => void selectDraft()}
        >
          Use saved draft
        </button>
      </div>
      <input
        ref={file}
        hidden
        type="file"
        accept=".json,application/json"
        aria-label="Choose training plan JSON"
        onChange={(event) =>
          event.target.files?.[0] && void selectFile(event.target.files[0])
        }
      />
      {preview && (
        <div className="activation-preview">
          <h4>Review activation impact</h4>
          <p>
            {preview.fileName} ·{" "}
            {preview.validation.ok
              ? `${preview.validation.plan.manifest.planId} · JSON ${preview.validation.plan.schemaVersion}`
              : "Invalid plan"}
          </p>
          {impact && (
            <p>
              {impact.days} days and {impact.sessions} sessions from {today};{" "}
              {impact.replacingSessions} current or future sessions would be
              retired.{" "}
              {
                data.sessions.filter(
                  (session) =>
                    !session.retiredAt && session.scheduledDate < today,
                ).length
              }{" "}
              earlier sessions remain.
            </p>
          )}
          {diagnostics.length > 0 && (
            <ul aria-label="Activation blockers">
              {diagnostics.map((issue, index) => (
                <li key={`${issue.path}-${index}`}>
                  {issue.path || "/"}: {issue.message}
                </li>
              ))}
            </ul>
          )}
          {diagnostics.length === 0 && (
            <button
              type="button"
              className="button primary"
              disabled={busy}
              onClick={() => void confirm()}
            >
              Confirm activation from today
            </button>
          )}
        </div>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
