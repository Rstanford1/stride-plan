# T08.1 packaged Windows acceptance results

## Record status and scope

This is the permanent record of the completed owner-performed packaged Windows
acceptance sequence prepared by the T08.1 acceptance kit. It covers only the
isolated test application identity `com.strideplan.t081test`; it does not cover
the normal Stride Plan installation, a production release, or any personal
profile.

| Item                      | Recorded value                                        |
| ------------------------- | ----------------------------------------------------- |
| Baseline                  | `0.1.810`, `fb7ff13ce64378e7b63a7c39b6df634971029da4` |
| Upgrade                   | `0.1.811`, `ff18ad0f7d9875ae0253d2623a292ae0e465abc9` |
| Acceptance tooling        | `c5104b876991e72f76725c7dc600e9dc905f55d9`            |
| GitHub Actions run        | `44055279741`                                         |
| Test application identity | `com.strideplan.t081test`                             |

All evidence used synthetic fixtures and test-only profiles. No personal
profiles, credentials, databases, FIT files, recovery exports, or coach plans
are recorded in Git.

## Acceptance-utility verification

The acceptance utility completed successfully for the baseline-to-upgrade
sequence and the separate synthetic recovery phases. Its successful checks
included `verified: true`, `sourceBytesUnchanged: true`,
`validationRecordUnchanged: true`, `matchingSafetyCopy: true`, and
`byteIdenticalRecoveryFiles: true`.

The utility verified the following results:

- A JSON 1.1 baseline draft could be imported, saved, restarted, and reopened.
- The test installation upgraded in place from `0.1.810` to `0.1.811`.
- Writable storage migrated from SQLite database version 3 to version 4.
- The historical JSON source bytes and validation records remained unchanged.
- A matching pre-migration safety copy existed before writable migration.
- A JSON 1.2 save attempt reported the occupied draft slot without overwriting
  the existing JSON 1.1 draft.
- A JSON 1.2 draft saved and survived restart; its recovery exports were
  byte-identical before and after reopening.
- That JSON 1.2 recovery export restored into a fresh isolated test profile.
- A synthetic pre-PR16 recovery envelope imported and exported with unchanged
  historical fingerprints.

These are utility results, not claims that the utility exercised every visual
or interactive aspect of the application.

## Owner-reported application observations

The owner reported all of the following manual UI checks as passing, with no
issues reported:

1. Keyboard navigation and visible focus.
2. Warning expansion and technical-details disclosure.
3. Save As cancellation.
4. Error feedback.
5. Window resizing and layout.
6. Active-plan protection.
7. Windows display scaling at 150%.
8. Explicit presentation of unknown or unresolved training values.

These observations are owner-reported application acceptance, distinct from
the automated acceptance-utility verification above.

## Smart App Control procedural exception

Windows Smart App Control initially blocked the unsigned upgrade installer.
During host-Windows testing, it was temporarily disabled; the owner later
confirmed it was restored to **On**. This was a procedural exception to the
original Windows security requirements. Installer hash verification establishes
artifact integrity only; it does not establish trusted code signing.

Accordingly, this acceptance must not be described as fully compliant with the
original Windows security procedure. Future testing must not require weakening
host Windows security protections.

## SQLite version 4 compatibility and recovery boundary

SQLite database version is separate from both the JSON plan schema version and
the application snapshot version. In particular, a JSON 1.1 original plan can
remain byte-for-byte preserved while the application's writable SQLite storage
is migrated to version 4.

- Older application builds may reject a SQLite v4 database.
- Preparing a JSON 1.2 draft save can trigger migration even when the later
  draft-slot conflict prevents that draft from being saved.
- A verified pre-migration safety copy is created before writable migration.
- That safety copy is not an automatic downgrade and excludes changes made
  after the copy.
- Recovering with an older build requires a deliberate, isolated procedure; no
  automatic merge of later edits is supported.
- Original training plans, FIT files, drafts, and provenance must never be
  silently reinterpreted or discarded.

## Conclusion

The owner-performed T08.1 packaged acceptance sequence is complete for the
recorded synthetic test identity and versions. The Smart App Control exception
remains a documented limitation of the procedure, not an approval to relax
host security controls in future runs.
