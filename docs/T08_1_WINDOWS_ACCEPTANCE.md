# T08.1 Windows acceptance and recovery

Status: Testing. Local implementation only; no push, PR or installed-profile run
is authorized. Use synthetic fixtures. Never test against the normal Stride Plan
installation, its database/source directories or Credential Manager entries.

## Storage behavior

Plan schema 1.1/1.2, AppData snapshot version 4 and SQLite `user_version` are
independent version numbers. Reading a historical draft does not migrate it.
New 1.1 intake retains the current 1.1 validator. Recovery/reopen selects only
recognized historical fingerprints and replays the matching validator, requiring
the exact original diagnostics. No record, fingerprint, source or recovery file
is upgraded or reserialized in place.

Existing draft storage remains SQLite version 3 until saving/recovering 1.2
requires version 4. The existing one-draft slot still rejects a different draft;
there is no replacement, deletion or activation workflow. Migration tests call
the preparation boundary directly to cover databases containing a 1.1 draft.
A new 1.2 save may prepare storage before later reporting an existing-slot conflict.

Before a writable migration connection opens, native code makes a unique SQLite
`VACUUM INTO` copy under `t081-safety/before-v4-<UUID>.sqlite` beside the database.
It flushes the copy, reopens it read-only, checks integrity and foreign keys, and
compares the complete schema/data inventory. It rechecks the original inventory
and version under `BEGIN IMMEDIATE` before modification. Only the validation
table constraints change, with all existing rows copied exactly. The table change
and SQLite version are committed together. Source bytes remain in their immutable
content store; active snapshot and other tables are unchanged. Earlier initial
1.1 storage creation still uses the existing `t05-safety` mechanism.

A copy failure prevents migration. A transaction failure rolls back the table and
version changes. The verified copy is retained. Restart/retry must see either the
old supported schema or the complete new schema. Source publication occurs after
migration; its existing orphan/retry behavior is unchanged. No automatic database
downgrade or destructive restore command is added.

## Recovering with an older application

Older builds may reject SQLite version 4. Use the pre-migration safety copy rather
than editing version numbers or database constraints. Restoring that copy returns
the database to its earlier contents: subsequent settings/history/draft changes
will be absent. Preserve the newer profile before proceeding.

1. Close every process using the **isolated test profile**. Identify its database,
   any `-wal`, `-shm` or `-journal` companions, and immutable `plan-sources` folder.
   Do not use the normal installed profile. Do not copy over an open database.
2. Retain a separate complete copy of the migrated test profile, including its
   database, journal companions, original sources and safety directory. Keep it
   available to reopen with a compatible newer build. Also export draft recovery
   with that build where available; older builds cannot read a 1.2 recovery file.
3. Choose a verified `before-v4-*.sqlite` copy from before the migration. In a
   **new isolated recovery profile**, copy it as `stride-plan.db`. Keep journal
   companions from the migrated database out of this new profile. Copy the
   retained immutable source folder to the corresponding isolated source path;
   database-only backups do not embed those original JSON bytes.
4. Reopen the copy using the matching older test build. Confirm the earlier
   settings/history, original 1.1 draft, bytes and validation report. The older
   build must also recognize that draft's historical fingerprint (for example,
   a pre-PR16 draft should use the corresponding pre-PR16 build). Never substitute
   a fingerprint or rewrite a recovery record to force older-build acceptance.
5. Keep the migrated profile until recovery is accepted. To retain subsequent
   changes, reopen it with the newer compatible build; no automatic merge or
   downgrade of those changes is provided.

Automated SQLite tests exercise restore into a separate synthetic database,
assert exact old DDL/version/rows and source preservation, retain the newer
copy, and demonstrate that a post-backup edit is absent from the restored copy.
They also kill a worker with the entire migration uncommitted and verify rollback
on reopen. These tests do not establish packaged/native orchestration acceptance.

## Windows acceptance steps

Use a separately identified test executable/profile, isolated app data and an
isolated credential target, as in the earlier T07 acceptance approach. An ordinary
`tauri dev` launch uses the normal identifier and is **not** an acceptance shortcut.
No isolated installer has been produced or approved by this local task.

1. Run `pnpm verify` and `cargo test --manifest-path src-tauri/Cargo.toml --locked
-- --test-threads=1` on an environment permitting the native build. Review the
   precise local verification record in DESIGN.md. Build an isolated installer
   before interactive acceptance; do not launch the ordinary product identifier.
2. In separate test profiles, seed recognized pre-PR16 and PR16 synthetic 1.1
   drafts/recovery files. Reopen, export and recover each. Compare every record,
   fingerprint, validation report and source byte. Reject an altered fingerprint
   or altered/rehashed report; the existing draft must remain accessible.
3. Import each committed `valid-1.2-{40,55,65,75plus}.json`. Inspect weekly target
   and unit, fixed priority sessions, movable easy mileage and optional double.
   Review the separate policy statement/evidence and unchanged coach instructions.
   Check missing classifications, exact zero, range targets, empty/error states
   and invalid units. Saving must not activate or move any session.
4. Save/restart/reopen/export/recover 1.2 in an empty test profile. Verify exact
   BOM/CRLF/whitespace preservation with the automated byte fixture. The recovery
   envelope version and single-draft conflict protections remain unchanged.
5. Exercise native failed safety-copy and failed-migration tests, then restart and
   retry. Confirm SQLite version/rows and retained safety copy. Follow the manual
   older-build procedure above in a new synthetic recovery profile.
6. Use keyboard Tab/Shift+Tab, Enter/Space and existing tab arrow navigation.
   Confirm visible focus, native disclosure operation, disabled save in browser
   mode, validation/recovery error feedback, and 680/1133/1360 px layouts at
   relevant Windows scaling. No automatic external transmission or active-plan
   change is expected.

## Evidence limits

Automated frontend/adapter and SQLite SQL evidence is distinct from Rust-native
execution and packaged WebView2 acceptance. Record final check counts in DESIGN.md.
Coach workbook fidelity and the separate 18 malformed converted workouts are not
verified by synthetic fixtures. Owner acceptance remains pending.
