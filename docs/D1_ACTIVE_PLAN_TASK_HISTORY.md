# D1 active plan task history

- Started from `origin/main` `15465e7845948bbd7652083a3c7152f088f1237f` after checking open PRs and worktrees. F2 Stage 1 is present. The root design worktree, stopped D1 worktree, and I13 PR #27/worktree were left untouched.
- Audited the existing JSON validators, v4 snapshot, SQLite draft/version guards, restore/reset/save routes, scheduling consumers, and committed fixtures. The four authentic complete 13-week coach conversions are unavailable, so they remain unverified.
- Implemented a v5 schedule snapshot and one append-only SQLite activation-record table. `app_state` remains the editable schedule. Activation preserves exact source bytes, source-to-schedule IDs, retired identities, old results and activity links, and only imports dates from today onward. A verified SQLite copy precedes the atomic migration and activation transaction.
- Added source-aware movement, exact/ranged/unknown mileage, a read-only projection, and a small activation entry point in Training. Missing or ambiguous active scheduling semantics block activation.
- Fixed a packaging gap during review: the three new native commands needed entries in the Tauri permission manifest and default capability.
- An actual archived older-build probe rejected a synthetic v5 database as unsupported. The isolated probe was removed afterward so it could not be collected by the current test suite.
- `pnpm verify` passed before the final permission and source-day filtering changes: 32 test files, 383 tests, typecheck, formatting, and production build. `cargo check --locked` passed after the permission change. Rust unit tests passed earlier in this task; the latest local Rust test executable was blocked by Windows Application Control (error 4551), even with elevated execution. CI must run that latest revision.
- No normal installed profile or personal data was used. All migration and recovery tests used synthetic isolated profiles.
