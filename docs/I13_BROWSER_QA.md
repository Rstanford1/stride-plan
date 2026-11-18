# I13 browser QA evidence

Source baseline: `0502d8e` (merged I12). Scope: browser-only Phase 0 and 1.
The suite exercises the existing JSON 1.1 and 1.2 synthetic contract fixtures;
it does not change the contract. Browser preview cannot save a native draft or
preserve original FIT bytes. Invalid FIT input is synthetic. System appearance
is supported; there is no user-facing theme selector.

Playwright launches its own ephemeral Chromium context per test, never an
installed browser profile. The server uses a dedicated loopback port, refuses
an existing server, and the test guard checks the origin, fresh storage, and
absence of Tauri. Every browser request outside that origin is blocked,
including Garmin. The application selects browser localStorage in this mode;
native SQLite and credentials are not accessed. Failure artifacts contain only
the seeded demonstration state and synthetic fixture data. Do not add real
files, credentials, or personal data to this suite. Console contents are not
recorded separately; runtime errors are reported without their potentially
sensitive details. Traces and screenshots may contain page content, so use
only this isolated environment.

Reproduce with `pnpm install --frozen-lockfile --ignore-scripts`,
`pnpm exec playwright install --only-shell chromium`, and `pnpm test:e2e`.
The workflow summary records tested commit and OS; the runner provides the
actual job duration and Playwright reports the browser version. Failure
artifacts expire after seven days. The workflow is independent of existing
checks; branch protection is unchanged.

Future native QA needs a distinct application identifier, data directory,
database, credential namespace, and source-file store, with explicit startup
checks that reject the production identity. It should exercise packaged Windows
startup, SQLite migration/persistence, draft save/reopen, FIT preservation,
native dialogs and recovery using disposable synthetic data. No native build or
packaged Windows acceptance is claimed here.
