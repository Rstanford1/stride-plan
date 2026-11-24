# Architecture map

Verified against source commit `15465e7845948bbd7652083a3c7152f088f1237f`.
This is a navigation aid, not a specification or acceptance record. Current code
is authoritative when this map becomes stale. Update it when architecture
materially changes, not as routine task bookkeeping. Paths below were checked
against the verified commit; inspect the current revision before relying on them.

## Authority and status

- Implemented behavior is described below as observed in the verified source,
  not as proof of browser, packaged Windows, or owner acceptance.
- Approved design and component status: [DESIGN.md](../DESIGN.md) and
  [UI_INVENTORY.md](../UI_INVENTORY.md). Proposals in
  [ROADMAP.md](../ROADMAP.md) are not approvals.
- Coordination and task boundaries: [AGENTS.md](../AGENTS.md) and
  [parallel development](PARALLEL_DEVELOPMENT.md). Existing task evidence is
  indexed in [TASK_HISTORY.md](TASK_HISTORY.md).
- The implemented, owner-approved contract supports JSON 1.2 alongside 1.1.
  Earlier 1.1-only instructions predate the extension; the
  [contract documentation](../schemas/training-plan/README.md) records its
  approval and acceptance status. Version-specific validation does not upgrade
  1.1 documents to 1.2.

## Entry points and UI

- [src/main.tsx](../src/main.tsx) mounts React; [src/App.tsx](../src/App.tsx)
  composes navigation and the application shell. Vite configuration is in
  [vite.config.ts](../vite.config.ts).
- [src/data/app-context.tsx](../src/data/app-context.tsx) supplies application
  state, commands, loading, and persistence coordination to screens.
- [src/screens/TodayScreen.tsx](../src/screens/TodayScreen.tsx) and
  [TodayDashboard.tsx](../src/screens/TodayDashboard.tsx) cover daily views;
  [PlanScreen.tsx](../src/screens/PlanScreen.tsx) covers the week and plan edits.
- [ActivityReviewScreen.tsx](../src/screens/ActivityReviewScreen.tsx) handles
  imported activity review; [DataScreen.tsx](../src/screens/DataScreen.tsx)
  hosts data workflows; [TrendsScreen.tsx](../src/screens/TrendsScreen.tsx),
  [WeeklyReviewScreen.tsx](../src/screens/WeeklyReviewScreen.tsx), and
  [ShoesScreen.tsx](../src/screens/ShoesScreen.tsx) provide other views.
- Shared workflows and controls live in [src/components](../src/components),
  including [RunEntryWorkflow.tsx](../src/components/RunEntryWorkflow.tsx),
  [PlanDraftPanel.tsx](../src/components/PlanDraftPanel.tsx), and
  [GarminIntegration.tsx](../src/components/GarminIntegration.tsx).
  Shared styling is in [src/styles.css](../src/styles.css).

## Domain and data ownership

- [src/domain/types.ts](../src/domain/types.ts) defines the `AppData` snapshot
  and its sessions, revisions, activities, journals, shoes, and settings.
  Original planned values, subsequent revisions, and actual outcomes have
  distinct roles; review their types and update paths together.
- [rules.ts](../src/domain/rules.ts) handles session revisions and validation;
  [run-entry.ts](../src/domain/run-entry.ts) validates manual entries.
  [metrics.ts](../src/domain/metrics.ts) and
  [observations.ts](../src/domain/observations.ts) derive review information.
- [app-data.ts](../src/domain/app-data.ts) upgrades snapshots;
  [snapshot-validation.ts](../src/domain/snapshot-validation.ts) checks their
  integrity; [backup.ts](../src/domain/backup.ts) handles backup serialization.
- [repository.ts](../src/data/repository.ts) selects browser localStorage or
  Tauri SQLite and serializes writes. The active application snapshot is stored
  in localStorage or the SQLite `app_state` row; normalized migration tables
  should not be assumed to be the active source of every aggregate.
- [restore.ts](../src/data/restore.ts) and the repository coordinate restore
  and recovery. Read their integrity checks before changing persistence.
- [training-plan.ts](../src/domain/training-plan.ts) dispatches versioned plan
  validation. [1.1.schema.json](../schemas/training-plan/1.1.schema.json) and
  [1.2.schema.json](../schemas/training-plan/1.2.schema.json) define separate
  document contracts, distinct from snapshot and database versions.
- [plan-draft-store.ts](../src/data/plan-draft-store.ts) previews and saves plan
  drafts; [plan-validator-registry.ts](../src/data/plan-validator-registry.ts)
  tracks validator identities. Draft source evidence is separate from the active
  `AppData` snapshot; saving a draft does not activate it.
- [fit-decoder.ts](../src/domain/fit-decoder.ts),
  [fit-import-controller.ts](../src/data/fit-import-controller.ts), and
  [fit-import-commit.ts](../src/data/fit-import-commit.ts) cover decoding,
  batch orchestration, and snapshot updates. The source-store boundary is
  [fit-source-store.ts](../src/data/fit-source-store.ts); preserve original
  source bytes and distinguish them from decoded and reviewed records.

## Native shell and database

- [src-tauri/src/main.rs](../src-tauri/src/main.rs) enters
  [lib.rs](../src-tauri/src/lib.rs), which registers plugins, migrations, and
  native commands. [tauri.conf.json](../src-tauri/tauri.conf.json) configures
  the shell and [capabilities/default.json](../src-tauri/capabilities/default.json)
  its permissions.
- [src-tauri/migrations](../src-tauri/migrations) contains ordered SQLite
  migrations. Inspect migrations and both repository implementations together
  before drawing conclusions about what is persisted where.
- [plan_draft_commands.rs](../src-tauri/src/plan_draft_commands.rs) and
  [plan_draft_store.rs](../src-tauri/src/plan_draft_store.rs) implement the
  native draft boundary; [fit_source_commands.rs](../src-tauri/src/fit_source_commands.rs)
  and [fit_source_store.rs](../src-tauri/src/fit_source_store.rs) handle FIT
  source storage. [garmin_commands.rs](../src-tauri/src/garmin_commands.rs)
  and [garmin.rs](../src/data/garmin.ts) form another native/UI boundary.
- The exact persistence representation, recovery behavior, and command contracts
  are owned by their implementations and tests, not by this summary.

## Investigation starting points

| Question                         | Start here, then follow callers and tests                                                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Daily view or manual entry       | `TodayScreen.tsx`, `TodayDashboard.tsx`, `RunEntryWorkflow.tsx`, `run-entry.ts`, `app-context.tsx`                                                |
| Plan edits or completion metrics | `PlanScreen.tsx`, `rules.ts`, `metrics.ts`, `types.ts`                                                                                            |
| JSON intake or draft recovery    | `DataScreen.tsx`, `PlanDraftPanel.tsx`, `training-plan.ts`, `plan-draft-store.ts`, native draft files, schema README                              |
| FIT ingest or review             | `fit-import-controller.ts`, `fit-decoder.ts`, `fit-source-store.ts`, `ActivityReviewScreen.tsx`; see [A3 evidence](A3_FIT_IMPORT_STATE_SAFETY.md) |
| Snapshot, backup, or upgrade     | `repository.ts`, `snapshot-validation.ts`, `restore.ts`, migrations and adjacent tests                                                            |
| Native shell or isolated QA      | `lib.rs`, `tauri.conf.json`, [browser QA](I13_BROWSER_QA.md), and the relevant acceptance evidence                                                |

Names in the table refer to linked paths above. Adjacent `*.test.*` files and
[src/test](../src/test) provide test starting points. For approved future work and
unresolved product decisions, consult the specifications and task evidence rather
than treating this map or a backlog item as authorization.
