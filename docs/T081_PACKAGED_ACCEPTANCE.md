# T08.1 isolated Windows acceptance kit

Preparation is authorized; interactive acceptance is pending. PR #18 remains
unmerged. These packages must never use the normal Stride Plan profile. No
application installation, launch or profile migration occurs in the build workflow.

## The two pinned installers

| Property               | Baseline                                                    | Upgrade                                                         |
| ---------------------- | ----------------------------------------------------------- | --------------------------------------------------------------- |
| Source                 | `fb7ff13ce64378e7b63a7c39b6df634971029da4` (PR16, JSON 1.1) | `ff18ad0f7d9875ae0253d2623a292ae0e465abc9` (PR18, JSON 1.1/1.2) |
| Package version        | `0.1.810`                                                   | `0.1.811`                                                       |
| Product                | Stride Plan T08.1 Test                                      | Stride Plan T08.1 Test                                          |
| Application identifier | `com.strideplan.t081test`                                   | `com.strideplan.t081test`                                       |
| Executable             | `stride-plan-t081-test.exe`                                 | `stride-plan-t081-test.exe`                                     |

Both versions intentionally share **this new test identity** so that the newer
installer can exercise a real upgrade of its predecessor. Neither uses the normal
product identity or the earlier T04/T05/T06/T07 test identities.

- Default installation: `%LOCALAPPDATA%\Stride Plan T08.1 Test`.
- Database/preferences: `%APPDATA%\com.strideplan.t081test\stride-plan.db`.
- Source JSON, FIT and WebView data: `%LOCALAPPDATA%\com.strideplan.t081test`.
- Credential namespace: `com.strideplan.t081test/garmin-personal-api/v1`.
- Uninstall registration: `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Stride Plan T08.1 Test`.

Keep the distinct default installation directory. Do not browse to the regular
Stride Plan directory. The standard NSIS installer allows a person to choose a
custom directory; these checks verify the safe default and generated identities,
not every manual choice. Install for the current user. Shared WebView2 setup/update
is disabled, so an existing WebView2 runtime is required. Do not weaken Windows
Application Control or other security settings if execution is blocked.

## Build provenance and safety

The separate packaging workflow/PR checks out its own commit and each full pinned
application revision independently. It runs the complete frontend gate, native
formatting and native synthetic tests before building. The upgrade job also runs
profile-tool tests. Only the disposable CI source receives a separate full Tauri
configuration override and the single credential-literal substitution. Production
config, source plan JSON schema and validator bytes are unchanged. The manifest
records the effective configuration, versions, source/workflow commits, installer
and executable SHA-256, generated installer hash and validation gates.

Each installer artifact contains exactly its installer and `build-manifest.json`.
The separate kit contains this checklist, `profile-check.mjs`, a manifest, eight
synthetic original-plan inputs and one synthetic pre-PR16 recovery envelope. No
user database, backup, export, credentials or runtime acceptance report is uploaded.
Artifacts are retained for 14 days. Compare downloaded file hashes against their
build manifest before installing. These are test builds, not production releases.

The profile tool requires Node.js 22.13+ (or the already-installed newer Node).
It reads only the fixed test-identity paths, rejects links/shared files and foreign
identities, checks SQLite in read-only mode, and writes only new reports inside the
extracted kit's `reports` folder. It never creates/modifies an application database,
launches an app, reads credentials, uploads data, replaces evidence or selects a
profile path from command-line arguments. Only byte hashes matching this kit's
synthetic source catalog are accepted. Close the test app before every capture.
The tool supplements the application's contract validation; checksum comparison
is not a substitute for the application's matching-validator replay.

## Short acceptance checklist

Extract the kit to a separate ordinary folder, such as Downloads. Open PowerShell
in that folder for the commands below. Do not open the normal Stride Plan app.

### 1. Create the old draft with the baseline

1. Verify the baseline installer/manifest identity and hash, then install **Stride
   Plan T08.1 Test 0.1.810** into its distinct default folder. Use no real coach
   documents, Garmin keys or private information.
2. Import `fixtures/synthetic-1.1-bom-crlf.json` and Save as draft. It deliberately
   contains a UTF-8 BOM, CRLF and trailing whitespace. Review its nonblocking
   synthetic warnings, then restart and reopen the saved draft.
3. Close the test app and run `node profile-check.mjs capture-before`. This creates
   `reports/before.json` without changing the test database. Reopen the test app,
   export draft recovery to `reports/before-recovery.json`, and close it again.

### 2. Upgrade the same test identity and verify migration

1. Install **0.1.811 directly over the test baseline**, keeping the same test
   folder/identity. Do not uninstall the baseline or select any delete-app-data
   option. Reopen its existing 1.1 draft and export recovery to
   `reports/reopened-recovery.json`. Close it and run:
   `node profile-check.mjs compare-recovery before-recovery.json reopened-recovery.json`.
2. Reopening alone intentionally leaves storage at SQLite version 3. To exercise
   the approved v3-to-v4 migration with an old draft present, reopen the test app,
   import `fixtures/valid-1.2-40.json` and choose Save as draft. **Expect the existing
   one-draft-slot conflict.** Preparation migrates storage, but the old 1.1 draft
   must remain saved; the 1.2 candidate must not replace or activate it.
3. Reopen the saved 1.1 draft, export `reports/after-recovery.json`, and close the app.
   Run `node profile-check.mjs capture-after`, then
   `node profile-check.mjs compare-upgrade`, then
   `node profile-check.mjs compare-recovery before-recovery.json after-recovery.json`.
   All must pass. These checks compare exact source hash/length, every persisted
   source/draft/validation field, recorded report/fingerprint and active snapshot,
   and verify a matching old-schema safety copy under the test `t081-safety` folder.
   The recovery files must be byte-identical. The original plan remains schema 1.1;
   only draft storage becomes capable of persisting 1.2.

### 3. Save/restart/recover a new JSON 1.2 draft

The single draft slot has no replacement/delete workflow. Preserve the completed
upgrade test before starting a fresh synthetic phase: close the app and, in Explorer,
rename **only** the two `com.strideplan.t081test` data folders to clearly named
`com.strideplan.t081test-upgrade-archive` folders. Do not rename the installation
folder or any regular Stride Plan directory. Do not overwrite existing archives.
The helper does not perform this operation. A fresh launch of the upgraded test
application recreates its same test identity with an empty data slot.

1. Import a 1.2 fixture, review weekly target/unit, fixed priority workouts, movable
   easy mileage, optional double and separate policy/source evidence. Save as draft.
   Export `reports/new-recovery.json`, close, restart and reopen. Export
   `reports/new-restarted-recovery.json`, close, then run
   `node profile-check.mjs capture-new` and
   `node profile-check.mjs compare-recovery new-recovery.json new-restarted-recovery.json`.
2. Preserve this synthetic test profile in separately named test-only archive
   folders as above. Relaunch the same upgraded test app with an empty slot, use
   Import draft recovery with `reports/new-recovery.json`, and export
   `reports/new-restored-recovery.json`. Compare it with the original using the
   same compare-recovery command. Repeat with other mileage-tier fixtures in fresh
   synthetic phases if desired, keeping all archives.

### 4. Check pre-PR16 historical recovery (audit A1)

Preserve the current test profile and use another fresh phase under the same test
identity. In **the upgraded application**, import draft recovery from
`fixtures/synthetic-pre16-recovery.json`, reopen the 1.1 draft, and export it to
`reports/pre16-roundtrip.json`. Close the test app and run
`node profile-check.mjs compare-pre16 pre16-roundtrip.json`.

This synthetic envelope was generated from the frozen pre-PR16 validator, not by
substituting a fingerprint on a user export. Its real original synthetic BOM/CRLF
bytes, exact warning report, hashes and pre-PR16 fingerprint must survive unchanged.
The old baseline intentionally does not claim compatibility with pre-PR16 exports;
that is the defect PR18 fixes. No historical/current evidence is silently rewritten.

### 5. Record UI and recovery observations

Check keyboard tab/disclosure operation, visible focus, save/recovery cancellation
and error feedback, explicit unknown states and relevant Windows scaling/window
sizes. Confirm that saving a draft has not changed the active plan. Keep all
synthetic reports and archives locally; they are not CI inputs or uploads.

If any comparison or reopen fails, stop and keep the test profile, reports and
verified pre-migration safety copy. Do not edit fingerprints, reports, database
versions or constraints. Older builds may reject the upgraded test database. Any
older-build recovery must restore a verified old copy into a **separate isolated
recovery profile**, retaining its original source folder and preserving the newer
profile. Restoring an old copy discards subsequent changes from that restored
copy. No automatic downgrade/restore is provided by this preparation.

## Audit A1 conclusion and remaining acceptance

PR18 already preserves only the explicitly recognized historical 1.1 fingerprints
(pre-PR16 `316c146e...0d028e9`, PR16 `d4355feb...9303ba`) and replays the matching
validator/report. New imports use current validation. Unknown/future versions,
unknown fingerprints and altered evidence fail closed. Frontend/native cross-version
regressions passed in PR18 CI (345 frontend tests; 54 native passes, one child helper
intentionally ignored by normal discovery and invoked by its parent test).

A1 blocks releasing the affected main without the compatibility fix. It does not
need a second implementation task alongside PR18. Packaged preservation/recovery
acceptance remains a release gate; the generated kit adds an actual baseline
upgrade and a separately generated pre-PR16 recovery test. Preparation/build success
alone is not interactive user acceptance. PR18 and this packaging PR remain unmerged.
