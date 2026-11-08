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
| P0       | Implement the approved Activity Review workspace: issue-first progressive disclosure, source rail, optional pace/segment editing, bundles, shoes, validation, confirmation, drafts, and revisions. | Completes imported-run review without overwhelming simple imports or altering source data. | High        | FIT samples, matching/bundle/segment/shoe domain rules | In progress |
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

## Known technical findings

- Today, Next Up, and recent imports use fixed November 2026 dates.
- FIT selection decodes files, records immutable samples and laps, detects exact duplicates, preserves verified source bytes in the packaged app, and records partial-success batches for Activity Review.
- Activity Review now stores reversible suggested decisions, resolves possible duplicates explicitly, validates roles/primaries/shoes/preservation/segments, allocates segment shoe mileage, surfaces save failures with safe retry, and atomically confirms activity projections and session completion. Pause/gap landmarks, zoom/drag enhancements, and visible revision history remain.
- Distance-unit preference is stored but formatting always displays miles.
- Manual journal mileage is counted, but manual journal dates do not count as run days.
- Session `week` is not recalculated when a move crosses week boundaries.
- The SQLite migration defines normalized tables, while runtime persistence uses one JSON row in `app_state`.
- Windows packaging reaches the Tauri resource step but cannot produce an installer until an approved `src-tauri/icons/icon.ico` is added.
- Repository saves are serialized and Activity Review surfaces saving failures with safe retry; other screens still need the same status treatment.
- Backup validation checks top-level shapes only.
- Plan import is repeat-safe for an identical file but is not a complete current-vs-imported diff.
- Domain, repository, and focused rendered-component tests exist; broader end-to-end coverage remains.
- The hard minimum page width has been removed; remaining screens still need systematic 200% scaling verification.
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

- Phase 1 architecture/application audit: **Complete on `docs/ui-ux-audit`**.
- Phase 2 UI inventory: **Complete on `docs/ui-ux-audit`**.
- Approved Today/manual-entry vertical slice: **Testing on `codex/manual-run-entry`**.
- Included: date-aware Today, FIT-first/manual dialog, duration and pace interpretation, RPE, soreness, sleep, shoes, review, atomic persistence, migration, and automated tests.
- FIT import and Activity Review specification: **Design approved on `codex/approved-fit-activity-review`**.
- Approved interface: issue-first planned-session summary, imported-source rail, compact reversible suggestions, easy-run and structured-workout disclosure levels, optional pace/segment editing, contextual decisions, roles/bundles, activity/segment shoes, autosaved drafts, atomic confirmation, and read-only reopening with revisions.
- Supporting engineering retained from the later investigation: import batches, exact/possible duplicate explanations, verified source preservation, typed decode/persistence failures, cancellation/retry, deterministic matching, and idempotent confirmation.
- Implementation is in progress on `feature/activity-review`. Matching evidence, separate drafts, issue-first validation, source rail, pace/metric detail, keyboard-complete segment boundaries with undo/redo, segment shoes, possible-duplicate resolution, atomic confirmation, read-only reopening, and revision snapshots are implemented. Remaining work is interaction polish and difficult-state visibility.
