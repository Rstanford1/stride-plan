# A3 — FIT import state-integrity fix

As of November 17, 2026 (Pacific). **Testing; independent code review, packaged
Windows acceptance and owner acceptance pending.** Do not merge without explicit
owner approval. Baseline: fetched `origin/main` `0f98fee`; isolated branch
`codex/a3-fit-import-state-safety` in `work/a3-fit-import-state-safety`.

## Root cause and scope

Current-main `DataScreen.importFitFiles` awaited `runFitImportBatch`, then called
`replaceData({...data, ...})` using the pre-await render snapshot. Concurrent
session, journal, shoe, activity, settings or other edits could be overwritten.
Both overlapping imports could inspect the same old sources. The existing
`SerializedRepository` ordered saves, but could faithfully persist that stale
snapshot and could not make it current again.

The context's `currentData` previously updated during rendering. Restore could
also miss an accepted same-turn edit while preparing its safety copy. The shared
context command boundary must therefore advance this reference synchronously,
outside React updater functions. Persistence stays in an effect; that effect
rejects obsolete render snapshots. This is the necessary shared-state scope for
A3, not a general persistence rewrite. No database, schema, native, decoder,
Garmin authentication, dependency or plan-contract changes.

## Implementation

- `src/data/fit-import-commit.ts`: pure, idempotent batch merge. Rechecks hashes
  against current sources, keeps first-committed metadata and associated source
  activities, converts concurrent decoded duplicates into exact-duplicate results,
  and appends a consistent batch. Unrelated collections are copied from current.
- `src/data/app-context.tsx`: `beginFitImportBatch` returns an initial source list
  and a generation-bound `commitFitImportBatch`. Commits synchronously read latest
  accepted state. Reset/restore/replacement/recovery/reload/disposal invalidate
  old handles; imports begun while unavailable cannot commit. Restore flushes
  latest accepted edits, then publishes its replacement reference immediately.
  Effect saves reject stale renders; supplied repositories are serialized too.
- `src/screens/DataScreen.tsx`: removes stale snapshot replacement, reports from
  the committed batch and explains discarded imports without claiming success.
- `src/data/fit-import-integration.test.tsx`: deterministic completion gates with
  actual decoder, controller, StrictMode provider and isolated BrowserRepository.
- `src/data/sqlite-safety.test.mjs`: adds actual provider/controller/SqliteRepository
  overlapping-import tests using temporary synthetic databases and an independent
  read-only SQLite connection to verify durable rows.
- `DESIGN.md`, `UI_INVENTORY.md`, `ROADMAP.md`, `docs/PROJECT_STATUS.md` and this
  record: scoped specification, status, evidence and remaining acceptance.

Cancellation still finishes the current file and marks unstarted files cancelled.
One failed file does not discard successful files or concurrent imports. Source
bytes continue through the unchanged preservation service. Reset/restore may
leave an unreferenced verified content object from the old import; it is retained
without linking it into the replacement dataset. No source cleanup is introduced.
A rejected restore candidate conservatively invalidates pending import handles;
fresh selection is required. In-memory commit is not a new durable-save promise;
existing save failures still enter recovery.

## PR #23 independent-review follow-up — November 17, 2026

### Concurrent FIT-import UI ownership (P2) — acceptable behavior; no code change

`DataScreen` already disables the native multi-file picker while its progress
state is present, so a normal subsequent user selection is unavailable. The
picker and its cancellation control are driven by that same non-null progress
state. A native file picker must return before it dispatches its `change` event;
the state update from that discrete event is applied before the user can reopen
the picker. The controller is therefore not replaced through the supported UI,
and its terminal cleanup/message remain associated with its only active import.

The context/domain intentionally permits programmatic concurrent batches and
rechecks them at commit time; that behavior is exercised separately by existing
synthetic integration coverage. Dispatching a second `change` event directly to
the disabled input is not a user-reachable path, so no defensive UI rewrite or
additional regression test is warranted in this narrowly scoped follow-up.

### Unreferenced FIT-object retention (P2) — acceptable under the current contract; cleanup is future work

Packaged source bytes are immutable content-addressed objects at
`fit-sources/<first-two-hash-characters>/<sha256>.fit`. Native storage checks
the FIT header, size and SHA-256 before writing; the frontend validates returned
metadata and hashes every read. A source can only be associated with a dataset
through a `fitSources` record carrying the same hash, which snapshot validation
uses to constrain source activities and batch results. Reset and legacy restore
replace the application snapshot and invalidate pending commits; they do not
offer, document, or implement physical deletion of preserved FIT bytes. Legacy
restore also verifies every referenced byte object before it permits replacement.

Consequently, an old object cannot be accidentally linked to a replacement
dataset, and a retained object remains integrity-checked. Repeated discarded
imports can accumulate content-addressed bytes, however. That is a storage
retention tradeoff rather than a violation of the documented backup/restore
boundary: backups explicitly exclude original FIT bytes and restores say that
original FIT files must already be preserved locally. No automatic deletion or
garbage collection is added in A3. A separately approved lifecycle feature
should define user-visible removal, reachability, recovery/safety-copy handling,
failure semantics, and privacy wording before any cleanup is introduced.

### Compatibility recheck

After fetching on November 17, 2026, non-checkout merge-tree simulations were
clean for current `origin/main` (`0f98fee`) and the current T08.1 heads
`origin/codex/t08-1-plan-contract` (`ff18ad0`) and
`origin/codex/t081-windows-acceptance-installer` (`c5104b8`). The current F1
head `origin/design/f1-shared-visual-foundation` (`276d080`) has an existing
add/add documentation conflict at `docs/PROJECT_STATUS.md`; `DataScreen.tsx`
auto-merges. This documentation conflict is outside the follow-up change and
must be resolved deliberately when the broader branches are integrated.

## Regression evidence

All fixtures are generated synthetic bytes, Map-backed test storage or temporary
SQLite files with the preexisting guarded fixture cleanup. No normal installed
profile, credentials, real FIT files, personal plans, drafts or databases opened.

Independent-review follow-up verification (November 17, 2026):

- `pnpm verify`: passed **320 tests in 24 files**, formatting, generated
  declarations, TypeScript, and production frontend build. The existing Vite
  chunk-size advisory remains; the build succeeded.
- `git diff --check`: passed.

Controlled asynchronous tests cover:

- Completion after a session edit, preserving revisions and original prescription.
- Journal and shoe/mileage edits plus activity/settings edits before completion,
  including accepted commands in the same React batch.
- Same-file overlapping imports and different-file imports in reverse order.
- A failed file while other files and concurrent imports succeed.
- Cancellation preserving the valid completed/current file.
- Reset, restore and explicit dataset replacement while imports are pending,
  plus completion during a blocked restore and after replacement finishes.
- Slow serialized persistence, same-turn pre-restore safety copies, idempotent
  commit and reload equality. DataScreen reports reconciled duplicate counts and
  invalidation. Relationships, source-hash uniqueness and batch reports asserted.
- Same/different overlapping files through real SQLite, concurrent edit retention,
  durable readback through another connection and repository reload.

Final verification (automated tests, not packaged Windows acceptance):

- `pnpm install --offline --frozen-lockfile --ignore-scripts`: passed with
  execution approval, 247 packages reused, zero downloads; dependency manifests
  and lockfile unchanged. The initial restricted attempt could not access the
  pnpm launcher-store lock.
- `node node_modules/vitest/vitest.mjs run
src/data/fit-import-integration.test.tsx src/data/recovery-workflow.test.tsx
src/data/fit-import-controller.test.ts src/data/repository.test.ts`: passed
  **33 tests in four files** at the intermediate 14-case integration revision.
- `node node_modules/vitest/vitest.mjs run
src/data/fit-import-integration.test.tsx src/data/sqlite-safety.test.mjs`:
  passed **35 tests in two files** before the final rejected-restore case.
  The first restricted test launch stopped at `spawn EPERM` before tests ran;
  approved execution ran successfully. Early test-fixture/return-type corrections
  are included in the final passing gate, not outstanding product failures.
- `pnpm typecheck`: passed. Initial restricted launcher access was denied;
  approved execution was used for the gate.
- Final `pnpm verify`: **passed, 320 tests in 24 files** (15 new controlled
  React integration cases and two additional SQLite cases). Includes
  `pnpm types:check`, `pnpm format:check`, `pnpm typecheck`, `pnpm test` and
  `pnpm build`. Existing Vite chunk-size advisory remains; build succeeded.
- `git diff --check`: passed. Generated build output is ignored and uncommitted.
- No native Rust source changed, so no additional Rust checks were applicable.
  No Tauri launch, packaged acceptance, browser visual review or owner acceptance
  is claimed. The real SQLite adapter tests use Node SQLite with temporary files,
  not the packaged Tauri SQL plugin.

## Parallel work and review

Read-only GitHub API inspection before implementation:

- [PR #18](https://github.com/Rstanford1/stride-plan/pull/18), T08.1 contract,
  draft at `ff18ad0`: documentation overlap; no A3 implementation-file overlap.
- [PR #20](https://github.com/Rstanford1/stride-plan/pull/20), isolated T08.1 kit,
  draft at `c5104b8`: documentation overlap; no A3 implementation-file overlap.
- [PR #21](https://github.com/Rstanford1/stride-plan/pull/21), F1,
  draft at `a176f95`: documentation and DataScreen overlap. Its DataScreen change
  only renames the heading to Settings; preserve that change when integrating.

Existing worktrees and dirty root files were inspected and left untouched. T07
conversion, JSON 1.1 draft-only intake, T08.1 and F1 behavior are preserved.
`git merge-tree --write-tree HEAD origin/a3-check-pr-18` (and the corresponding
`origin/a3-check-pr-20` / `origin/a3-check-pr-21` commands) all returned **exit 0**
against the exact heads above. `git merge-tree --write-tree HEAD origin/main`
also returned **exit 0**. These non-checkout pairwise simulations do not modify
other worktrees and are not combined-branch behavioral or acceptance tests. Recheck
if any branch advances. Hosted draft-PR checks were not awaited in this task.

## Required isolated packaged Windows acceptance

Pending. Automated DOM tests and Node SQLite are not packaged WebView2 or the
Tauri SQL plugin. No native code changed, so A3 does not require new Rust checks.
Do not launch the production-identity build or open/migrate/reset the normal
installed profile. Use a separately approved disposable application identity,
temporary storage and synthetic FIT/plan data; do not repurpose active T08.1 kits.

1. Build an isolated acceptance package from the exact reviewed A3 revision and
   confirm its identity/storage paths before launching. Keep it separate from the
   installed profile and Garmin credentials. No Garmin connection is needed.
2. Import a sufficiently large synthetic FIT batch; edit session, journal, shoe
   mileage and settings while pending. Check original values and edits survive.
3. Exercise same-file and different-file overlapping imports using supported
   entry points or an isolated acceptance harness. Verify one source/activity set
   per hash, matching batch results and no duplicate-source validation failure.
4. Test mixed valid/broken files, stop-after-current-file and pending reset/restore.
   Old work must not appear in replacement data, including after restart. Check
   error/disabled states, keyboard focus/operation and representative window sizes.
5. Restart the isolated app; confirm records/reports/relationships and exact
   preserved FIT bytes. Exercise a controlled save failure and recovery/retry.
   Review verified unreferenced source retention after discarded work.
6. Record exact package/revision, test identity, commands, results and owner
   acceptance. Code review and explicit merge approval remain separate gates.
