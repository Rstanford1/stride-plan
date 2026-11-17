# T07 isolated Windows acceptance installer preparation

Prepared on `codex/t07-windows-acceptance-installer` from fetched `origin/main`
`e4aa085`, separately from the uncommitted T07 implementation. No app installation
or launch, source commit, push, CI dispatch, PR or merge is authorized by this work.

The workflow intentionally refuses to build until `T07_SOURCE_SHA` is replaced
with the full SHA of the owner-approved implementation commit. A moving branch,
local working tree or placeholder must never be the source of an acceptance build.

## Isolation and verification

Uses the T06 isolation pattern: `Stride Plan T07 Test`, `com.strideplan.t07test`,
`stride-plan-t07-test.exe`, and credential target
`com.strideplan.t07test/garmin-personal-api/v1`. Application config/database live
under `%APPDATA%\com.strideplan.t07test`; local sources and default WebView data
under `%LOCALAPPDATA%\com.strideplan.t07test`. NSIS installs for the current user
under `%LOCALAPPDATA%\Stride Plan T07 Test`. Existing app identities are distinct.
Shared WebView2 installation/update is skipped; an existing runtime is required.

The source checkout is separate from the reviewed workflow/script checkout.
Installation uses the frozen lockfile with scripts disabled and immediately
rejects source/configuration changes. Frontend verification runs the same stages
as `pnpm verify` directly via Node, avoiding pnpm's pre-command auto-install and
without overriding package-manager settings. Native formatting and all synthetic
Rust tests must pass on Windows before preparation/build/publication.

Only the disposable CI checkout receives the full test config override and the
single credential-literal substitution. Production Tauri config remains unchanged.
The override disables the redundant before-build command because CI has already
built/verified the frontend. Other platform configs or external Tauri overrides
are rejected. Storage-boundary source checks, generated NSIS definitions, Windows
product metadata and compiled credential strings must agree. The final manifest
contains the full effective override and its hash, generated-installer hash,
source/workflow commits and installer/executable hashes. Only the verified copied
installer and manifest are uploaded, retained for seven days. No application or
installer executable is run; the explicitly requested Rust test binaries run in CI.

No generated installer/effective configuration has been verified yet: no reviewed
source SHA exists, and CI has not run. The gates perform those checks after explicit
approval; this preparation is not native execution or Windows acceptance evidence.
The existing local Windows Application Control blocker is not changed.

Local preparation checks passed: YAML parsing and trigger/permission/output
assertions; PowerShell parsing of the helper and all eight inline run steps;
acceptance of valid synthetic configuration/NSIS definitions and rejection of
eight unsafe installer variants plus six unsafe configuration variants. The NSIS
fixture used an existing generated T06 script with only synthetic T07 identity
definitions substituted; it was not compiled or executed. YAML/Markdown formatting
and diff whitespace checks passed. SHA-256 comparison confirmed all 20 modified/
untracked implementation files remained unchanged during this preparation.

As with T06, installation-directory checks verify the generated default and
identity-specific registry targets. They do not prevent a person manually choosing
the regular application's directory in the installer. Acceptance should retain
the distinct default test folder. No custom installer hooks were added.

## Approval sequence — no steps executed

1. Review the exact tracked/untracked T07 file list in `work/t07-guided-conversion`.
   Approve one scoped implementation commit A on `codex/t07-guided-conversion`,
   including the final privacy corrections. Exclude generated output, dependencies,
   personal data and the installer-preparation files. Record A's full SHA.
2. Replace only the workflow's `REVIEWED_T07_COMMIT_REQUIRED` placeholder with A's
   full SHA in this installer worktree. Review the resulting pin and these three
   preparation files. Approve installer-workflow commit B on
   `codex/t07-windows-acceptance-installer` with a title such as
   `Add isolated T07 Windows acceptance installer workflow`.
3. Approve pushing A's branch first, so the source commit exists on GitHub. No
   source changes need merging. Then approve pushing B's branch **and the resulting
   automatic T07 installer workflow run**. The workflow's push trigger covers its
   YAML and verification script on this branch only. Pushing B triggers that run;
   it is not a harmless publication step separate from CI approval.
4. Review the successful run's manifest before downloading/installing. A later
   manual rerun, workflow dispatch, PR, merge, installation or application launch
   needs its own authorization. GitHub may require a workflow to exist on the
   default branch before exposing manual dispatch; the branch push trigger is the
   initial-run path and requires no main merge.

There can be no truthful concrete SHA for A or B before the owner permits their
creation. Do not manufacture a commit with plumbing commands merely to obtain a pin.
