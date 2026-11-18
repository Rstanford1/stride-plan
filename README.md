# Stride Plan

Stride Plan is a Windows-first, local running-plan and journal application. It keeps the original prescription separate from plan edits and recorded outcomes, supports bundled activities and lap roles, and shows deterministic review prompts without providing medical advice or training prescriptions.

## What is included

- Today dashboard with the current prescription, week progress, imported-activity queue, and a focused run-review form.
- Weekly plan with phase labels, flexible sessions, additions, edits, identity-preserving moves, and revision history.
- Activity review for plan matching, bundles, primary/supporting roles, and lap classification.
- Weekly review with core and flexible planned mileage, actual mileage, completion, outcomes, long run, run days, and explainable observations.
- Two restrained trends with accessible table alternatives.
- Training Plan JSON 1.1/1.2 validation and preview, one durable draft with exact source preservation and recovery, legacy JSON snapshot export/restore, editable reference values, and FIT import handoff.
- A Tauri 2 shell, SQLite migration, browser development fallback, and testable domain modules.

## Run for development

Requirements: Node.js 22+ and pnpm.

```powershell
pnpm install --ignore-scripts
pnpm dev
```

Open `http://127.0.0.1:1420`. In browser development, data is stored in browser local storage. Keyboard shortcuts `Alt+1` through `Alt+6` open the main sections.

For the simplest Windows workflow, double-click `Start-App.ps1`. It installs dependencies when needed and starts the local app.

## Checks

```powershell
pnpm typecheck
pnpm test
pnpm format:check
pnpm build
```

Run every required check with one command:

```powershell
pnpm verify
```

You can also double-click `Test-App.ps1`. The same verification runs automatically in GitHub Actions for every pull request and every push to `main`.

## Package for Windows

Install the stable Rust toolchain and the Windows WebView2/MSVC prerequisites, then run:

```powershell
pnpm tauri build
```

Tauri is configured to produce MSI and NSIS installers. The packaged build uses `sqlite:stride-plan.db`; the first migration is in `src-tauri/migrations/0001_initial.sql`.

`Build-App.ps1` performs the checks and builds both Windows packages. GitHub's **Build Windows installer** workflow can do this on a Windows runner without requiring Rust or Visual Studio on the development computer.

## Change workflow

1. Create a branch: `git switch -c change/short-description`.
2. Make and review the change with `Start-App.ps1`.
3. Run `Test-App.ps1`.
4. Commit only after the checks pass.
5. Push the branch and open a pull request when GitHub access is available.

GitHub access is optional for local development. Personal run records, FIT files, databases, backups, imports, and environment files are excluded from Git.

## Data and backups

### Optional Garmin Personal API (B04; legacy T04)

In the Windows desktop app, open **Data & settings → Integrations → Garmin
Connect**. Create a key using the official link, paste it into the masked input,
and choose **Connect and Verify**. The key is stored only in Windows Credential
Manager for the current Windows user (`com.strideplan.desktop/garmin-personal-api/v1`).
Tokens remain in memory; restart reuses the saved key to acquire a fresh token
only when you explicitly verify or request activities. Browser mode cannot connect.

Choose **List recent activities**, select one of up to five recent runs, then
**Retrieve selected activity**. Rust accepts one bounded ZIP/FIT, validates
framing/CRC, computes SHA-256 and preserves exact bytes using B03. A separate
immutable `.garmin-<activityId>.json` receipt beside the FIT stores provider ID
and hash. These are source/provenance objects, not workouts. They do not affect
training totals, the plan, shoes or the Activity Review queue. Repeating a retrieval
reuses the same content object. Disconnect deletes the saved credential and
in-memory token; source files and receipts remain. Legacy JSON backups exclude
credentials, tokens, original FIT bytes and these native receipts.

**Release gate:** this integration is personal-use feasibility work. Garmin's
Personal API is not intended for commercial applications serving multiple users;
public/commercial integration distribution requires authorization/licensing review.
See [Garmin's Personal API FAQ](https://developer.garmin.com/gc-developer-program/personal/personal-faq/)
and the B04 record in DESIGN.md. User-supplied keys do not waive this gate.

- Packaged app database: the Tauri application-data folder for `com.strideplan.desktop`, normally `%APPDATA%\com.strideplan.desktop\stride-plan.db` on Windows.
- Browser development data: local storage for the development origin.
- Legacy JSON snapshots (exclude original FIT bytes): saved wherever the user chooses through **Data & settings → Export backup**.
- Coach documents: convert independently before import; Stride Plan never opens or modifies the original workbook/PDF.

## Plan import format

Training plans are imported only as **Training Plan JSON 1.1 or 1.2**, through
**Data & settings → JSON training-plan draft**. Convert a coach-provided Excel,
CSV, PDF or other document using an external AI agent of your choosing before
importing. Stride Plan does not parse spreadsheets or PDFs and does not integrate
an AI provider or request AI credentials. The authoritative
[versioned JSON schemas and contract](schemas/training-plan/README.md) describe the
accepted format. Stride Plan validates the result, preserves provenance and
exact original JSON bytes, previews errors/warnings and saves a draft. Activation
will require a later explicitly confirmed workflow.

Select a JSON 1.1 or 1.2 file, review its validation preview, and choose **Save as draft**.
Use **Reopen saved draft** after restarting. This keeps one read-only draft and
its exact original JSON bytes; it does not activate the plan or change workouts.
Identical files reuse the draft, while different bytes produce a conflict.

**Export draft recovery** includes only that draft, its validation/provenance
records and original JSON bytes. In Windows it opens Save As with the suggested
name `stride-plan-draft-recovery.json`. Confirmation beside the button shows the
chosen location only after the saved file has been verified; cancellation saves
nothing. **Import draft recovery** can recover it into
an empty draft slot. Legacy JSON backups exclude native drafts and original plan
and FIT files; legacy restore/reset is blocked while a draft exists. Browser
development supports preview only. See DESIGN.md for the supported migration
baseline, retained pre-migration safety copies and remaining acceptance checks.

Unsupported non-JSON files receive conversion guidance before any bytes are read.
Previously imported plans, original/revised prescriptions, import fingerprints
and workout history remain readable; removing direct spreadsheet import does
not migrate or remove saved data.

## Current limitations

- The FIT foundation decodes files, keeps immutable normalized samples and laps, detects byte-identical duplicates, and records partial-success import batches. The packaged app preserves a verified untouched source copy; browser development labels durable preservation unavailable. Activity Review confirmation is still being implemented.
- B06 built Windows MSI and NSIS installers successfully. Packaged interactive acceptance remains pending; verification did not launch or migrate the real application profile.
- The browser fallback stores the canonical state as one local snapshot; the packaged repository stores that snapshot in SQLite while the normalized tables are ready for incremental persistence.
- The built-in plan is the 13-week November 2, 2026–January 31, 2027 block: Monday flexible recovery, Friday rest, cutbacks in weeks 4/8/12, threshold sessions from week 6, and a 50-mile peak.
- Direct CSV/XLS/XLSX and PDF plan import are unsupported. Guided external-AI conversion (B07), representative coach-plan validation (B08), and broader JSON import/draft refinement (T11) remain future work.

## Next improvements

1. Complete the approved Activity Review decisions, validation, draft persistence, and atomic confirmation on top of the FIT ingest foundation.
2. Persist each domain aggregate through the normalized SQLite tables and add migration/restore integration tests.
3. Add optional session drag-and-drop with a fully keyboard-equivalent move command and richer multi-activity bundle suggestions.

B02 saved-state recovery and legacy restore compatibility, safety-copy locations,
verification and native-runtime limits are recorded in [DESIGN.md](DESIGN.md#b02-verification-and-recovery-record-legacy-record-t02). This build supports snapshot versions 2–4;
version-5/6 development profiles must use a compatible application and are never
downgraded. Legacy JSON cannot replace newer native records.

T08.1 adds independent weekly targets, scheduling/priority classifications and
separate user-policy evidence to JSON 1.2, within read-only preview and drafts.
The supplied conversion schema/example/instructions now target 1.2; existing 1.1
files and recognized historical drafts retain their original validation identity.
Saving/recovering a 1.2 draft can upgrade draft storage after a verified safety copy.
Older builds may reject that database. See [T08.1 Windows acceptance and manual
pre-migration recovery](docs/T08_1_WINDOWS_ACCEPTANCE.md), including the warning
that restoring an older backup discards later changes from the restored profile.
