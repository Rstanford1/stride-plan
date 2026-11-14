# Stride Plan

Stride Plan is a Windows-first, local running-plan and journal application. It keeps the original prescription separate from plan edits and recorded outcomes, supports bundled activities and lap roles, and shows deterministic review prompts without providing medical advice or training prescriptions.

## What is included

- Today dashboard with the current prescription, week progress, imported-activity queue, and a focused run-review form.
- Weekly plan with phase labels, flexible sessions, additions, edits, identity-preserving moves, and revision history.
- Activity review for plan matching, bundles, primary/supporting roles, and lap classification.
- Weekly review with core and flexible planned mileage, actual mileage, completion, outcomes, long run, run days, and explainable observations.
- Two restrained trends with accessible table alternatives.
- CSV/XLSX plan validation and repeat-import protection, legacy JSON snapshot export/restore, editable reference values, and FIT import handoff.
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

- Packaged app database: the Tauri application-data folder for `com.strideplan.desktop`, normally `%APPDATA%\com.strideplan.desktop\stride-plan.db` on Windows.
- Browser development data: local storage for the development origin.
- Legacy JSON snapshots (exclude original FIT bytes): saved wherever the user chooses through **Data & settings → Export backup**.
- Source workbook: read only. It is never modified by the import flow.

## Plan import format

The importer accepts the replacement workbook's `Plan` sheet, the earlier `Daily Plan` structure, or a CSV/XLSX first sheet with these headers:

`date,title,planned_miles,session_type,guidance,instructions,flexible,phase`

Dates use `YYYY-MM-DD`; session type is `rest`, `easy`, `recovery`, `workout`, or `long`. A preview reports invalid rows and same-day sessions before import. Exact file fingerprints and stable row keys prevent silent duplicate imports.

## Current limitations

- The FIT foundation decodes files, keeps immutable normalized samples and laps, detects byte-identical duplicates, and records partial-success import batches. The packaged app preserves a verified untouched source copy; browser development labels durable preservation unavailable. Activity Review confirmation is still being implemented.
- The Tauri/SQLite source and migrations are present. Rust and the Windows toolchain are available, but packaging currently stops because the project does not yet contain the required `src-tauri/icons/icon.ico` application icon.
- The browser fallback stores the canonical state as one local snapshot; the packaged repository stores that snapshot in SQLite while the normalized tables are ready for incremental persistence.
- The built-in plan is the 13-week November 2, 2026–January 31, 2027 block: Monday flexible recovery, Friday rest, cutbacks in weeks 4/8/12, threshold sessions from week 6, and a 50-mile peak.
- Import preview supports the reference `Plan` and `Daily Plan` structures plus the documented row format. Arbitrary workbook layouts are intentionally rejected.

## Next improvements

1. Complete the approved Activity Review decisions, validation, draft persistence, and atomic confirmation on top of the FIT ingest foundation.
2. Persist each domain aggregate through the normalized SQLite tables and add migration/restore integration tests.
3. Add optional session drag-and-drop with a fully keyboard-equivalent move command and richer multi-activity bundle suggestions.

T02 saved-state recovery and legacy restore compatibility, safety-copy locations,
verification and native-runtime limits are recorded in [DESIGN.md](DESIGN.md#t02-verification-and-recovery-record). This build supports snapshot versions 2–4;
version-5/6 development profiles must use a compatible application and are never
downgraded. Legacy JSON cannot replace newer native records.
