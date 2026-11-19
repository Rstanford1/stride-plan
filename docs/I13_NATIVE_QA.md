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
output; version checks remain enabled. The hosted run checks that the verified
driver is discoverable before starting WebDriver. It
tests navigation, disabled Garmin, SQLite-backed synthetic setting persistence
across a WebDriver session restart, and rejection of a Garmin command. It runs
twice within the same disposable hosted-runner profile. Logs and screenshots contain only
synthetic state; failure artifacts have seven-day retention. Hosted results are
the evidence for the exact commit; no local or packaged Windows acceptance is
inferred from frontend tests.

The branch-scoped PR trigger is temporary and remains available through code
review. After this foundation is merged, remove that trigger in a separate
follow-up PR and retain `workflow_dispatch`. The workflow does not change
branch protection. Full FIT import, upgrade, migration, and recovery automation
remain out of scope.
