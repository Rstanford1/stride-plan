# Stride Plan project instructions

## Start here

1. Read `README.md`, `DESIGN.md`, `UI_INVENTORY.md`, and `ROADMAP.md`.
2. Check the current branch, working tree, recent commits, and open work before editing.
3. Treat GitHub `main` as the source of truth; fetch before starting.
4. Identify the component status and approved specification. Do not infer approval from a backlog item.

## Product boundaries

- Windows-only, local-first personal running plan and journal.
- No account, hosted backend, telemetry, social features, gamification, AI coaching, or cloud storage.
- Never diagnose injury, prescribe treatment/training, or automatically rewrite the plan.
- Preserve original planned values separately from revisions and actual outcomes.
- Flexible mileage stays outside core completion; extra mileage cannot complete a missed core session.
- Keep source workbooks and FIT files unchanged. Never commit personal data, databases, FIT files, backups, credentials, or imports.

## Architecture

- Tauri 2 desktop shell in `src-tauri/`.
- React 19 + TypeScript + Vite UI in `src/`.
- `src/screens/`: screen composition; `src/components/`: shared UI/forms.
- `src/domain/`: pure, independently tested rules, metrics, imports, observations, and backup logic.
- `src/data/`: React application state and persistence adapters.
- Browser development uses localStorage; packaged runtime uses SQLite through the Tauri SQL plugin.
- Keep calculations and validation out of presentation components where practical.

## Design collaboration rules

- Discuss subjective UI changes before coding.
- Review one component or tightly related workflow at a time.
- Explain current behavior, separate objective defects from preferences, propose alternatives with tradeoffs, and ask focused questions.
- Record an approved component specification in `DESIGN.md` before implementation.
- Update the component status in `UI_INVENTORY.md` and the work item in `ROADMAP.md` as it progresses.
- Preserve unrelated behavior and avoid broad rewrites.
- Do not merge to `main` without explicit user approval.

## Git workflow

- Branch from current `origin/main`.
- Use names such as `design/today-dashboard`, `feature/fit-import`, `fix/current-date`, or `docs/ui-ux-audit`.
- Keep commits scoped and descriptive.
- Push the branch for review; do not force-push shared branches.
- Never commit generated output or personal data. Review staged file names before every commit.

## Required checks

Run the full local gate before requesting review:

```powershell
pnpm verify
```

This runs formatting, TypeScript, all tests, and the production frontend build. Add targeted tests for changed domain rules and important state transitions. For UI changes, verify keyboard operation, focus visibility, empty/error/disabled states, and relevant window sizes. Package with `pnpm tauri build` when Rust/MSVC are available or through the Windows GitHub workflow.

## Documentation completion rule

A component is not **Complete** until its approved specification, implementation, relevant tests, verification result, and user acceptance are recorded. If evidence is missing, state whether behavior was verified in code, rendered in the browser, exercised in Tauri, or inferred.
