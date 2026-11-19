# I13 native QA proof of concept

The native QA executable uses the `qa-isolated` Rust feature and the separate
`tauri.qa.conf.json` identity. That feature excludes Garmin implementation,
credential adapter, state, commands and permission declarations at compile
time. The QA frontend identifies Garmin as unavailable. Production builds keep
the ordinary Garmin implementation and reject the QA identity.

Native tests run only on GitHub-hosted Windows. Before launching, the workflow
checks that the dedicated QA directories do not exist under the hosted runner's
actual Windows roaming and local known folders, verifies their resolved paths,
checks the QA configuration and
binary identity, checks the binary for the production credential target and
credential API imports, and tests refusal of missing or unsafe roots. The QA
executable also checks its identity and resolved Tauri storage paths before
application use. The harness creates a validated synthetic snapshot in
the fresh QA database before launch, avoiding the built-in training schedule.
These checks must all pass; compilation alone is insufficient. No real Garmin
credentials or FIT files are used. Disposable profiles are left
to the runner's lifecycle; no user directory is deleted.

The workflow uses the external official tauri-driver and a Microsoft-signed
Edge WebDriver matching the hosted WebView2 runtime. It
uses a pinned, locally tested WebdriverIO service patch to recognize both
current and older Microsoft driver version strings and Windows multi-path
output; version checks remain enabled. This patch depends on service internals
and must be reviewed on upgrade and removed when a verified upstream fix is
available. The hosted run checks that the verified driver is discoverable before
starting WebDriver. The current workflow runs only
the launch and main-window check. Navigation, Garmin command rejection, and
SQLite-backed restart tests are retained separately and deferred until launch
has passed. Logs and screenshots contain only synthetic state; failure artifacts have seven-day retention. Hosted results are
the evidence for the exact commit; no local or packaged Windows acceptance is
inferred from frontend tests.

The pinned tauri-driver version is 2.1.0; WebdriverIO packages are pinned in
the manifest and lockfile. The hosted runner's actual WebView2 version is
recorded and the matching signed driver is verified on each run. A driver-only
status check runs before compilation, without launching the application. After
the isolation gate, only a launch-only spec runs. The QA build writes fixed
startup-stage markers only inside the verified per-run temporary directory.
The runner records bounded process-name, PID, parent-PID and observed exit-code
snapshots without command lines or environment data, plus driver-only output
and a redacted, bounded tail of synthetic-only backend logs. Short-lived
processes can escape sampling; the report identifies missing evidence rather
than inferring a cause. These diagnostics do not by themselves prove that
application launch or persistence succeeded.

The branch-scoped PR trigger is temporary and remains available through code
review. After this foundation is merged, remove that trigger in a separate
follow-up PR and retain `workflow_dispatch`. The workflow does not change
branch protection. Full FIT import, upgrade, migration, and recovery automation
remain out of scope.
