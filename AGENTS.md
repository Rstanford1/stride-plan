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

- For navigation, consult `docs/ARCHITECTURE_MAP.md` and `docs/TASK_HISTORY.md`; load linked details as needed. Follow `docs/PARALLEL_DEVELOPMENT.md` for task authority and coordination.
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
- Record approved component behavior and task evidence in the task's own specification and evidence files. Project Coordination alone updates the shared tracker documents (`docs/PROJECT_STATUS.md`, `ROADMAP.md`, and `UI_INVENTORY.md`) unless it explicitly assigns that update in the task boundary.
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

## Additional repository and AI-agent safeguards

- Multiple Git worktrees may contain valuable uncommitted work. Inspect `git worktree list` and relevant working-tree status before making changes. Never reset, clean, stash, delete, switch, or overwrite protected work without explicit authorization.
- Use an isolated worktree for new coding tasks. Do not treat the root working tree as disposable.
- Distinguish **approved design decisions**, **proposed roadmap items**, and **implemented behavior**. If they conflict, stop and report the conflict rather than inventing a resolution.
- Training-plan intake is JSON 1.1 or 1.2 only (owner-approved T08.1 extension). Excel, CSV, PDF and other coach documents are converted externally. Stride Plan validates the JSON, preserves exact original bytes and instructions, and saves a draft without automatically activating it.
- Do not reintroduce workbook parsing, embedded AI integrations, or automatic plan activation without new approval.
- Local coding agents must work within a clearly defined task boundary, preserve unrelated files, add targeted tests, and report changes and limitations. Do not independently redesign workflows or merge branches.
- For experimental local agents, allow one implementation attempt and at most one focused correction before escalating for review.
- Report exactly which checks passed and whether evidence came from unit tests, browser rendering, or packaged Windows acceptance.

## Parallel development and integration

- Follow `docs/PARALLEL_DEVELOPMENT.md` for every concurrent task. Before work, verify repository/tool access, fetched `origin/main`, GitHub access available to the task, active PRs, and the local worktree state.
- Use one dedicated branch and isolated worktree per approved task. Own that task end-to-end: make ordinary in-scope technical decisions, repair formatting/compilation/tests, resolve mechanical conflicts in your own branch, verify, commit, push, and open or update a draft PR when access permits.
- Before implementation, identify overlapping files, shared interfaces, migrations, dependencies, and the named owner for each shared document. Project Coordination owns the master tracker; task agents preserve approved decisions and evidence in task-specific records unless assigned a shared-document update.
- Escalate only material scope, product, architecture, safety, security, data-integrity, semantic-conflict, or integration decisions. Do not use routine uncertainty to delay an approved task.
- Never use destructive Git commands (`reset`, `clean`, `stash`, forced checkout, or force-push) in another agent's workspace. Never merge automatically, release, change GitHub settings, or merge without explicit owner authorization.
- Test only with synthetic or isolated data and profiles. Do not open, read, or write the normal installed Stride Plan profile during development or acceptance.
- Preserve exact tested revisions and acceptance evidence. PR reports state source and acceptance SHAs, changed files, local and hosted verification, conflicts/resolutions, remaining work, and packaged Windows acceptance status when applicable; retain legacy B/T and I/A references in history and acceptance evidence.
