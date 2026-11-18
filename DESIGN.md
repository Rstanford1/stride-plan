# Stride Plan design

## T07 — guided external conversion

Status: **Testing; independent review requested, owner acceptance pending**. Approved by the owner's T07 specification
and implementation request, November 16, 2026. Baseline: fetched `origin/main`
`e4aa085`; isolated branch `codex/t07-guided-conversion`. No commit/push authorized.

- Keep one Import Training Plan section in the existing Data & settings screen.
  Five freely navigable, keyboard-accessible tabs: Start, Get files, Use AI,
  Import, Review. Start links directly to Import or Get files. No wizard/gating.
- Get files offers exactly two offline artifacts: the canonical JSON 1.1 schema
  and a valid clearly synthetic example. Native saves reuse verified Save As
  protections; no general filesystem access. A new scoped command permission
  was explicitly approved by the owner before modification.
- Use AI shows four numbered instructions together, a privacy notice and Copy AI
  Instructions containing the complete original prompt and schema-specific
  clarifications. All ten screenshot references and the complete original prompt
  are now available. The latest written specification overrides older screenshots.
  PDF-specific conversion wording/workarounds remain pending owner review;
  do not present direct PDF provenance as supported or change the schema.
  No integrated AI, uploads, keys, parsing or paste-JSON intake.
- Successful validation opens Review, including warnings. Invalid attempts stay
  on Import, identified by filename, with plain explanations, exact expandable
  diagnostics and copyable correction feedback. Clipboard actions are explicit.
- Keep valid candidate, failed attempt and persisted record separate. Failure
  never clears a candidate; tab navigation never writes a draft. Review identifies
  its own filename and retains T06 preview, warnings, exact bytes and Save as draft.
  Existing duplicate/conflict/persistence/recovery behavior remains authoritative.
- No activation, schema/validator changes, migrations, dependencies, T11 calendar
  review, per-workout correction, editor, or unrelated settings changes.
- Verification and owner acceptance must be recorded before marking Complete.

### T07 implementation and preservation

- Start routes directly to Import or Get files. Get files downloads exactly the
  canonical schema and existing synthetic `valid-workout.json` fixture, embedded
  offline by Vite and Rust from the same source files. No ZIP or instructions
  download. Native Save As accepts only a closed schema/example selector and
  version, never frontend paths or bytes. Its single new permission was approved.
- Use AI shows all four numbered instructions together and explicitly copies the
  complete original owner-supplied prompt followed by contract clarifications.
  The original prompt text is retained intact. No added PDF conversion procedure
  is included; the interface says guidance remains pending provenance review.
- The clarifications make actual root names, units, role/double links, independent
  sessions, required/optional/core/flexible semantics, recovery boundaries,
  ordered components, hammer indices, within-workout progressions, exact
  coachText arrays, JSON Pointer paths and essential clarification rules explicit.
  Required file-source hashes cannot be omitted when unknown; no self-hash is
  invented. The synthetic example supplies structure, never workout prescriptions.
  Unsupported week/phase progression remains text with review notes. No schema or
  validator wording/rules were changed to accommodate the prompt.
- Import reuses T06 byte loading and T01 validation. Syntax, schema, blocking
  semantics and nonblocking warnings have distinct labels and expandable exact
  code/path/message details. Validation feedback copies actual diagnostics and
  correction instructions only on request. It omits filenames/full JSON and
  redacts source-provided note text, quoted identifiers and arbitrary pointer keys
  that could contain private content. Exact diagnostics remain visible locally.
- Valid selection replaces only the candidate and opens Review, focusing its
  heading. Failed selection stores its filename/errors independently, returns
  to Import and restores picker-button focus. The prior valid candidate remains
  on Review under its own filename. Tabs preserve candidate/disclosure state.
  Review retains T06 exact-source disclosures, warnings and explicit Save as draft,
  adding only week/day/warning counts. No T11 calendar/editor/correction workflow.
- The persisted record is never replaced by selecting a file, validating, copying,
  downloading or switching tabs. Existing T05 save/reopen/recovery operations and
  native conflict/idempotence rules remain unchanged. Save still revalidates an
  independent copy of original bytes at the unchanged store boundary. Draft
  recovery controls remain available; native draft-presence guards are preserved.
- The native export writer has one directly necessary adjustment: resolve missing
  protected app-directory suffixes against their existing ancestor. Downloads
  must work before the first source save creates AppLocalData. It creates no
  profile/storage directories, still excludes application storage and retains
  guarded destinations, verified staging/publication/readback and cancellation.

### Focused T07 privacy/PDF correction pass

Owner-authorized bounded correction, November 16, 2026. The final narrowed request
limits this pass to clipboard privacy, focused regressions and PDF error guidance.

- Replaced clipboard message/path redaction with a closed diagnostic-code catalog
  and fixed descriptions. Raw validator messages are never copied. Structural
  locations must traverse explicit properties/array positions in the unchanged
  schema; malformed, unknown and metadata-defined locations receive a generic
  location description. Source-provided review-note paths are always omitted,
  including those that resemble valid structural pointers. Unknown codes are
  represented generically. Exact original diagnostics remain visible locally.
- Added regressions for drive/UNC Windows paths, Unix paths, mixed separators,
  malformed pointers, misleading metadata paths, private source text and unknown
  codes, while confirming useful safe codes/locations and unchanged input data.
- Unsupported-file guidance now states that PDF provenance guidance is pending,
  JSON 1.1 does not directly support PDF sources, and sources must not be mislabeled
  or fabricated. Read/encoding/size/extension failures retain ordinary errors;
  no additional AI-correction action was added. The original prompt is unchanged.
- Focused command: `node node_modules/vitest/vitest.mjs run
src/domain/plan-conversion.test.ts src/components/PlanConversionFlow.test.tsx
src/components/PlanDraftPanel.test.tsx`: **56 passed in three files** (32 domain,
  9 guided workflow, 15 draft/import). These include 28 additional privacy cases.
  The earlier full-suite result below is historical; the full suite was not
  repeated for this correction. TypeScript, formatting and diff checks are
  recorded with this pass's final report.
- Only the feedback helper, its tests, the import guidance and two existing UI
  test files, plus this design record, changed during the pass. No schema, native
  code/permission, prompt, dependency configuration or Windows policy changes.
  Native-test, actual clipboard paste and packaged acceptance limits below remain.
  PDF provenance is still unresolved. No commit, push, PR or merge.

### PDF provenance investigation — decision pending

These are findings about the unchanged 1.1 contract, not approved PDF workarounds.

1. Root `sources` and `provenance` are required, both with `minItems: 1`.
   `$defs.Source` supports `FileSource.kind` only `workbook` or `json`, each with
   required `id`, `fileName` and lowercase 64-character `sha256`; its other branch
   is `AuthoredSource`, requiring `id` and `kind: authored`. `$defs.Location`
   supports only workbook `cell` (`sheet`/`cell` required), `json` (`pointer`
   required), or `authored`. It has no PDF/page-location alternative.
2. The semantic validator requires location/source kinds to agree
   (`source_location_mismatch`), prohibits fileName/sha256 on authored sources
   (`source_kind_conflict`) and requires covering provenance for nonempty
   coachText (`missing_provenance`). Empty sources, invented cell references,
   relabeling a PDF, fake hashes, or falsely claiming authored content cannot
   supply truthful original-PDF provenance. Optional extensions are preserved
   metadata; they do not waive these standard semantics or add required features.
3. Plan sessions derived from a PDF are not inherently unimportable. A genuinely
   separate intermediate JSON transcription could truthfully be a `json` source
   with its own real filename, calculated hash and pointers, and the plan could
   pass 1.1 validation/import. That records the intermediate JSON, **not direct
   original-PDF provenance**. Establishing such a transcription workflow and how
   it preserves the PDF chain needs owner approval. It has not been implemented
   or recommended in the production instructions. Simply using authored for any
   imported PDF is not an approved or truthful automatic fallback. Passing a
   validator alone never verifies the claimed source facts or fidelity.
4. The smallest immediate safe behavior is the implemented limitation notice,
   preserving the original prompt's non-fabrication rule and normal JSON import.
   No schema change or migration is necessary for the unblocked T07 work.
   A separately approved intermediate-transcription policy could retain 1.1
   without a schema change, at the cost of an extra source and incomplete direct
   PDF provenance. If direct original-PDF provenance is required, the smallest
   clean contract extension is a PDF file-source kind with its real hash/name
   and a defined PDF/page location, plus matching semantic rules/types/tests.
   This requires schema work and an explicit versioning decision, not an enum
   silently added under the existing 1.1 identity.
5. Compatibility is material: the parser accepts only 1.1; existing clients would
   reject a new version. Both TS and Rust bind saved draft/recovery validation to
   the shipped schema/validator fingerprint. Editing either in place would make
   existing saved records fail verification. Native `plan_draft_validation`
   constrains schema_version to `1.1` and validator_version to `t01-1`. A future
   version therefore needs compatible validator selection, retained old-draft/
   recovery support and a separately approved migration if new-version drafts
   are persisted. None of those changes is included in T07.

### T07 verification and limits

All tests use synthetic data or temporary directories. No real app profile was
opened or migrated. This branch remains uncommitted and unpushed.

- Complete frontend/domain suite via `node node_modules/vitest/vitest.mjs run`:
  **273 passed in 23 files** on the final full run, including the additional
  no-warning UI regression. The existing 81 T01 and 14
  T05 adapter tests are included. Rendered tests cover five tabs/arrow/Home/End
  focus, direct import, separate downloads, full prompt copying/retry, syntax/
  schema/semantic failures, actual privacy-conscious feedback, retained candidate
  and distinct failed/saved identities, warnings/save and no automatic transmission.
- `node scripts/generate-training-plan-types.mjs --check`,
  `node node_modules/prettier/bin/prettier.cjs --check .`,
  `node node_modules/typescript/bin/tsc -b --pretty false`, production
  `node node_modules/vite/bin/vite.js build`, Rust formatting and `git diff --check`
  passed. Existing Vite large-chunk advisory remains.
- Required `pnpm verify` was attempted. The first attempt could not acquire its
  launcher-store lock. The permitted rerun triggered pnpm's automatic local
  dependency refresh (247 reused, zero downloaded) and stopped with
  `ERR_PNPM_IGNORED_BUILDS` before running the gate. Its incidental allowBuilds
  edit was removed. `pnpm-workspace.yaml` exactly matches HEAD (Git blob
  `915e8a4bb149317fa3e9c37e8f9556f668afaefd`). No package-manager bypass,
  script approval or manual package installation was performed. The individual
  checks above are not represented as a passing combined pnpm gate.
- `cargo test --manifest-path src-tauri/Cargo.toml --locked --offline --
--test-threads=1` stopped before project compilation because Windows Application
  Control blocked dependency build scripts (`serde_core`, `parking_lot_core`,
  `zmij`, OS error 4551). Added native request/artifact/download/protected-directory
  tests and existing export tests **did not execute**. No Windows policy changed.
  Packaged build/interactive acceptance is blocked; no executable was launched.
- Browser rendering: all five tabs, direct Start routing, four simultaneous
  instructions, arrow/End navigation, solid visible keyboard focus, empty Review
  and disabled save were exercised. Measured CSS widths 680, 1133 and 1360 px had
  no horizontal document overflow in checked states. Screenshots are saved as
  external review artifacts, not repository files. The light/green application
  styling is retained; screenshots supplied workflow/card references, not a
  request to reskin the application.
- Both browser artifact downloads completed; SHA-256 matches the canonical schema
  and synthetic fixture exactly. The browser reported AI instructions copied,
  but automation clipboard readback was empty; actual end-to-end clipboard
  contents are not claimed verified. Automated tests assert the exact complete
  payload passed to writeText. Native WebView2 clipboard acceptance is pending.
- Browser selection of only synthetic `valid-partial.json` was attempted through
  the chooser. Upload permission was declined; no file was uploaded, and it was
  not retried or worked around. Populated flow/retention/persistence evidence is
  from rendered unit/adapter tests, not populated browser or packaged acceptance.
- The local preview is Node/Vite 6.4.5 on `127.0.0.1:1427`, started in this isolated
  worktree (observed listener PID 15544). The intended file was the repository's
  synthetic test fixture only; no personal plan, secret or unrelated file was
  selected for upload. Such browser file selection is optional for this review.

Remaining Windows acceptance: build in an environment permitting the locked Rust
dependencies; use a synthetic isolated app identity/profile; exercise each native
Save As, cancellation, overwrite confirmation, protection of app/source storage,
exact downloaded bytes, actual clipboard paste/readback and failure/retry; save,
restart, reopen and recover one synthetic draft, confirming the active schedule
is unchanged. Test forced colors, screen-reader announcements and 200% Windows
scaling. Owner acceptance and PDF-specific wording remain pending.

T07 changed-file manifest (uncommitted):

- `DESIGN.md`, `ROADMAP.md`, `UI_INVENTORY.md`
- `src/components/PlanDraftPanel.tsx`, `src/components/PlanDraftPanel.test.tsx`
- `src/components/PlanConversionGuide.tsx`, `src/components/PlanValidationIssues.tsx`
- `src/components/PlanConversionFlow.test.tsx`, `src/screens/DataScreen.test.tsx`
- `src/data/plan-conversion-files.ts`, `src/data/plan-conversion-files.test.ts`
- `src/domain/plan-conversion.ts`, `src/domain/plan-conversion.test.ts`
- `src/domain/plan-conversion-prompt.ts`, `src/styles.css`
- `src-tauri/src/plan_conversion_commands.rs`, `src-tauri/src/plan_draft_export.rs`
- `src-tauri/src/lib.rs`, `src-tauri/build.rs`, `src-tauri/capabilities/default.json`

Unchanged: canonical schema/validator/fixtures, T05 store/commands/migration,
package manifests/lockfiles, pnpm/Vite/TypeScript/Tauri app configuration, FIT and
Garmin code. The only capability change is the approved single conversion-save
command. No unexpected configuration modifications remain.

## Revised T06 — JSON-only training-plan intake

Status: **Testing; approved by the owner's revised T06 request on November
14, 2026.** Based on fetched `origin/main` `d78e698`, including merged T05 PR #9.

- Users independently convert coach documents (Excel, PDF or other formats) to
  Training Plan JSON 1.1 with an external AI agent of their choosing. Stride Plan
  has no AI provider integration, hosted conversion service or API credentials.
- Stride Plan owns strict T01 validation, semantic warnings, provenance, exact
  original JSON bytes, preview and T05 draft persistence/recovery. Activation
  remains a later explicitly confirmed workflow; saving a draft changes no
  active plan, workout, journal or totals.
- Remove the direct CSV/XLS/XLSX action, workbook readers, row transformations,
  obsolete validation/tests and exclusive dependencies. Keep historical session
  identities, import fingerprints, snapshot adapters and saved records readable.
  No database or migration changes are needed or authorized.
- Keep the existing JSON draft panel as the primary plan import action, with
  its current controls and preview. Add brief external-conversion guidance.
  Reject non-JSON filenames before reading bytes with a helpful unsupported-
  format message directing users to JSON 1.1. Preserve keyboard focus and the
  existing announced error and disabled-save behavior.
- Preserve FIT, Garmin, backup and restore behavior. T07's guided conversion
  prompt/schema experience, T08's representative-plan validation and T11's
  broader JSON import/draft refinements are outside this change.

### T06 implementation and verification record

- Removed the workbook/CSV import card, parsing/transformation/active-plan-write
  path and row preview from `DataScreen.tsx`; removed `src/domain/imports.ts` and
  its obsolete tests. Its activity duplicate helper had no production callers;
  actual FIT duplicate checks remain in the unchanged FIT services.
- Removed `xlsx` 0.18.5, Vite's spreadsheet chunk and eight exclusive locked
  dependencies: `adler-32`, `cfb`, `codepage`, `crc-32`, `frac`, `ssf`, `wmf`,
  `word`. The installed production graph (58 unique package names) contains none
  of these nine packages. Lockfile changes only remove those entries; no other
  versions change. `zod` remains required by JSON drafts and snapshot validation.
- Kept historical `sourceKey`, import fingerprints, session/revision structures,
  seed data, snapshot adapters and the T01 workbook-provenance contract/fixtures.
  These describe retained evidence, not an executable workbook reader. T01 schema,
  validator, T05 native storage/recovery, Rust sources, migrations, FIT and Garmin
  implementation files are unchanged.
- Clean `pnpm install --frozen-lockfile --ignore-scripts`: passed after removing
  only this isolated worktree's dependency directory. pnpm 11's automatic
  pre-command reinstall attempts to rewrite the existing build-script policy;
  those incidental edits were reverted. Verification used the session-only
  `pnpm_config_verify_deps_before_run=false` after the explicit locked install;
  no tracked package-manager configuration changed.
- Focused JSON/legacy/recovery tests: **116 passed in six files**. Full
  `pnpm verify`: **passed, 254 tests in 20 files**, generation consistency,
  formatting, TypeScript and production build. The existing large-chunk advisory
  remains; the spreadsheet bundle is absent. The shared `replaceData` binding
  remains in DataScreen because FIT intake still needs it.
- The first GitHub run found a focus-timing race in the unsupported-file
  regression test: animation-frame focus could run while the button was still
  disabled. Focus restoration now runs in the post-render effect after controls
  are enabled, without changing plan/draft operations or increasing test timeouts.
  The same focus assertions remain in place; the full local gate is rerun for
  the correction and GitHub verification is checked on the updated PR.
- Native `cargo test --locked -- --test-threads=1`: **49 passed, zero failed,
  one helper ignored by the parent suite and exercised by the restart test**.
  The initial parallel run had one Windows sharing violation during synthetic
  temporary-profile cleanup; the sequential rerun passed the entire suite.
  Existing Garmin dead-code compiler warning remains. No native code was changed.
- Browser evidence: synthetic JSON 1.1 validates with all six semantic warnings;
  original coach instructions and raw JSON disclosures open with Enter and solid
  visible focus. Empty preview, invalid JSON, PDF/XLSX rejection, cleared stale
  preview and browser-only disabled draft/recovery controls were exercised.
  At measured CSS widths 680, 816 and 1133 px, the checked panel states have no
  horizontal page overflow. The production browser build was also exercised at
  816 × 816. Browser/native source paths and profiles are distinct; browser checks
  do not claim packaged native draft persistence.
- `pnpm tauri build --ci`: **passed on November 16, 2026**, producing both x64
  MSI (6.43 MiB) and NSIS (4.82 MiB) installers under the ignored
  `src-tauri/target/release/bundle` directory. No generated output is committed.
  The app was not installed or launched; packaged interactive acceptance is
  pending and the real application profile was never opened.
- Owner acceptance remains pending, so status stays **Testing**. No T07/T08/T11
  implementation, activation or database migration is included.

## T05 — one durable JSON plan draft

Status: **Testing. Architecture, migration, recovery and focused UI approved
by the owner on November 14, 2026 before implementation.**
Prepared November 14, 2026 on `codex/t05-persist-plan-draft`, from fetched
`origin/main` `3335223` (T04 merged as PR #8). This section proposes the exact
bounded storage/recovery and Data-screen behavior approved in that decision.
The owner's preserved Phase 0 architecture decisions and implementation roadmap
were reviewed without copying those untracked documents into this worktree.

### Export Save As acceptance correction

Status: **Testing; approved by the owner's acceptance-fix request.** The
packaged export currently uses a browser download and reports only that a download
was requested. Replace that action with a native Windows Save As dialog, suggesting
`stride-plan-draft-recovery.json`. A narrowly scoped native command regenerates
the unchanged recovery envelope and checks its hash against the T01-verified
frontend export; the frontend supplies neither destination paths nor file bytes.
Write a unique sibling temporary file, flush and verify its bytes, then publish
atomically and verify the final file before reporting the selected location.
Use the native overwrite confirmation; reject changed/conflicting destinations,
unsafe links, application storage and replacement of the original source.
Cancellation writes no export and clears prior success. Show progress, saved
location, neutral cancellation and readable failures beside the export button,
with announced status and preserved keyboard focus. No broad frontend filesystem permission,
recovery-format, schema, migration, import or training-data change is authorized.

Correction verification: `pnpm verify` passed (249 tests in 20 files, generation
consistency, formatting, TypeScript and production build); Rust formatting passed.
The 25 focused adapter/component/legacy-boundary tests passed. Synthetic rendered
UI responses exercised saved-path wrapping at 680 px, keyboard focus, cancellation
after success, and nearby announced errors; these are explicitly not a native
dialog test. Native tests add actual temporary-file save/overwrite, partial and
failed writes, sync/publication/verification failures, cancellation, destination
races, unsafe destinations and export-file recovery with unchanged database and
source bytes. Windows execution/build results are recorded in the
[existing T05 PR checks and review record](https://github.com/Rstanford1/stride-plan/pull/9).
Packaged Save As interaction, overwrite confirmation and owner acceptance remain
manual acceptance checks. Only synthetic temporary profiles/files are tested.

### Ownership and three new tables

Use the existing `stride-plan.db`. `app_state` remains the sole owner of active
plans, sessions, results, totals and settings. Existing unused normalized tables
remain unused. Rust exclusively writes the following new draft records; they
are never added to AppData or written through the legacy SQL repository.

| Table                   | Proposed columns and constraints                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plan_draft_sources`    | `source_id TEXT PRIMARY KEY` equals `plan-source:` plus `source_hash`; `source_hash TEXT NOT NULL UNIQUE`, exactly 64 lowercase hexadecimal characters; `byte_length INTEGER NOT NULL CHECK(byte_length BETWEEN 1 AND 8388608)`; `original_file_name TEXT NOT NULL`, a bounded display name, never a path; `imported_at TEXT NOT NULL`, native-generated UTC RFC 3339.                                                                                                                                                                             |
| `plan_drafts`           | `slot INTEGER PRIMARY KEY CHECK(slot = 1)` enforces one saved draft; `draft_id TEXT NOT NULL UNIQUE` equals `plan-draft:` plus the source hash; `source_id TEXT NOT NULL UNIQUE REFERENCES plan_draft_sources(source_id) ON DELETE RESTRICT`; `plan_id TEXT NOT NULL`, `version_id TEXT NOT NULL`, optional `parent_version_id TEXT`, preserving T01 IDs; `UNIQUE(plan_id, version_id)`; `revision INTEGER NOT NULL CHECK(revision = 1)`; `state TEXT NOT NULL CHECK(state = 'draft')`; `created_at TEXT NOT NULL`, native-generated UTC RFC 3339. |
| `plan_draft_validation` | `draft_id TEXT PRIMARY KEY REFERENCES plan_drafts(draft_id) ON DELETE RESTRICT`; `schema_version TEXT NOT NULL CHECK(schema_version = '1.1')`; `validator_version TEXT NOT NULL`; `validator_fingerprint TEXT NOT NULL`, SHA-256 of the shipped schema/validator inputs; `diagnostics_json TEXT NOT NULL CHECK(json_valid(diagnostics_json))`, preserving the complete T01 warning report; `diagnostics_hash TEXT NOT NULL`, lowercase SHA-256 of those exact UTF-8 report bytes.                                                                  |

All columns are non-null except `parent_version_id`. Hash shape constraints also
apply to validation hashes. Entity IDs retain T01's length/character rules.
Only PK/UNIQUE indexes are needed. Foreign keys are enabled on every connection.
The saved aggregate has exactly one joined source/draft/validation record; reads
reject partial or inconsistent aggregates. No measurement conversion, derived
mileage, schedule or workout projection is introduced.

### Original bytes, validation and commands

- Extend T03's guarded immutable store with a closed JSON-plan source kind:
  `plan-sources/<first-two-hash-characters>/<hash>.json`, maximum 8 MiB. Rust
  selects paths, verifies UTF-8/JSON transport and schema-version boundaries,
  computes SHA-256, syncs and rereads exact bytes before linking a source. Preserve
  original BOM/whitespace/newlines in the stored bytes even when parsing requires
  handling a UTF-8 BOM. Reuse T03's Windows path/link protections and publication
  procedure, without weakening FIT checks or introducing arbitrary file access.
- The existing T01 schema and semantic validator remain the sole plan-rule
  authority in TypeScript: run on selection, immediately before save, on reopen,
  and on recovery intake. Rust checks bounded DTOs, identities, hashes, report
  provenance and persistence invariants; it does not introduce a second semantic
  interpretation. The validation record is explicitly the bundled T01 validator's
  report, not a claim of independent native semantic validation.
- Raw instructions, optional/unknown metadata and document provenance are
  canonical in the exact source bytes, never reconstructed from normalized rows.
  Store warnings as supplied by T01 without filtering or changing their messages.
- Add narrowly enrolled version-1 commands for draft inspection/preparation,
  save, read, recovery export and recovery import. Handwritten TS/Rust DTOs use
  shared wire fixtures as in T03; no generator or general database API is added.
  Promote the already-locked SQLx 0.8.6 to a direct dependency for native
  transactions; avoid a second SQLite implementation or dependency upgrades.
- Save accepts the expected empty slot or observed draft ID/revision. Under a
  native write transaction, identical verified source bytes return the existing
  IDs/report; different bytes or a stale nonmatching identity return a typed
  conflict. There is no overwrite/delete/edit operation. The first filename and
  import timestamp remain unchanged on duplicate import.
- Finalize the source before the SQL transaction. Insert all three rows atomically,
  commit with synchronous FULL, then reopen/read the joined records and source
  bytes to verify durable persistence before success. A lost acknowledgement is
  safely retried by source hash. Rollback/interruption may leave a harmless
  unreferenced immutable object; no automatic source deletion is introduced.

### Supported migration and verified safety copy

- The selected production baseline is a T04-compatible profile with a deeply
  validated current AppData v4 snapshot and SQLite `user_version = 0`. Optional
  known normalized tables must be empty. The SQLx ledger may be absent/empty or
  contain only successful shipped migration 1/2 entries with matching checksums
  and corresponding table shapes. A genuinely new profile first initializes
  through existing T02 empty-store protections. Historical snapshot v2/v3 must
  first pass T02's existing safety-copy/upgrade to v4; T05 does not add adapters.
- Before any T05 DDL on an existing profile, produce a native-chosen, unique,
  retained pre-migration SQLite safety copy with `VACUUM INTO`. This produces a
  consistent logical database copy, including committed WAL content, rather than
  copying only the live main file. Sync the output, reopen read-only, verify
  integrity/FKs, schema/ledger and all legacy records against the captured
  baseline; retain exact `app_state.payload` text. See SQLite's
  [VACUUM INTO contract](https://www.sqlite.org/lang_vacuum.html).
  Keep the source connection read-only until verification succeeds, so a failed
  copy cannot trigger a writable connection's journal recovery/checkpoint.
- Then acquire the write transaction and recheck the complete baseline against
  the verified safety copy. If anything changed, abort and require a new verified
  copy. Add the three tables and set application-owned `PRAGMA user_version = 3`
  in that same transaction, leaving historical SQLx ledger entries untouched.
  Do not register an automatic SQL-plugin migration that precedes safety checks.
  Reopen and verify the exact expected schema, joins, FKs and untouched legacy
  records after commit. The retained copy is recovery evidence for an interrupted
  or failed attempt, never automatically restored over concurrent user data.
- Version 3 is accepted only with the exact T05 schema. Unknown/future versions,
  tables, failed/mismatched ledger entries, partial schemas, populated unused
  normalized tables and malformed snapshots fail closed, without seeding,
  downgrading or opportunistically repairing them. Update T02 compatibility
  narrowly for these three tables; ordinary active-snapshot saves remain allowed.
- Any inability to create, sync or verify the safety copy aborts before DDL. All
  migration/recovery tests and application launches use synthetic temporary
  profiles only, never the owner's actual or separate development profile.

### Bounded recovery and legacy backup limits

- Provide a version-1 draft-only recovery JSON envelope containing the stable
  draft/source IDs, original filename/timestamps, schema/validator identity,
  exact validation-report bytes, their hashes, and base64 original source bytes
  with SHA-256 and byte length. Bound the envelope to 16 MiB. Export rereads and
  verifies persisted bytes; an invalid/missing source blocks export. This is a
  logical export of one immutable aggregate, not a database or full-app backup.
- Recovery into a new isolated profile verifies envelope versions, limits,
  hashes, identities and T01 validation before publishing the immutable source
  and transactionally inserting records. Preserve IDs and original metadata.
  An identical existing aggregate is idempotent; a different occupied slot or
  inconsistent metadata fails without replacement. Interrupted recovery follows
  the same orphan/rollback/retry policy as save.
- Label legacy JSON exports incomplete: they omit native plan drafts, original
  plan JSON and FIT bytes. Block legacy restore and reset/demo replacement while
  a native draft exists, both at the UI and repository boundary. Recheck draft
  presence atomically with native legacy-snapshot replacement so a concurrent
  first draft save cannot bypass the guard. Ordinary snapshot saves may continue
  and cannot mutate native drafts. Complete portable app backup, FIT recovery,
  scheduling, retention and automatic safety-copy rollback remain outside T05.

### Data-screen specification and acceptance

Add one panel using existing form/button/panel styles: Select JSON plan file,
read-only validated preview (identity/calendar, raw instructions and diagnostics),
Save as draft, Reopen saved draft, Export draft recovery, and Import draft recovery.
Keep the spreadsheet workflow separate and unchanged. Show loading, validating,
saving, saved, conflict, unavailable and error states in readable inline text;
disable conflicting actions while busy and save while invalid. Native labels,
visible focus and announced status/error messages support keyboard operation.
Browser mode permits validation/preview but labels native save/recovery unavailable.
No additional layout or subjective visual redesign is proposed.

Focused synthetic tests cover the owner's acceptance areas. Run `pnpm verify`
once at the end and use the existing GitHub Windows Rust workflow for native
compilation/tests. Record separately code tests, browser rendering, complete
native restart/recovery, window-size/keyboard checks and unfinished acceptance.
Status remains Testing until owner acceptance. Only generated temporary native
profiles and a separate browser-development origin are used for verification.

### T05 implementation and verification record

- Implemented the additive three-table migration and native version-1 commands.
  SQLx remains pinned to 0.8.6; the lockfile adds only the direct project edge.
  No automatic SQL-plugin migration is registered. The native database resolver
  exactly matches the plugin's existing `app_config_dir`; immutable source bytes
  use T03's `app_local_data_dir` and Windows guarded-file publication.
- Recovery includes SHA-256 of the complete ordered record representation in
  addition to source/report hashes. The base64 source is never reconstructed from
  parsed JSON. Export/recovery revalidate with the unchanged T01 validator.
- Legacy reset now uses staged restore instead of bypassing it. Native draft
  presence and snapshot replacement share one write transaction, while ordinary
  active-snapshot saves remain on the existing repository path.
- Focused frontend/recovery checks: 31 tests passed in four files. Browser
  rendering exercised a synthetic partial plan with warnings, optional metadata,
  original instructions and raw JSON. Keyboard Enter opens both disclosures with
  visible focus. At 680 × 680 there is no horizontal page overflow; desktop
  rendering was also checked at 1360 × 860. Browser save/recovery correctly remain
  disabled and explicitly unavailable; no mock is described as native evidence.
- Full local `pnpm verify`: passed once (generation consistency, formatting,
  TypeScript, 242 tests in 20 files, production frontend build). The existing
  Vite large-chunk advisory remains. Rust formatting and locked dependency
  metadata checks pass.
  The initial native CI exposed a SQLx RawSql async/Send incompatibility at the
  Tauri command boundary; replacing it with queries for the shipped DDL preserved
  the transaction boundary. The corrected Windows run passed compilation/tests
  at `449cca9`. The final code at `7ab3d86` passed
  [Windows native compilation and tests](https://github.com/Rstanford1/stride-plan/actions/runs/43665235892):
  42 passed (15 T05), zero failed, one helper omitted from the parent suite but
  executed in separate save/read processes by the restart test. This includes
  the final read-only/WAL safety-copy failure test. The same revision passed
  [hosted frontend verification](https://github.com/Rstanford1/stride-plan/actions/runs/43665235907).
  Rust tests use fixture-owned temporary directories, including independent
  save/read processes, safety-copy failures, migration rollback, SQL transaction
  rollback, source damage, recovery, constraints and publication/restore races.
- Remaining acceptance: complete installed-app UI close/restart/reopen and
  draft-only export/recovery through an isolated packaged Windows profile; user
  acceptance. Process-level repository tests do not
  claim a complete Tauri/WebView restart. Full portable app/FIT backup, activation,
  multiple drafts, editing and workbook parity remain outside T05.
- No additional storage-architecture decision needs approval. Review delivery is
  [PR #9](https://github.com/Rstanford1/stride-plan/pull/9), left open and unmerged.
  A final documentation-only commit records these results; native code remains
  the tested `7ab3d86` version. No real or existing development profile was opened.

T05 changed-file manifest (source, synthetic fixtures/tests and documentation only):

- `.github/workflows/rust-windows.yml`
- `DESIGN.md`
- `README.md`
- `ROADMAP.md`
- `UI_INVENTORY.md`
- `src-tauri/Cargo.lock`
- `src-tauri/Cargo.toml`
- `src-tauri/build.rs`
- `src-tauri/capabilities/default.json`
- `src-tauri/migrations/0003_plan_draft.sql`
- `src-tauri/src/fit_source_store.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/src/plan_draft_commands.rs`
- `src-tauri/src/plan_draft_store.rs`
- `src-tauri/src/plan_draft_tests.rs`
- `src-tauri/tests/plan-draft-wire.json`
- `src/components/PlanDraftPanel.test.tsx`
- `src/components/PlanDraftPanel.tsx`
- `src/data/app-context.tsx`
- `src/data/plan-draft-legacy.test.mjs`
- `src/data/plan-draft-store.test.ts`
- `src/data/plan-draft-store.ts`
- `src/data/repository.ts`
- `src/raw-imports.d.ts`
- `src/screens/DataScreen.tsx`
- `src/styles.css`
- `src/test/plan-draft-fixture.ts`

### T04 approved Garmin Personal API slice — November 14, 2026

Owner approval is the attached T04 implementation request. Implement the existing
Data & settings screen's Integrations → Garmin Connect section without redesign.
Disconnected: masked key, show/hide, official key-creation link, Connect and Verify,
understandable errors and Windows-only credential explanation. Connected: saved
credential status, last successful verification, verify/replace key and confirmed
disconnect. Clear the key immediately on submission, including failures.

Only explicit operations: verify, list five recent running activities, select and
retrieve one. Display empty/busy/error/cancelled/success states with native keyboard
controls and existing focus styling. No automatic network request at startup;
status reads only Credential Manager. Never return a stored key or token.

Rust owns fixed-host HTTPS, key/token lifecycle and bounded downloads (30 seconds,
16 MiB ZIP, one regular FIT entry, 32 MiB expanded). Reject unsafe ZIP names,
links/encryption/unsupported compression, invalid FIT framing and CRC. T03 stores
and rereads exact bytes before reporting success. A separate immutable receipt
stores provider identity and content hash; no snapshot or training records change.
Cancellation before publication leaves no source; cancellation racing publication
may retain a verified orphan source/receipt, never a confirmed workout.

Use a fixed application-specific Windows Credential Manager identity. Persist only
the key and verification timestamp there; cache tokens in zeroized process memory,
reacquiring after restart, within the official client's one-hour refresh window,
or once after HTTP 401. Reject redirects. Sanitize all errors at the Rust boundary.
Rate limits expose only a parsed Retry-After delay; never automatically retry 429.

Release gate: Personal API is personal-use feasibility only. Public/commercial
multiuser distribution requires Garmin authorization/licensing review; supplying
one's own key does not remove this gate. Real-account and Windows native acceptance
remain owner tasks. Status is Testing, never Complete without acceptance.

T04 implementation and verification record:

- Isolated baseline `origin/main` `4ad6fca` includes merged T03 #7, the icon and
  Windows Rust workflow. The original development branch/worktree was not edited.
  Real application databases, credentials and recordings were never opened.
- Commands: `garmin_status`, `garmin_connect`, `garmin_verify`,
  `garmin_disconnect`, `garmin_list_activities`, `garmin_retrieve_activity`,
  `garmin_cancel`, `garmin_open_key_page`. All enrolled in the app manifest and granted only to local main.
  The browser opener accepts no arguments and opens only Garmin's official key page.
  Status reads local credential presence/timestamp; it does not contact Garmin.
- Native credentials use a minimal windows-sys CredReadW/CredWriteW/CredDeleteW
  wrapper, per-user local-machine persistence, a fixed target, and best-effort
  zeroization of owned key/token/blob buffers. No credential getter exists.
  OS/HTTP diagnostics and raw bodies are discarded at the boundary. Authorization
  is sensitive-header marked; redirects and proxy discovery are disabled.
  Runtime/allocator/IPC/HTTP internal copies cannot be guaranteed erased by Rust;
  same-user malware and administrators remain outside this storage boundary.
- Official contract references:
  [Garmin authentication client](https://github.com/garmin/connect-personal-api-python/blob/main/src/garmin_personal_api/auth.py),
  [activity client](https://github.com/garmin/connect-personal-api-python/blob/main/src/garmin_personal_api/client.py),
  [Personal API documentation](https://developer.garmin.com/gc-developer-program/personal/personal-api/).
  API-key POST uses Accept _/_; raw JWT response and exp drive in-memory caching;
  fixed-host GET uses Bearer and JSON/ZIP Accept. No cookies/unofficial auth/shared
  secret. Failed key replacement retains the previous credential. Verification
  failure never silently deletes an expired key; replacement/disconnect is explicit.
- HTTP: 10-second connect/30-second whole-request bound, 16 KiB token/512 KiB list/
  16 MiB ZIP streaming bounds, no automatic 429 retry. Numeric/date Retry-After is
  parsed and sanitized. 401/403 invalidates the cache and allows one reacquisition.
  Network, timeout, authentication, provider, credential-store and source-storage
  failures have separate typed codes and frontend copy. Running request/body reads
  are dropped on cancellation. Partial downloads stay in memory and never publish.
- ZIP extraction is to memory only, one flat ASCII regular .fit entry, no paths,
  links/directories, encrypted/unsupported compression or extra files. Expanded
  bound is checked both before and during reads; ZIP CRC, FIT signature, declared
  length/header CRC/final CRC are checked. Existing full FIT decoding stays intact;
  this source-only proof does not decode normalized records or assess workout data.
- Source publication and receipt use T03's guarded directories/no-clobber atomic
  publish. Each operation rereads its final object; conflicts and linked receipts
  fail safely. Receipt contents are version/provider/activityId/sourceHash only.
  New activity IDs with identical FIT bytes can have separate receipts but share
  one source. Changed bytes from the same provider ID remain separate immutable
  content objects. Receipt failure may retain an unreferenced verified source;
  retry is safe. Publication cannot be undone by late cancellation. No cleanup or
  source deletion command was added. Receipts are not part of the legacy snapshot.
- Focused frontend tests: 30 passed in 2 files (six Garmin component tests and
  24 T03 adapter regressions); TypeScript passed. Tests use fake credentials and
  mocked commands, no application provider/profile. Native tests cover successful
  connection, key/token rejection/cache/expiry/restart/replacement/deletion,
  listing/projection/selection, HTTP errors/Retry-After/cancellation, archive/CRC/
  size/path/link/partial failures, T03 exact bytes/hash/duplicates and safe receipt
  conflicts. A Windows native Credential Manager round trip uses a random test-only
  target, never the application identity, and deletes its synthetic credential.
- Full `pnpm verify` passed: formatting, TypeScript, all 223 tests in 17 files,
  and production frontend build. The existing Vite large-chunk advisory remains.
  Final-review correction: use a fixed-URL Windows browser opener for the key link;
  focused frontend checks were rerun after this change (results recorded below).
  Final focused run: 31 tests passed (7 Garmin + 24 T03); TypeScript, formatting
  and Rust formatting passed after the correction.
  [Windows Rust CI run 43651263738](https://github.com/Rstanford1/stride-plan/actions/runs/43651263738)
  completed successfully for implementation commit
  `5005999e92ea4ca0c5729c095127bfe3210685aa`: frontend build, Rust formatting,
  `cargo check --locked` and `cargo test --locked` passed. All 27 native tests
  passed (15 T04 tests, including the real Windows Credential Manager adapter
  against a random synthetic test identity; 12 preexisting T03/contract tests).
  Final evidence-only documentation changes do not alter the tested source tree.
  Rust formatting also passed locally. Local Application Control was already
  established by T03, so blocked native compilation was not retried.
- UI evidence: one isolated browser check used only the Garmin component with
  synthetic mocked commands at a separate origin (no application provider/database).
  Checked 680×860 and 1360×860 layouts; connected narrow view had equal client and
  scroll widths (665 px), including wrapped SHA-256 feedback. Keyboard Tab/Space/
  Enter exercised show/hide, connect and retrieval; focused Connect showed the
  existing blue 3 px outline. Selection and preserved-source feedback rendered.
  Screenshot is a local ignored test artifact, not committed. This is browser
  evidence; packaged Tauri keyboard and actual Windows 200% scaling remain owner
  acceptance tasks. Empty/error/disabled states are covered by component tests.
- Owner real-account checklist (use a disposable/empty supported Windows profile,
  never open a newer v5/v6 profile with this main-based build): create key, verify,
  restart and verify saved-key reuse, list recent runs, retrieve one, repeat and
  compare hash, replace/revoke key and distinguish auth/network errors, disconnect
  and confirm credential deletion with FIT/receipt retained. Inspect focus and
  keyboard controls and the panel at narrow/wide widths and 200% scaling.
  Do not provide the key to Codex or GitHub; never deliberately hit rate limits.
- Deferred: background/scheduled sync, pagination/history, workout decoding/review/
  confirmation, normalized Garmin catalog, plan/totals/shoe mutations, automatic
  cleanup, portable FIT/receipt backup, multi-account/cloud/hosted credentials,
  public/commercial distribution and T05/T25/T26. No packaging or PR creation.
  Status: **Testing**, with Windows native CI passed; real-account/packaged-runtime
  verification and explicit owner acceptance remain pending.

Exact T04 changed-file manifest:

- `.github/workflows/rust-windows.yml`
- `README.md`
- `DESIGN.md`
- `UI_INVENTORY.md`
- `ROADMAP.md`
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock`
- `src-tauri/build.rs`
- `src-tauri/capabilities/default.json`
- `src-tauri/src/lib.rs`
- `src-tauri/src/fit_source_store.rs`
- `src-tauri/src/garmin.rs`
- `src-tauri/src/garmin_commands.rs`
- `src-tauri/src/garmin_credentials.rs`
- `src-tauri/src/garmin_tests.rs`
- `src/data/garmin.ts`
- `src/components/GarminIntegration.tsx`
- `src/components/GarminIntegration.test.tsx`
- `src/screens/DataScreen.tsx`
- `src/styles.css`

## Status

This file records the observed design baseline and approved component specifications. The Today date navigation and manual run-entry workflow below were approved through iterative review and are now implemented for testing.

## Approved T01 training-plan contract — November 13, 2026

The owner approved the [JSON 1.1 contract](schemas/training-plan/README.md), its
Draft 2020-12 schema, Ajv validation, exact original text/provenance, and reproducible
schema-generated TypeScript. The final refinements restrict structured progression
to repetitions/sets within one workout, allow independent-only same-day sessions
without inferring a main, and represent attached and explicitly ordered recovery
without implicit intervals. Broader progression and unsupported structures remain
verbatim text with review warnings. The schema and semantic validator together
define validation; no active plan or stored data is changed.

Implementation status: **Testing**, pending owner acceptance. T01 includes only the
contract, validation, types, synthetic fixtures/tests, and necessary build/document
support. Existing application UI, SQLite, saved profiles and Garmin are untouched.
Verification and compatibility limits are recorded in the contract documentation.

## Product principles

- Local-first and private: no account, cloud backend, telemetry, or social layer.
- Fast daily use: seeing the plan and recording a result should take under two minutes.
- Plan and reality stay separate: preserve original prescriptions, later plan revisions, and actual outcomes.
- Explain, do not prescribe: observations must cite records and missing data and must not diagnose or coach.
- Quiet utility: restrained presentation, limited charts, no gamification, slogans, or decorative motion.
- Accessible by default: keyboard operation, visible focus, text status labels, scalable text, and tabular chart alternatives.

## Current visual language (observed, not approved)

### Typography

- System stack: `Segoe UI Variable`, `Segoe UI`, Arial, sans-serif.
- Page titles are 30 px; major session values reach 38 px; section titles are 17–25 px.
- Eyebrows and table headings use uppercase, heavier weight, and wide tracking.
- Supporting text is commonly 11–13 px, which may be too small at some Windows scaling settings.

### Color

- Neutral warm-gray canvas, white panels, dark green sidebar, and green primary actions.
- Amber, red, and blue distinguish modified, skipped, and moved states.
- Focus uses a separate blue outline.
- Status pills include text, but progress dots and the outcome strip rely primarily on color; tables provide a text alternative in Weekly Review.

### Shape and elevation

- Panels use 9–10 px corner radii, one-pixel borders, and very light shadows.
- Controls use 5–7 px radii; badges are pill-shaped.
- Iconography is consistently sourced from Lucide.

### Spacing and layout

- Desktop shell: 248 px sidebar, collapsible to 68 px.
- Screens are centered, capped near 1220 px, and padded 34/42/60 px.
- Common gaps cluster around 9, 12, 14, 16, 20, and 27 px, but no named spacing scale exists.
- Layouts use CSS Grid for dashboard panels, metrics, activity review, settings, and trends.

### Interaction conventions

- Solid green buttons are primary; white bordered buttons are secondary; green text buttons are tertiary.
- Row actions are icon-only and depend on accessible labels and native title tooltips.
- Forms open in native `<dialog>` modals and save through a single primary action.
- Navigation shortcuts are `Alt+1` through `Alt+6`.
- A skip link, global `:focus-visible` outline, reduced-motion rule, and forced-colors adjustments are present.

## Current responsive behavior

- At 1100 px, two-column content collapses and metric grids reduce to three columns.
- At 800 px, the sidebar becomes icon-only and settings stack.
- `html` has a 940 px minimum width (680 px under the 800 px media query). This creates horizontal scrolling at constrained widths and is unlikely to satisfy comfortable 200% text scaling.
- Large plan and lap tables have no small-window alternative.

## Approved component specifications

### Date-aware Today dashboard

- The heading always begins on the literal local calendar date; it may never substitute a nearby planned session.
- Previous/next-day controls and a compact horizontal week picker allow direct navigation. A Today action returns to the literal date.
- A completed prior day shows its saved result. An incomplete prior day shows an inline prompt to add data, never a blocking pop-up.
- A date with no planned session uses an explicit empty state. Next session, imported-activity window, and reference guidance derive from current data.
- Date buttons are native keyboard controls with selected/today labels that do not rely on color alone.

### Run-entry workflow

- The focused dialog opens on FIT import because it is the expected primary path. Until decoding is implemented, the interface states that selection is only a preview and offers manual entry without claiming an import succeeded.
- Manual entry preserves the original prescription and records actual results separately. Outcomes are Completed, Modified, or Skipped; Modified requires a plain-language explanation.
- Distance and average HR are optional validated numeric values. Time may be entered as duration or average pace. Ambiguous one/two-part durations expose a compact interpretation selector; unambiguous h:mm:ss displays the same control geometry without a misleading arrow.
- RPE applies to the main session. Soreness defaults to None; location occupies stable geometry and becomes editable only when severity is above None. Sleep supports professional subjective labels or Garmin score plus duration.
- Shoe selection defaults to the current/default shoe and shows accumulated mileage. Saving adjusts mileage atomically with the journal and session revision.
- Notes grow automatically and cannot be manually resized. All field labels use the same label-to-control spacing, fixed-height widget rows do not jump as modes change, and the dialog provides a review step before saving.
- The modal title is programmatically associated; controls use native keyboard semantics and visible focus. Validation preserves valid zeroes and distinguishes missing values.

Acceptance criteria: the workflow can record completed, modified, and skipped results; accepts supported time formats and pace units; exposes conditional soreness/sleep fields without layout shift; reviews before save; persists after reload; and has pure domain plus rendered component tests.

### FIT import and Activity Review

Status: **Approved**. This specification reconciles the previously approved timeline-and-segmentation workspace with the later engineering investigation. It supersedes the unmerged activity-level timeline proposal; import batches and safety states support this interface but do not replace its selected-activity pace timeline.

#### Purpose and source-data boundary

- Activity Review is the workspace used after importing one or more FIT files to confirm how the source activities correspond to a planned session.
- Ordinary runs should be quick to confirm, while the same workspace must support workouts, warm-ups, cooldowns, strides, doubles, inaccurate lap presses, recording gaps, and shoe changes.
- Imported files, source activities, samples, and recorded laps are immutable. Corrections create review metadata, bundles, and user-defined segments without overwriting source facts.
- Source FIT files are read only. Packaged import preserves a verified untouched copy in application data before committing normalized records; the original file is never moved, renamed, overwritten, or deleted.

#### Core workflow

1. Select one or more FIT files from run entry or Data & Settings through one shared import service.
2. Decode, validate, hash, and preserve each source while reporting progress, partial success, cancellation, and recoverable failures.
3. Review each imported source activity, its suggested planned-session match, and any exact or possible duplicate result.
4. Confirm or correct the match, activity role, primary designation, and activity-level shoe.
5. Inspect the selected activity's pace timeline, optional metric overlay, recorded laps, pauses, gaps, and suggested transitions.
6. For activities that need interpretation, create or adjust meaningful segments, classifications, and segment-level shoe overrides.
7. Review the assembled session bundle, total distance/duration, journal fields that apply to the primary session, and unresolved warnings.
8. Confirm and save the coherent review atomically. Draft work must not affect plan completion, metrics, observations, or shoe mileage before confirmation.

#### Workspace layout

- A persistent top summary shows the planned session/date, unchanged original prescription, imported-file count, total distance/duration, auto-match explanation, unresolved issue count, review status, and confirmation action. Do not reduce match evidence to an unexplained confidence adjective such as **Strong**.
- Directly below the summary, an issue queue lists only decisions that still require attention and links each item to the relevant activity or control. A disabled confirmation action must always have a nearby plain-language reason.
- A compact imported-activity rail shows each source activity's start time, distance, duration, suggested role, match/review status, shoe, and duplicate warning. Selecting an item changes the details, timeline, and table without losing draft edits.
- The selected-activity header uses compact aligned summaries for distance, duration, average pace, average heart rate, elevation when present, source filename, start time, role, primary state, and assigned shoe. Avoid decorative dashboard cards.
- The pace timeline is the main review and editing surface. A synchronized lap/segment table sits below or beside it and is the complete non-visual alternative.
- The final bundle summary shows the planned session, every attached activity and role, primary activity, total distance/duration, shoe-mileage allocation, unresolved warnings, and journal data that applies to the main session.

#### Progressive disclosure and decision load

- The default screen emphasizes unresolved decisions, not every available control. High-confidence suggestions may be applied to the draft automatically only when they are labeled as suggested, reversible, and not yet confirmed.
- Easy or otherwise unstructured runs use a compact state containing source facts, planned-session match, activity role, shoe, journal fields, and confirmation. The timeline and segment editor remain available through **Review activity details** but are not expanded by default.
- Structured workouts expand a pace preview and detected segment summary. Precise boundaries, overlays, source laps, shoe overrides, and the complete table appear only after **Review segments** or when validation identifies a segment problem.
- Match, role, primary, and shoe choices appear as a compact decision summary. **Edit details** opens the contextual decision panel directly below the selected activity at the same content width; opening it never adds a third column or pushes controls beyond the window.
- The activity rail and selected-activity status use the same derived review state. Resolving the last issue updates every status, issue count, and confirmation action together.
- Draft decisions autosave locally and show a concise saved/saving/error state. Navigation never silently discards an in-progress review.
- There is one primary confirmation action in the persistent final summary. If a second shortcut is retained for long desktop pages, it mirrors the same label, enabled state, explanation, and focus target.
- At constrained widths and 200% scaling, the summary, activity rail, selected-activity details, timeline, segment table, and bundle summary stack in reading order without requiring horizontal scrolling for core actions.

#### Timeline and metric overlays

- Pace is always the primary series. The runner may overlay heart rate, elevation, cadence, or power when available rather than replacing pace.
- Scales are independent or explicitly labeled. Color is paired with text, line style, landmarks, or patterns and is never the only way to understand a series or classification.
- Timeline landmarks distinguish recorded FIT laps, automatically generated mile/kilometre laps, user-created boundaries, pauses or gaps, selected ranges, and proposed transitions based on meaningful pace changes.
- Recorded laps are evidence, not automatic workout repetitions. Automatic transitions and segment classifications remain suggestions until the user confirms them.
- Timeline selection and table-row selection remain synchronized.

#### Segmentation

- User-defined segments may be classified as Warm-up, Work, Recovery, Cooldown, Strides, or Other.
- The runner may place a boundary, drag it precisely, remove or merge it, optionally snap it to a recorded lap/pause/visible transition, zoom for precision, select a range, classify it, and undo or redo edits.
- Segment validation prevents overlaps, invalid ordering, and unallocated recorded distance. Segment boundaries and classifications never alter source samples or recorded laps.
- Straightforward easy runs arrive with a primary easy/recovery role, default shoe, primary selection, quiet recorded-lap landmarks, and no required segmentation step.
- Workouts expose the same workspace in an expanded state with a larger timeline, differentiated work/recovery regions, boundary tools, overlays, and segment controls; they do not become a separate screen.

#### Activity roles, bundles, and shoes

- Supported activity roles are Primary easy/recovery, Primary long run, Primary workout, Warm-up, Cooldown, Strides, Supporting recovery, and Unrelated.
- Several source activities may form one planned-session bundle, but an activity belongs to at most one bundle and a confirmed bundle has exactly one primary activity when it represents session completion.
- Supporting activity mileage may contribute to actual mileage but remains secondary and cannot complete or rescue missed core work. Unrelated activities are retained for audit and excluded from completion and running metrics.
- Activity-level shoe selection defaults appropriately and shows accumulated mileage from the reusable shoe library. A user-created segment may override the activity-level shoe for its range.
- Shoe mileage changes only when the review is confirmed. Warm-up, workout, and cooldown files may use different shoes; a single continuous activity may use segment-level shoe overrides.
- RPE and general session notes apply primarily to the main session and are not repeated for every supporting activity.

#### Matching, duplicates, and import safety

- SHA-256 of original bytes identifies exact duplicates. An exact duplicate creates no second activity or source copy and explains the prior import it matches.
- A versioned deterministic comparison of the strongest shared facts—device identity, session start, normalized timer duration, and distance—may flag a possible duplicate. It is a warning requiring an explicit record choice, never an automatic rejection. Actions use consequence-oriented labels such as **Use existing activity** and **Use imported activity**, explain which record will represent the workout, and preview any change to bundle totals, primary ownership, or source preservation. Resolving a duplicate must not silently remove the bundle's primary activity or leave totals stale.
- Plan-match suggestions consider explicit activity local date, planned/recorded distance, directly observable sport or segment structure, and whether another confirmed primary owns the session. Suggestions include plain-language evidence, remain editable, and leave exact ties unresolved.
- Import batches record decoded, failed, cancelled, exact-duplicate, possible-duplicate, excluded, and unresolved sources. Status text uses **New**, **Needs attention**, **Ready**, and **Reviewed**.
- Missing optional FIT fields produce omissions or warnings rather than failed decoding. Non-FIT, corrupt/truncated, failed-integrity, unsupported, and ambiguous multi-session sources return typed user-readable errors.
- Browser development may exercise decoding/review but must label durable preservation unavailable. Packaged preservation uses content-addressed app-data storage and never claims success until the copied bytes are verified.

#### Validation and confirmation

- Confirmation explains and blocks duplicate decisions that remain unresolved, multiple or missing primaries, missing roles, required shoes not assigned, overlapping/invalid/unallocated segments, implausible-date matches, incoherent bundle associations, and material differences from the original prescription.
- Warnings are review prompts, not diagnoses, coaching, or automatic plan changes.
- Draft edits persist without affecting confirmed activity decisions or downstream calculations. Confirmation stores source links, match/role/bundle decisions, segments, shoe allocations, review status, and the allowed session-completion transition atomically and idempotently.
- Confirmation copy states the concrete result: which planned session will be completed, which activities will be attached, and which shoe mileages will change. Material differences from the prescription remain visible beside a reminder that the original plan will not be rewritten.
- A reviewed import reopens read only. **Revise review** creates a new draft from the latest confirmed decisions; reconfirming appends revision history and never rewrites source facts or prior revisions.
- Persistence or preservation failures preserve the review draft, explain what was not saved, and offer a safe retry without creating duplicate mileage, activities, bundles, or completion changes.

#### Difficult and recovery states

- Optional metrics that are absent display **Not recorded** or are omitted; they never appear as zero. Unknown local time or timezone, stopped-clock gaps, distance resets, impossible sample order, and sensor dropouts are identified without inventing corrected source values.
- Switching activities, collapsing detail, resizing the window, or reopening the app preserves draft selection, scroll context where practical, and all edits. A changed source file cannot overwrite its earlier preserved copy.
- When suggestions conflict, the interface presents the competing evidence and leaves the decision unresolved. It does not choose by arbitrary ordering.
- Long activity names, shoe names, localized dates, metric units, large distances, and 200% scaling must not hide status or actions. Tables may scroll horizontally, but every editing action also has a stacked or labeled control path.
- Boundary changes announce the affected segment and new time, remain undoable until confirmation, and cannot create negative, overlapping, or zero-length segments. Dragging is optional; keyboard and button controls are complete.
- Confirming, retrying, or revising shows a stable in-progress state and prevents double activation. Closing or navigating away during a save cannot produce a partially confirmed review.

#### Accessibility and responsive behavior

- The entire workflow supports keyboard navigation, visible focus, programmatic labels, non-color status/classification text, and 200% text scaling.
- Every timeline operation has a keyboard and synchronized-table equivalent, including selecting ranges/boundaries, adjusting boundaries, classifying segments, and undo/redo.
- Progress and save results use polite announcements; blocking validation uses an alert and moves or links focus to the relevant activity, segment, or control without repeatedly stealing focus.
- Source laps and user-created segments remain distinguishable in both the graph and table. The table includes number, start/end time, distance, duration, average pace, average HR, classification, and shoe assignment when applicable.

Acceptance criteria: generated or redistributable fixtures cover decoding and error cases without personal data; pure tests cover time conversion, duplicates, match explanations, bundle invariants, segmentation, shoe allocation, and completion boundaries; repository tests cover schema upgrades, backup/restore, ordered saves, rollback, retry, preservation, and idempotency; rendered tests cover easy/workout states, multiple files, timeline/table synchronization, keyboard boundary editing, duplicates, bundles, shoes, validation, confirmation, failures, reload, reopening, constrained windows, and 200% scaling. Until implementation, verification, and user acceptance are recorded, the component remains **Design approved**, not Complete.

## Audit evidence

- Code inspected: all React screens/components, state and repositories, domain rules, tests, CSS, Tauri shell, capabilities, and migration.
- Rendered inspection: all six screens plus the historical run-entry dialog at the local browser-development viewport.
- Verified checks: formatting, TypeScript, 17 automated tests, and production build.
- Not visually verified: populated Activity Review, import validation preview, triggered observation details, native Tauri/SQLite behavior, Windows installer, 200% Windows scaling, and forced-colors rendering.

## Approved T02 loading and legacy restore — November 13, 2026

Owner-authorized scope: fail closed on invalid/inaccessible/unsupported saved
state; stage legacy JSON restore (audit R1/R2, ADR-09, task T02). **Testing**, pending owner acceptance.
Use existing panels, status text and native buttons. Recovery replaces the loading
indicator with the failure category, writes-disabled explanation, compatible-app/
file-access guidance and Retry. No reset action is offered in recovery.
Restore first shows version, record counts and missing FIT evidence; Cancel has
no effect. Explicit Replace confirmation creates and verifies a safety copy,
stages and validates the replacement, then acknowledges persistence before success.
Missing FIT files block replacement; copied verification labels are never proof.
Legacy exports explicitly exclude original FIT bytes. No unrelated screen redesign.

Integration baseline: origin/main bdf7519 (T01 merged), snapshot reader v4.
Support validated v2/v3 through explicit lossless adapters and v4 unchanged;
v5/v6/future versions are unsupported, never downgraded or reseeded. The three
unmerged development commits and seven modified files remain separate and intact.
This PR targets main and does not incorporate or depend on that unaccepted work.

### T02 verification and recovery record

- Base: origin/main bdf7519711dae9042ad94230e2d4fb34490123bb, T01 PR #5 merged.
  Delivery branch: codex/t02-safe-loading, targeting main with no version-6 dependency.
- Protected development: b80f621, 0f47fb8 and 24b6556 are not cherry-picked,
  reset or merged. The seven modified application files and five untracked root
  files remain in the original worktree. All changes here use a separate worktree.
- Validation: explicit v2/v3/v4 shapes, unique IDs, references, finite numeric
  values, dates, enums, revisions, source samples/laps and import-batch links.
  Unknown fields fail closed rather than being stripped. No schema-1.1 changes.
- Durable boundary: initialize only absent state, never malformed/empty text.
  Missing active data with surviving safety copies is recovery, not empty storage.
  Load failures and save failures lock subsequent writes. No save runs merely
  because a valid snapshot was loaded. Saves/load/restore are serialized.
- Migration: retain exact original payload before conversion, validate and stage
  the converted snapshot, atomically publish, then read back. Historical v2 sleep
  labels map explicitly; original prescriptions, journals and revisions remain.
- Restore: parse/validate and preview before confirmation; current edits finish
  saving first. Verify immutable pre-restore, incoming and staged copies before
  a compare-and-replace of the canonical snapshot. Success follows readback.
  A failed/lost acknowledgement attempts conditional rollback; if storage also
  blocks rollback, the original safety copy remains and application writes lock.
  Interruption before atomic publication leaves the prior active snapshot;
  interruption after publication leaves a complete replacement plus safety copy.
- SQLite safety copies are JSON payload rows in snapshot_recovery, not a full
  database/file backup. Browser copies use stride-plan:data:v1:<purpose>:<UUID>
  keys plus a recovery-present marker. Neither is automatically pruned. Recover
  a selected payload using a compatible app; there is no automatic rollback picker
  or full portable backup UI in T02. Native tables outside this snapshot,
  populated legacy normalized tables, or SQL migrations newer than 2 block this
  reader/replacement. No normalized-table cutover is performed.
- FIT restoration checks real locally preserved bytes by hash and byte length
  during preview and again before replacement. Paths are derived from the hash;
  copied verified flags are insufficient. Missing/unreadable/mismatched files
  block restore. Browser mode cannot restore snapshots that require original FIT
  sources. Existing source files are never changed by restore.
- Automated evidence: pnpm verify passed (pinned pnpm 11.25.0 via Node), including
  formatting, TypeScript, 193 tests in 16 files and production frontend build.
  Test fixtures use memory and newly created stride-t02-synthetic-* temporary
  SQLite databases only. Real SQLite tests cover read-only writes, SQL aborts,
  CAS conflicts, staging interruption, preserved recovery copies and reopening.
- Rendered evidence: browser recovery and restore checked at 1360×860 and
  680×680. Visible keyboard focus, initial Cancel focus, Tab to Replace, Escape
  cancellation/focus return, Enter confirmation, empty-record preview, saved
  success and missing-FIT disabled replacement were exercised using in-memory
  synthetic data on a separate development port. JSDOM tests cover unresolved
  loading, retry, cancellation, disabled/busy states and delayed persistence.
- Native limit: pnpm tauri build attempted without launching an executable or
  opening a real profile. Windows Application Control blocked selectors and
  indexmap build scripts (OS error 4551). No policy was changed. Packaged Tauri
  filesystem/SQL-plugin execution, physical power-loss durability, Windows 200%
  scaling and screen-reader acceptance are not verified. SQLite engine tests
  are not presented as packaged-runtime evidence. The existing Vite large-chunk
  warning remains. Browser localStorage cannot promise hardware-level fsync.
- Status: Testing / ready for focused code review, not Complete or approved for
  deployment over the owner's version-6 profile. Owner acceptance and packaged
  runtime verification remain outstanding. T03 was not started.

Native startup correction: SQL plugin auto-migrations are no longer registered,
because they execute inside Database.load before saved-state validation. Existing
SQL tables and migration history remain untouched. A genuinely new database gets
only the already-canonical app_state table; the two dormant legacy normalized DDL
files remain in source for later migration planning. An existing database missing
app_state fails closed. Future normalized migration must handle both historical
SQL layouts and this snapshot-only layout explicitly. This is not the normalized
storage migration, and no schema version is rewritten to pretend it occurred.

### T02 final corrections — November 14, 2026

- Reject v2 snapshots containing newer sleep-mode values before migration so
  conversion cannot overwrite those fields; retain the regression assertion.
- An existing app_state table without its active row now always requires
  recovery, even when no safety copies exist. Only a database with no user tables
  follows the fresh initialization path. Tests verify a deleted active row with
  absent/empty recovery storage causes no writes and leaves database bytes and
  migration history unchanged.
- Candidate validation and unavailable FIT sources raise a distinct RestoreInputError.
  The provider rethrows it for the existing restore message without disabling valid
  active state. The failed confirmation dialog closes so the message is visible.
  Storage/save/commit errors still enter recovery and disable writes. Regression
  tests exercise malformed/future input, FIT access lost after preview, continued
  editing after rejection, and write locking after an actual storage failure.
- Focused regression run: 70 tests passed in 3 files. Final full pnpm verify:
  193 tests in 16 files, formatting, types and frontend build passed.
  Browser layout and native packaging were not repeated; the existing native
  Application Control blocker remains. No real profile or protected source work
  was accessed for testing or modified.
- Reset Demo behavior is unchanged and remains a separate follow-up. No T03 work,
  dependencies, new PR or merge is included. User acceptance remains pending.

### T03 native FIT source storage — November 14, 2026

Approved scope: the owner's T03 implementation request authorizes the narrow
native store described by the Phase 0 roadmap and ADR-05/06/07. No UI redesign,
parser replacement, database migration, Garmin work, or source deletion.
Base: `origin/main` at `6fdde51`, including T01 and merged T02 PR #6.
Branch/worktree: `codex/t03-native-fit-storage`, `work/t03-native-fit-storage`.

Contract and ownership:

- Rust owns `store_fit_source` and `read_fit_source`, each accepting a single
  version-1 request. Store takes `sourceHash` and original byte array; read takes
  only `sourceHash`. Unknown request fields and unsupported versions fail.
- Native code validates lowercase 64-character SHA-256 IDs, computes the actual
  SHA-256, checks the `.FIT` signature and enforces a 32 MiB object bound. Full
  decoding/CRC validation stays with the existing FitDecoder. Native work runs
  on blocking workers, not the webview thread.
- The root comes exclusively from Tauri's AppLocalData resolver. Existing keys
  remain `fit-source:<hash>` and `fit-sources/<first-two>/<hash>.fit`; relative
  paths are metadata, never accepted as filesystem instructions. Original names
  and import timestamps remain in the existing source record, unmodified.
- Windows opens and checks every ancestor without following reparse points and
  holds directory handles denying replacement/write access during operations.
  Final objects must be regular files, without reparse points or extra hard
  links. No frontend-controlled path, arbitrary read/write/delete API, or
  final-object cleanup is exposed. Reads never create storage directories.
- Store creates a unique file on the destination volume with create-new
  semantics, writes and syncs it, rereads and compares exact bytes/hash, closes
  it, then publishes with MoveFileExW WRITE_THROUGH, without REPLACE_EXISTING
  or cross-volume COPY_ALLOWED. It rereads the final object before success.
  Existing identical bytes return the same metadata; conflicting content is
  retained and rejected. A competing publisher is reverified, never overwritten.
- Only this operation's temporary file is removed, with explicit cleanup errors.
  A terminated operation may leave a harmless staging file or a complete orphan
  object. Neither establishes a saved snapshot reference; later retries verify
  finalized objects from disk. Staged leftovers and final orphans are retained;
  inventory/reconciliation and automatic cleanup are deferred.
- Versioned metadata reports source ID/hash, byte length and relative key.
  Typed errors distinguish invalid ID/version/type/size/hash, conflict,
  missing/corrupt data, unsafe paths, inaccessible storage, write failure and
  cleanup failure. Raw OS paths/errors never enter command results or UI errors.
- The app manifest enrolls both commands in Tauri's capability enforcement and
  grants only them to the local `main` window. Broad `fs:default` and filesystem
  plugin registration are removed. Existing unrelated dialog/SQL permissions
  and CSP are retained; no remote origin is granted native access. Tauri's
  [capability rules](https://v2.tauri.app/security/capabilities/) govern command
  enrollment. Publication follows Microsoft's
  [MoveFileExW contract](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw).

Compatibility and evidence:

- The FitSourceStore boundary and shared import controller/decoder stay intact.
  Browser storage remains explicitly unavailable. Native read errors are typed
  exceptions (including missing); T02 already handles them conservatively.
  Restore previews now also clear stale verification/path metadata on any
  failed byte check. No existing recording is scanned, moved or rewritten.
- Existing supported source records retain the same IDs, filenames and paths.
  Objects over the new bound or unsafe linked objects fail explicitly and are
  retained. JSON snapshot versions and training-plan JSON 1.1 are unchanged.
  Legacy JSON still excludes FIT bytes; complete portable source backups,
  historical migration and normalized storage remain separate tasks.
- The small TypeScript wire declarations are handwritten and checked against a
  shared synthetic JSON fixture also consumed by Rust serde round-trip tests.
  This avoids adding an unverified binding-generator dependency in T03; full
  generated bindings remain deferred. No generated output is committed.
- Focused frontend tests: 71 passed across 5 files (adapter, import service,
  controller, decoder and T02 source/restore safety). Native tests cover exact
  bytes/hash, idempotence/reopen, conflict, short/failed/interrupted writes,
  competing publication, missing/corrupt/inaccessible files, invalid IDs and
  versions, bounds, junction/hard-link escape, guarded-directory replacement,
  cleanup failure and serde compatibility using synthetic temporary profiles.
- Native command attempted once:
  `cargo test --manifest-path src-tauri/Cargo.toml fit_source --offline`.
  Windows Application Control blocked the `cookie` dependency build script and
  procedural-macro DLLs (OS error 4551), before project compilation/tests.
  Native tests and capability enforcement are **not executed/verified**; code
  inspection and frontend mocks are not presented as native acceptance. No
  security policy change, installer build, browser UI test or real-profile launch.
- Final gate: `pnpm.cmd verify` passed once, including generated-plan type
  consistency, formatting, TypeScript, all 217 tests in 16 files and production
  frontend build. The existing Vite large-chunk advisory remains. Rust
  `cargo fmt --manifest-path src-tauri/Cargo.toml --check` and `git diff --check`
  passed. These are not a native compilation or execution result.
- Status: **Testing**, with native verification blocked and owner acceptance
  pending. Native application/restart and physical power-loss evidence remain
  outstanding. Existing development commits, dirty files and untracked files
  are preserved in their original worktree; no real application data was read
  or modified. T04 is not started.

Exact T03 changed-file manifest:

- `.gitignore`
- `DESIGN.md`
- `ROADMAP.md`
- `UI_INVENTORY.md`
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock`
- `src-tauri/build.rs`
- `src-tauri/capabilities/default.json`
- `src-tauri/src/lib.rs`
- `src-tauri/src/fit_source_commands.rs`
- `src-tauri/src/fit_source_store.rs`
- `src-tauri/tests/fit-source-wire.json`
- `src/data/fit-source-contract.ts`
- `src/data/fit-source-store.ts`
- `src/data/fit-source-store.test.ts`
- `src/data/fit-import-service.test.ts`
- `src/data/restore.ts`

# F1 approved shared visual foundation and application shell

Status: **F1 implementation: Complete for approved scope; owner visual acceptance passed; PR #21 awaiting merge decision. Packaged installation and existing-profile compatibility remain deferred/unverified release requirements.** The F1 design specification and Option C theme decision supersede older five-item navigation and single-theme visual examples. Scope is presentation and navigation only.

- Primary destinations, in shortcut order `Alt+1`–`Alt+6`: Today, Training, Activities, Analytics, Shoes, Settings. The active destination has visible text and `aria-current="page"`. Sidebar collapse retains accessible labels and keyboard operation.
- Training contains the existing Plan and Weekly Review screens as selectable subviews. Their calculations, editing, and review behavior remain unchanged. Today links to the Plan subview; Activities, Analytics, and Settings reuse their existing screens.
- Shoes is a read-only view of existing shoe names, mileage, default designation, and active/retired status. It supports empty records and makes no claim to shoe management, categories, goals, or an allocation ledger.
- Appearance follows the operating system's light/dark setting by default and responds while the application is open. Warm-light and dark-charcoal palettes use semantic CSS tokens for canvas, text, muted text, sidebar, surfaces, borders, actions, focus, and status colors. The token model permits a later explicit System/Light/Dark override without adding persistence in F1.
- Shared shell and controls use Segoe UI Variable/Segoe UI, a restrained spacing scale, quiet bordered surfaces, consistent buttons, visible focus, text alongside status color, and responsive stacking. Core actions stay reachable at representative window widths and 100%, 150%, and 200% Windows scaling.
- Loading and saved-data recovery remain accessible. Garmin, JSON plan intake and drafts, FIT import, activity workflows, persistence, and all domain contracts remain untouched.

### F1 verification record

Status: **F1 implementation: Complete for approved scope; owner visual acceptance passed; PR #21 awaiting merge decision. Packaged installation and existing-profile compatibility remain deferred/unverified release requirements.**

- **Owner visual acceptance:** six-destination navigation; Training Plan and Weekly Review navigation; read-only Shoes; `Alt+1`–`Alt+6`; keyboard focus; sidebar collapse/expand; and Training tabs were reviewed and passed. Browser light/dark switching passed after the browser was configured to follow the system. A native Tauri development window launched successfully; native light/dark switching and Windows scaling at 100%, 150%, and 200% were visually confirmed. The owner recommends 200% Windows scaling. Narrow native layouts at 200% had no confirmed F1 visual merge blocker; heavy wrapping in the existing Training table is deferred to F3.
- **Automated verification:** the prior `pnpm verify` passed with 307 tests, and hosted frontend and Rust checks passed on original F1 commit `a176f95`. These checks do not substitute for owner visual acceptance or packaged installation acceptance.
- **Packaged build evidence:** a local NSIS installer build succeeded after moving Cargo build outputs outside OneDrive with `CARGO_TARGET_DIR`, producing `Stride Plan_0.1.0_x64-setup.exe`. The generated installer has not been installed or smoke-tested. Packaged Windows acceptance, existing installed-profile compatibility, full native storage, and Garmin Credential Manager isolation remain unverified and deferred to release testing by owner agreement.
- **Repository and merge state:** the F1 worktree was clean at `a176f95`, and `git diff --check origin/main...HEAD` returned no errors. PR #21 remains awaiting an explicit owner merge decision; do not treat this visual acceptance as full release acceptance or merge authorization.
