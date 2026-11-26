# D3 + I09 task record

## Current work

- Starting main: `2c5ef17afbd1e0bac1a5838f935ddc844cc03161`.
- Isolated branch: `codex/d3-i09-confirmed-activity`.
- Draft PR: https://github.com/Rstanford1/stride-plan/pull/32. It is a work in progress, not ready for acceptance.
- Previously accepted hosted-check revision: `b46ad9dd6fe5c62066cf468032480be4c54c060e`. Confirm the current remote head before further work.
- The paused I13 PR #27 overlaps native command registration and FIT-source storage; preserve its worktree and reconcile its changes when I13 resumes.

## Evidence and remaining work

- The hosted frontend, browser, and Windows Rust checks passed for `b46ad9d`; they do not cover subsequent changes.
- On November 25, `pnpm verify` passed on the in-progress application changes (450 tests and frontend build), and the existing Playwright suite passed all 16 tests on the same worktree.
- Hosted checks for `51285f0db8fcc1d1e61686ed83b6963a90e22f26` passed frontend and browser checks but failed native compilation in two test fixtures. The fixture corrections are present locally and require hosted native verification.
- An isolated Windows installer was built for `ca8c62c04180df303e83c5f28c34eb9413bb8fc9` and installed into initially empty D3/I09-only locations. Its installer hash matched the CI manifest, but the installed executable hash did not match the recorded build-output hash. The application was not launched. Tauri's build log reports patching the executable for NSIS; a revised CI check measures the executable extracted by the installer on a disposable hosted runner before publishing its manifest. Packaged confirmation and recovery remain pending.
- Manual confirmation, explicit legacy-duplicate review, source preservation, historical shoe attribution, and corrections have in-progress changes. Their current tests passed locally; hosted checks and packaged acceptance for these changes remain pending.
- The full local gate exposed intermittent plan-review focus assertions. The focused tests now wait for the component's existing asynchronous focus effect; the focused tests and the full gate passed after that correction.
- The isolated native transaction uses the canonical SQLite snapshot and a verified safety copy; no physical SQLite migration has been added. Packaged Windows confirmation, complete database-and-source recovery, and recovery after later edits remain unverified.
- FIT and Garmin evidence builders and native source verification exist; synthetic application-boundary tests cover FIT confirmation and explicit Garmin association. Their full F4 review interface remains outside this task; native and packaged verification remain pending. Review Later stores unconfirmed source evidence in the canonical snapshot; local tests cover reopen and later confirmation.
- Historical Garmin receipt enumeration and cross-hash provider identity handling are implemented in the current worktree; native and packaged verification are required before claiming complete duplicate protection.
- Active-plan unplanned mileage uses the plan's week calendar. Legacy-only data has no equivalent authoritative week boundary and retains its existing date-range behavior.
- Historical shoe attribution requires explicit user review; unresolved cases must not be treated as verified shoe totals. Confirm that corrections after an explicit attribution are exercised end to end.
- Run `pnpm verify`, applicable browser and native tests, hosted CI, and isolated packaged acceptance on the exact final commit. Update this record and the draft PR with results; do not merge without owner authorization.
