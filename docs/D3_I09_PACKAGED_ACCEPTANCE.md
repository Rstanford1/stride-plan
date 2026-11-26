# D3 + I09 packaged acceptance

This procedure is pending until the exact PR revision can be run under the
Windows test environment's existing security policy. Do not use the normal
Stride Plan installation or profile. Use only the verified package named
**Stride Plan D3 I09 Acceptance**, with application identifier
`com.strideplan.d3i09test` and the matching CI manifest and hashes.

The acceptance operator verifies the installation, executable hash, separate
test data and credential locations, and that the test profile is fresh before
launch. All activities and files used below must be synthetic. If any identity,
path, process state or security check is uncertain, stop.

1. In the isolated app, use a planned demo run and enter a synthetic manual
   result of 4.5 miles in 42:21. Review and confirm it. Expect the completed
   result to appear once, with 4.5 miles credited once.
2. Close and reopen the test app. Expect the same completed run, mileage and
   notes. The acceptance operator captures and verifies its persisted receipt,
   revision and confirmation timestamp in the closed test profile.
3. Update the same entry's note with `synthetic correction` and save it. Close
   the app. Expect the result to remain credited once; the operator verifies
   that the revision and correction history changed while the original
   confirmation event and timestamp did not.
4. With the test app closed, the operator creates and integrity-checks a
   complete SQLite safety copy, plus copies and hashes of every associated
   synthetic source file. Keep the database and source files together. No JSON
   export alone constitutes complete recovery.
5. Reopen the test app, make a second identifiable synthetic note correction,
   and close it. The operator preserves this later state before replacing only
   the isolated test profile with the verified safety copy and associated source
   files. Never replace a database while the test app is running.
6. Reopen the isolated app. Expect the first correction, original confirmation
   time, completed run and single mileage credit to be restored; the later note
   must be absent. The operator verifies database integrity, receipt, revision,
   and original source hashes after recovery.

Record the exact revision, package and executable hashes, test environment,
each observed result, and any limitation. A synthetic manual run alone does not
prove FIT or Garmin source recovery; exercise and verify each applicable source
separately before claiming it passed. Local browser or unit tests are not a
substitute for packaged confirmation and restart.
