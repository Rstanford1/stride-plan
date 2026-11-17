import { conversionPrompt } from "../domain/plan-conversion-prompt";
import {
  saveConversionFile,
  type ConversionFile,
} from "../data/plan-conversion-files";

export const planImportTabs = [
  "Start",
  "Get files",
  "Use AI",
  "Import",
  "Review",
] as const;
export type PlanImportTab = (typeof planImportTabs)[number];

export function PlanConversionGuide({
  tab,
  navigate,
  busy,
  perform,
}: {
  tab: PlanImportTab;
  navigate: (tab: PlanImportTab) => void;
  busy: boolean;
  perform: (message: string, operation: () => Promise<string>) => void;
}) {
  function download(kind: ConversionFile) {
    perform("Choose where to save the file…", () => saveConversionFile(kind));
  }
  return (
    <>
      {tab === "Start" && (
        <>
          <p>
            Bring your coach’s training plan into Stride Plan. Conversion
            happens outside Stride Plan. Importing and saving a draft leave your
            active training plan unchanged.
          </p>
          <div className="plan-import-choices">
            <div className="plan-import-card">
              <h4>I already have a Stride Plan JSON file</h4>
              <p>Import a previously converted training plan.</p>
              <button
                className="button primary"
                onClick={() => navigate("Import")}
              >
                Import JSON File →
              </button>
            </div>
            <div className="plan-import-card">
              <h4>My training plan is an Excel, PDF, or other document</h4>
              <p>
                Get the schema, example, and instructions for an external AI
                assistant.
              </p>
              <p>
                PDF conversion guidance is pending provenance review. Direct PDF
                source records are not supported by JSON 1.1.
              </p>
              <button
                className="button secondary"
                onClick={() => navigate("Get files")}
              >
                Get Started →
              </button>
            </div>
          </div>
        </>
      )}
      {tab === "Get files" && (
        <>
          <h3>Get Conversion Files</h3>
          <p>
            These two files are included with Stride Plan and available offline.
            Save each file, then provide both to your AI assistant along with
            your coach’s original plan.
          </p>
          <div className="plan-import-choices">
            <div className="plan-import-card">
              <h4>Training Plan JSON Schema 1.1</h4>
              <p>The authoritative format Stride Plan validates.</p>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => download("schema")}
              >
                Download JSON Schema
              </button>
            </div>
            <div className="plan-import-card">
              <h4>Synthetic Example Plan</h4>
              <p>
                Fictional data illustrating the structure. It is not a training
                recommendation.
              </p>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => download("example")}
              >
                Download Example Plan
              </button>
            </div>
          </div>
          <button className="button primary" onClick={() => navigate("Use AI")}>
            Next: Use AI →
          </button>
        </>
      )}
      {tab === "Use AI" && (
        <>
          <h3>Convert With AI</h3>
          <p>Use an external AI assistant of your choice.</p>
          <ol className="plan-import-steps">
            <li>
              <strong>Prepare your coach’s plan.</strong>
              <p>
                Include all relevant pages, worksheets, notes, and instructions.
              </p>
            </li>
            <li>
              <strong>Provide the materials to an AI assistant.</strong>
              <p>
                Upload the original plan, the schema, and the example, and paste
                the instructions supplied by Stride Plan.
              </p>
            </li>
            <li>
              <strong>Save the converted JSON.</strong>
              <p>
                Request a downloadable UTF-8 .json file named
                stride-plan-training-plan.json. You should not need to edit JSON
                manually.
              </p>
            </li>
            <li>
              <strong>Import and review.</strong>
              <p>
                Return here, select the downloaded file, compare the preview
                against the coach’s original, and save a draft.
              </p>
            </li>
          </ol>
          <p>
            PDF-specific conversion guidance remains pending provenance review.
            The original instructions require the AI to disclose unsupported
            source formats and never fabricate provenance.
          </p>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() =>
              perform("Copying AI instructions…", async () => {
                await navigator.clipboard.writeText(conversionPrompt);
                return "AI instructions copied. Paste them into your chosen assistant.";
              })
            }
          >
            Copy AI Instructions
          </button>
          <p>
            Uploading your coach’s document to an external AI is your decision.
            Stride Plan does not send the document to any provider.
          </p>
          <button className="button primary" onClick={() => navigate("Import")}>
            I Have My Converted JSON →
          </button>
        </>
      )}
    </>
  );
}
