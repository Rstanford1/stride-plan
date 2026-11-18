# Stride Plan roadmap

## Status key

**Backlog**, **Under discussion**, **Approved**, **In progress**, **Testing**, **Complete**, **Blocked**.

No redesign item is approved by this audit. Priorities are recommendations for discussion.

## Audit summary

Strengths:

- Clear local-first product boundary and strong separation of plan, revisions, and actual outcomes.
- Restrained, consistent desktop visual language with good base keyboard focus and text status indicators.
- Pure domain calculations for major metrics and observations, with explainable evidence models.
- Repeatable local verification: formatting, types, 17 tests, and production build all pass.
- Useful screen architecture: Today, Plan, Activities, Weekly Review, Trends, and Data map cleanly to product tasks.

## Recommended priorities

| Priority | Item                                                                                                                                                                                               | User impact                                                                                | Complexity  | Dependencies                                           | Status      |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------- | ------------------------------------------------------ | ----------- |
| P0       | Make Today derive the actual local date, current plan week, next session, and recent-import window.                                                                                                | Critical: the primary screen currently shows stale information.                            | Medium      | Date service and deterministic date tests              | Testing     |
| P0       | Complete the run-recording workflow for today and planned prior days, with review and save feedback.                                                                                               | Critical daily workflow.                                                                   | Medium      | Unplanned/rest-day entry remains a follow-up           | Testing     |
| P0       | Implement the approved shared FIT ingest foundation: decoding, immutable samples/laps, source preservation, structured duplicates, batches, and recoverable failures.                              | Makes the primary import path real and safe.                                               | High        | FIT decoder, fixtures, migrations, ordered persistence | In progress |
| P0       | Implement the approved Activity Review workspace: issue-first progressive disclosure, source rail, optional pace/segment editing, bundles, shoes, validation, confirmation, drafts, and revisions. | Completes imported-run review without overwhelming simple imports or altering source data. | High        | FIT samples, matching/bundle/segment/shoe domain rules | Approved    |
| P1       | Correct metric consistency, especially run days from manual journals and unit conversion.                                                                                                          | Weekly review trust.                                                                       | Medium      | Date/unit formatting services                          | Backlog     |
| P1       | Make plan moves update week membership and make new-session week/date behavior explicit.                                                                                                           | Protects plan accuracy.                                                                    | Medium      | Session scheduling rule                                | Backlog     |
| P1       | Harden restore/import flows with full schema validation, preview, confirmation, rollback, and an actual plan diff.                                                                                 | Protects local data.                                                                       | Medium–high | Versioned backup/import service                        | Backlog     |
| P1       | Add persistence error handling and serialized saves; decide whether to use normalized SQLite tables or remove them.                                                                                | Data durability and maintainability.                                                       | Medium      | Repository design decision                             | Backlog     |
| P1       | Add component/workflow tests for Today, run entry, plan actions, import/restore, Activity Review, and keyboard flows.                                                                              | Regression protection.                                                                     | Medium      | Stable interaction specifications                      | Backlog     |
| P2       | Review responsive behavior and 200% scaling; remove hard minimum-width assumptions and provide table alternatives.                                                                                 | Accessibility and smaller windows.                                                         | Medium      | Approved layout behavior                               | Backlog     |
| P2       | Establish approved design tokens for spacing, type, color, control sizes, states, and messaging.                                                                                                   | Consistency and maintainability.                                                           | Low–medium  | Component review decisions                             | Backlog     |
| P2       | Improve empty, loading, success, error, and disabled states across screens.                                                                                                                        | Clarity and confidence.                                                                    | Medium      | Messaging conventions                                  | Backlog     |
| P2       | Rework Trends empty states and choose which signals genuinely help.                                                                                                                                | Avoids empty/noisy dashboards.                                                             | Low–medium  | Metrics trust                                          | Backlog     |
| P3       | Split the global CSS and large Data screen into maintainable feature modules after behavior stabilizes.                                                                                            | Developer maintainability.                                                                 | Medium      | Approved design system                                 | Backlog     |

## A3 integrity fix — November 17, 2026

**Testing; review and isolated packaged Windows/owner acceptance pending** on
`codex/a3-fit-import-state-safety`, based on `origin/main` `0f98fee`.
Authorized scope: latest-state FIT batch commit, commit-time hash deduplication,
dataset-generation invalidation and ordered snapshot publication. Synthetic
React/context/controller/browser and real SQLite regression evidence is in
[the A3 record](docs/A3_FIT_IMPORT_STATE_SAFETY.md). This is not approval of other
backup/restore or UI redesign backlog items. Do not mark Complete or merge before
review and explicit owner approval.

## Known technical findings

- Today, Next Up, and recent imports use fixed November 2026 dates.
- FIT selection now decodes files, records immutable samples and laps, detects exact duplicates, preserves verified source bytes in the packaged app, and records partial-success batches. Activity Review decisions and confirmation remain to be implemented.
- “Confirm reviewed” has no action.
- Distance-unit preference is stored but formatting always displays miles.
- Manual journal mileage is counted, but manual journal dates do not count as run days.
- Session `week` is not recalculated when a move crosses week boundaries.
- The SQLite migration defines normalized tables, while runtime persistence uses one JSON row in `app_state`.
- T06 Windows packaging passes for MSI and NSIS. Packaged interactive acceptance remains pending; no real profile was launched or migrated.
- Repository save failures are not surfaced; rapid updates may complete out of order.
- Backup validation checks top-level shapes only.
- New plan intake is JSON 1.1 preview/draft only; duplicate detection uses exact original bytes. Direct CSV/XLS/XLSX parsing is retired by revised T06. Activation and broader JSON import integration remain future work.
- Only domain/repository tests exist; there are no rendered component or end-to-end tests.
- The hard minimum page width produces horizontal scrolling and threatens 200% scaling support.
- The Tauri capabilities include broad default filesystem/dialog/SQL permissions and should be reviewed against actual use.

## Recommended component review order

1. **Today dashboard and daily logging workflow** — highest-frequency task and currently date-inaccurate.
2. **Run result dialog and session status model** — defines the core “what happened” interaction used by Today and Plan.
3. **Weekly Plan table and plan-edit/move actions** — establishes date/week behavior and discoverable historical entry.
4. **Data safety: backup, restore, and plan import** — resolve destructive and repeat-import expectations before more data exists.
5. **FIT import and Activity Review** — design the complete ingest/match/bundle/confirm workflow together.
6. **Weekly Review metrics and observations** — refine once data capture and metric inputs are trustworthy.
7. **Trends** — select visualizations only after metrics and historical data are reliable.
8. **Application shell, responsive layout, and shared design system** — consolidate approved patterns and complete scaling/accessibility work.

## Current work

- Revised T06: **Testing** on `codex/t06-json-only-import`, from fetched
  `origin/main` `d78e698` after T05 PR #9. Remove direct spreadsheet/CSV parsing
  and unnecessary dependencies; preserve JSON 1.1 validation, exact source bytes,
  draft persistence/recovery, legacy records and unrelated FIT/Garmin behavior.
  Implemented and verified with 254 frontend tests, 116 focused checks and 49
  sequential native tests; browser checks use synthetic files only. Approved
  scope, packaging evidence and pending owner acceptance: DESIGN.md.
- Revised T07: **Testing** on isolated `codex/t07-guided-conversion`, based on
  fetched `origin/main` `e4aa085`. Five tabs, separate offline schema/example
  downloads, complete original clipboard prompt with contract clarifications,
  validation feedback and retained valid previews are implemented for review.
  All 273 frontend/domain tests pass; native execution and combined pnpm gate
  are environment-blocked. PDF provenance guidance and owner acceptance remain
  pending. No schema change, PDF workaround, T11, commit, push or PR.
  Scope, exact verification and compatibility findings: DESIGN.md.
- Revised T08: **Backlog** — validate AI-generated JSON against representative
  40, 55, 65 and 75+ MPW coach plans.
- Revised T11: **Backlog** — integrate and refine JSON-based import and the draft
  experience; direct workbook parsing is no longer intended product behavior.
- The authoritative Phase 0 `IMPLEMENTATION_ROADMAP.md`, `DESIGN_SPEC.md` and
  `ARCHITECTURE_DECISIONS.md` are absent from this branch. Apply these decisions
  there when those documents are incorporated through their own reviewed work;
  do not copy uncommitted documents from other worktrees.
- T05 persist/reopen one JSON 1.1 plan draft: **Testing** on isolated
  `codex/t05-persist-plan-draft`, based on fetched `origin/main` `3335223` after
  T04 PR #8 merged. Exact native tables, compatibility, safety copy, source
  preservation and draft-only recovery were approved by the owner on November
  14, 2026 and are recorded in DESIGN.md. The focused implementation and temporary
  synthetic profile tests are present. Verification and remaining packaged-app
  acceptance requirements are recorded there. Real/development profiles remain
  untouched. No activation or workbook adapters are included.
  Acceptance correction: replace browser-download export with native Save As,
  verified scoped file publication and visible adjacent feedback. The existing
  T05 branch/PR carries this narrow correction; no database or import changes.

- T04 secure Garmin Personal API slice: **Testing** on
  `codex/t04-garmin-personal-api`, isolated from merged T03 at `4ad6fca`.
  Approved scope and evidence are in DESIGN.md. Windows Credential Manager,
  Rust-only authentication, explicit five-activity listing and one bounded ZIP/FIT
  retrieval reuse T03. Provider receipts are separate from content identity.
  No snapshot/database migration, confirmed workout, training totals, plan or shoe
  changes. Full frontend gate passed (223 tests), final focused checks passed
  (31 tests), and Windows Rust CI passed (27 native tests). Owner real-account/
  packaged Windows acceptance remains required.
  Public/commercial distribution is blocked pending Garmin licensing authorization.
  Background sync, history/review and T05/T25/T26 are deferred.

- T01 training-plan JSON 1.1 contract: **Testing** on
  `codex/t01-training-plan-contract`, isolated from `origin/main` at `dac964e`.
  [Contract and verification record](schemas/training-plan/README.md). Scope is
  schema, pure validation, generated types, synthetic fixtures/tests and minimal
  supporting documentation/dependencies. Owner acceptance is pending; workbook
  parity and authentic 1.0 compatibility remain deferred.
- The preexisting development branch, three unmerged commits, seven modified source
  files and untracked Phase 0 documents/archive remain preserved separately, with
  a verified local recovery copy. They were not incorporated into T01. Before T02,
  explicitly reconcile the version-6 development baseline; do not run the older
  main application against a newer profile. T02 now proceeds separately from main with explicit v5/v6 rejection (see the T02 record below).

- Phase 1 architecture/application audit: **Complete on `docs/ui-ux-audit`**.
- Phase 2 UI inventory: **Complete on `docs/ui-ux-audit`**.
- Approved Today/manual-entry vertical slice: **Testing on `codex/manual-run-entry`**.
- Included: date-aware Today, FIT-first/manual dialog, duration and pace interpretation, RPE, soreness, sleep, shoes, review, atomic persistence, migration, and automated tests.
- FIT import and Activity Review specification: **Design approved on `codex/approved-fit-activity-review`**.
- Approved interface: issue-first planned-session summary, imported-source rail, compact reversible suggestions, easy-run and structured-workout disclosure levels, optional pace/segment editing, contextual decisions, roles/bundles, activity/segment shoes, autosaved drafts, atomic confirmation, and read-only reopening with revisions.
- Supporting engineering retained from the later investigation: import batches, exact/possible duplicate explanations, verified source preservation, typed decode/persistence failures, cancellation/retry, deterministic matching, and idempotent confirmation.
- Implementation has not started. The approved specification, relevant tests, verification evidence, and explicit user acceptance remain required before the component can advance beyond Testing or become Complete.

- T02 fail-closed loading and staged legacy restore: **Testing** on
  `codex/t02-safe-loading`, isolated from current `origin/main` bdf7519 after T01.
  v2/v3/v4 supported; v5/v6 rejected without writes. Development work is preserved.
  Only T02 is authorized; native normalization and complete backup remain deferred.

T02 verification and native-build limitation are recorded in DESIGN.md. Owner
acceptance remains pending. The following record supersedes the historical
statements that T03 has not started.

- T03 secure native FIT source storage: **Testing; native verification blocked**
  on `codex/t03-native-fit-storage`, isolated from `origin/main` `6fdde51` after
  T02 PR #6 merged. Rust owns bounded, content-addressed, verified immutable
  storage and reads; the minimal frontend adapter preserves source references.
  Broad frontend filesystem access is removed. Original names stay in existing
  records; unavailable source bytes never gain verified status. No snapshot,
  plan-contract or historical-record migration and no source deletion.
- Focused frontend verification: 71 tests in 5 files pass. Final `pnpm verify`
  passed once (217 tests in 16 files, formatting, types and frontend build).
  Rust formatting passed. Rust native tests were attempted once and blocked before execution
  by Windows Application Control (OS error 4551); no policy changes or repeated
  native builds. See DESIGN.md for contract, tests and evidence limitations.
- Owner acceptance, native execution/restart and capability acceptance remain
  outstanding. Complete portable FIT backup, reconciliation/cleanup, generated
  bindings and historical migration remain deferred. Development work and real
  data are untouched. No PR, merge, installer build or T04 work is authorized
  by this delivery.
