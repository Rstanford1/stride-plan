# D3 + I09 task record

## Current work

- Starting main: `2c5ef17afbd1e0bac1a5838f935ddc844cc03161`.
- Isolated branch: `codex/d3-i09-confirmed-activity`.
- Draft PR: https://github.com/Rstanford1/stride-plan/pull/32. It is a work in progress, not ready for acceptance.
- Previously accepted hosted-check revision: `b46ad9dd6fe5c62066cf468032480be4c54c060e`. Confirm the current remote head before further work.
- The paused I13 PR #27 overlaps native command registration and FIT-source storage; preserve its worktree and reconcile its changes when I13 resumes.

## Evidence and remaining work

- The hosted frontend, browser, and Windows Rust checks passed for `b46ad9d`; they do not cover subsequent changes.
- On November 25, `pnpm verify` passed on the in-progress worktree (448 tests and frontend build), and the existing Playwright suite passed (16 tests). Additional acknowledgement-handling changes were made afterward and require verification.
- Manual confirmation, explicit legacy-duplicate review, source preservation, historical shoe attribution, and corrections have in-progress changes. Their current tests passed locally; hosted checks and packaged acceptance for these changes remain pending.
- The full local gate exposed intermittent plan-review focus assertions. The focused tests now wait for the component's existing asynchronous focus effect; the focused tests and the full gate passed after that correction.
- The isolated native transaction uses the canonical SQLite snapshot and a verified safety copy; no physical SQLite migration has been added. Packaged Windows confirmation, complete database-and-source recovery, and recovery after later edits remain unverified.
- FIT and Garmin evidence builders and native source verification exist, but their complete application workflows and all duplicate scenarios require integration and acceptance. Review Later now stores unconfirmed source evidence in the canonical snapshot; local tests cover reopen and later confirmation, while hosted native and packaged tests remain pending.
- Historical Garmin receipt files are not enumerated into a provider-ID index; cross-hash provider identity from older retrievals needs explicit verification before claiming complete duplicate protection.
- Active-plan unplanned mileage uses the plan's week calendar. Legacy-only data has no equivalent authoritative week boundary and retains its existing date-range behavior.
- Historical shoe attribution requires explicit user review; unresolved cases must not be treated as verified shoe totals. Confirm that corrections after an explicit attribution are exercised end to end.
- Run `pnpm verify`, applicable browser and native tests, hosted CI, and isolated packaged acceptance on the exact final commit. Update this record and the draft PR with results; do not merge without owner authorization.
