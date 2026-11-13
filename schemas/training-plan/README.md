# Training-plan JSON 1.1

Status: **Testing; owner acceptance pending.** The owner approved T01 and the
contract architecture on November 13, 2026, with the refinements below. The
machine-readable authority is [1.1.schema.json](1.1.schema.json), using JSON Schema
Draft 2020-12 and `$id: urn:stride-plan:training-plan:1.1`. Cross-field rules are
enforced by `src/domain/training-plan-validation.ts`. This format is separate from
AppData snapshot versions, SQL migrations, backups and native command contracts.

## Scope and authority

One document describes an immutable original plan version. It contains no active
plan state, schedule revisions, actual results or persistence instructions. T01
does not connect the validator to the application, replace the spreadsheet reader,
access source files, or write user data. It implements the approved Section 4 and
Appendix A semantics of the owner's Phase 0 DESIGN_SPEC, with exact field names
approved in the T01 conversation. Those original Phase 0 documents remain preserved
in the owner's existing development workspace; they were not silently folded into
this branch.

## Document and identity

The required root fields are `schemaVersion: "1.1"`, `requiredFeatures`, `manifest`,
`sources`, `provenance`, `calendar`, `phases`, `weeks`, `paceReferences`,
`progressions` and `reviewNotes`. Empty optional collections use `[]`. The schema
specifies all required/optional fields and enumerations. Known optional fields are
omitted when unknown, rather than populated with null, zero or invented defaults.

IDs are case-sensitive opaque strings of 1–128 characters, matching
`[A-Za-z0-9][A-Za-z0-9._:-]*`. Entity IDs are document-wide unique. `planId` denotes
the plan, `versionId` the original version, and optional `parentVersionId` links a
prior version; external parent existence is checked by later intake. None are
derived anew from a title, date, array position or reserialization. Future adapters
must retain IDs across repeat reads and deliberately establish lineage when a
changed source creates a new version. T01 does not manufacture importer identities.

Dates are real Gregorian `YYYY-MM-DD` dates, years 0001–9999, without timezone
conversion. Week numbers begin at 1. Ordered weeks partition the inclusive plan
calendar, using `weekStartsOn` (ISO 1=Monday through 7=Sunday). Only first/last weeks
may be partial. Each date has exactly one day group, whose `id` is its stable group
identity. Sessions inherit the original date from their containing day. Phase spans
may use dates or ordered week IDs; missing boundaries remain unknown with a warning.

Manifest `mileageTier` is an optional source label, including `40`, `55`, `65` and
`75+`; it does not calculate or constrain mileage. Manifest units are display
preferences. Every actual quantity still carries its own unit.

## Day groups and completion

`training` days require sessions but **do not require a main**. Session `role` is
`main`, `double`, `independent` or `unspecified`. Independent-only groups are valid;
unknown source organization uses `unspecified` and a warning. No relationship is
inferred from row order or title. At most one explicitly designated main is allowed.
A double must link to that day's main via `primarySessionId`; other roles cannot
carry that link.

`participation` is required/optional and `completionClass` is core/flexible. Optional
always means flexible. A source-explicit required double may be core. Flexible work
cannot complete a missing core session. T01 validates these labels, not completion
metrics. Unknown participation/completion semantics must be resolved before a
producer can emit a valid session; the validator never guesses them.

Rest is a day placeholder with no sessions. Optional `restDistance` preserves only
an explicitly supplied zero distance. Unclassified dates use `unspecified`, no
sessions, and a warning; blank source cells do not become rest.

## Quantities, workouts and recovery

Quantities use either `{value, unit}` or `{min, max, unit}`, never a mixture. Units
are `m`, `km`, `mi`, `s`, `min`. Values are finite, nonnegative and at most 1e9;
ranges are ordered. Numeric strings are rejected. Pace targets use positive ordered
seconds-per-mile or seconds-per-kilometre bounds, with equal bounds for exact pace.
Effort targets preserve text; pace-reference targets link to explicit definitions.
No conversion, rounding, inferred total mileage or numeric pace resolution occurs.
Original lexical number formatting belongs in source text/provenance, not JSON
number serialization.

A workout is complete, partial or unstructured. Partial/unstructured workouts need
an explanatory review note; unstructured has no parsed blocks. A complete workout
has at least one block. This status is a producer assertion about the supplied
instructions, not proof against an inaccessible source workbook.

Exercise blocks have ordered sets and repetitions. Set/repetition indices are
one-based, contiguous and match array positions. Counts equal array lengths. A
simple warmup/cooldown can use one set and one repetition. Set quantity/targets are
defaults; a repetition's supplied quantity or target array replaces the corresponding
whole default. An explicit empty target array clears inherited targets. Validation
does not materialize inheritance or change original fields. Hammer indices refer
to existing repetitions, preserve base counts/targets, and never invent faster pace.

Recovery has two forms:

- An interval: `quantity`, `movement`, `coachText`, optional `targets`.
- A sequence: ordered `components` containing intervals, plus `coachText`. This can
  represent, for example, walking followed by jogging at a single recovery boundary.

`recoveryAfter` attaches one interval/sequence to a repetition, a set (between-set
recovery), or an entire exercise block. It occurs only at that exact boundary; it
does not repeat implicitly. Final recovery must also be explicit. Competing
attachments at the same boundary are rejected.

An explicitly ordered recovery block uses `role: "recovery"`, `afterId`, `recovery`
and `coachText`. `afterId` must name the immediately preceding block in the same
workout. Consecutive recovery blocks are allowed when explicitly ordered. A leading
recovery is unsupported, and an ordered recovery cannot duplicate the preceding
exercise block's attached trailing recovery. Unknown movement is `unspecified`
with a warning. Missing/ambiguous quantities remain original text in a partial
workout, not an incomplete fabricated recovery interval.

Nesting is intentionally block → set → repetition, with ordered recovery components.
More deeply nested patterns are preserved as text with a partial-structure warning.

## Pace and progression

Pace references are zone, race or coach definitions. Zone references require one of
easy, steady, threshold, interval or repetition. Numeric pace is optional and never
silently resolved against current athlete settings.

Structured progression is limited to `scope: "set"` or `"repetition"`, with
`workoutSessionId`, an ordered unique `sequence` of at least two IDs from that one
workout, and original `coachText`. Optional `parameters` contain signed
`quantityIncrement` and/or `paceIncrement` (`{value, unit}`, absolute value ≤1e9).
These describe each transition in the sequence. Known work quantities must match
the increment's dimension. Overlapping rules with differing parameters produce
review warnings and retain both instructions. No rules are executed; starting
targets are never invented and existing targets are never rewritten.

Broader week/phase progression remains verbatim plan/phase/week `coachText`, with an
`unsupported` review note. Structured week/phase progression is rejected in 1.1,
not silently translated into within-workout rules.

## Text, provenance and compatibility

`coachText` is an ordered array of exact strings. Empty means not supplied. Preserve
whitespace, CRLF/LF, punctuation and Unicode. A `missing-source-text` review note is
an error when expected source text is absent; ambiguity/conflict/unsupported notes
are warnings. Review notes reference existing values through RFC 6901 JSON Pointers.

Sources identify workbook/JSON files by filename and lowercase SHA-256, or explicitly
authored content. Workbook `dateSystem` may be 1900 or 1904. Hashes are assertions;
T01 does not read files or verify their bytes. The incoming document's own file hash
is recorded by later intake, outside the document, avoiding a self-hash cycle.

Provenance maps output `path` to `sourceId` and a cell, JSON Pointer or authored
location. Source/location kinds must agree. Optional workbook `rawValue`,
`formattedText` and `formula` retain source evidence without formula evaluation.
Container mappings cover descendants, with specific field/cell mappings adding
precision. Coach text requires a covering mapping. JSON source pointers have
validated syntax; their external targets cannot be verified here. Later workbook
adapters must provide precise source cells for mapped values and instructions.

Every object preserves unknown optional fields and warns. Namespaced `extensions`
are preserved and reported as uninterpreted metadata. Extensions cannot change
standard semantics. Producers must declare any required additional semantics in
root `requiredFeatures`; no extension features are supported yet. Known semantic
conflicts are errors, not silently accepted as optional metadata.

Only version 1.1 is accepted. Version 1.0, unknown minor versions and future majors
return `unsupported_version`; no authentic 1.0 mapping has been established. Unknown
required features/types/units reject the document. Existing spreadsheet import is
unchanged. Round trips preserve JSON values, unknown metadata and exact strings,
not original JSON byte formatting/property order. Duplicate JSON keys (including
escaped equivalents) reject rather than silently losing earlier values.

## Validation and reproducible types

Ajv 8.20.0 performs structural validation with strict mode and no coercion, inserted
defaults or property removal. Pure semantic checks return stable code/path/message
diagnostics with error/warning severity. Success means a structurally and semantically
valid document, possibly requiring review; it never means activation approval.
Failure returns no importable plan. The boundary has no persistence dependency.

The text parser limits input to 10 MiB; object validation limits traversal to 64
levels and 200,000 values. Objects must contain ordinary JSON data, without getters,
cycles or nonfinite values. Supplied input is never modified.

`json-schema-to-typescript` 16.0.0 generates `.generated/training-plan.d.ts` from the
schema. Generated output is ignored and not committed. The schema uses local refs
and the generator's supported structural subset; runtime rules remain authoritative
for dates, units, references, ranges and other cross-field invariants.

`pnpm types:generate` regenerates types. `pnpm types:check` compares existing output
against regeneration, checks deterministic generation, and includes a schema hash.
On a clean checkout it creates the missing output. Build, typecheck, and test commands
also generate their prerequisites explicitly, so `install --ignore-scripts` works.
`pnpm verify` starts with the consistency check. Compile-time tests check required
fields and discriminated unions alongside runtime valid/invalid fixtures.

## Workbook acceptance and verification

All committed fixtures are synthetic, including the deliberately fake workbook
filename/hash used in tests. No coach workbook, private text, FIT, database, recovery
archive or user import is committed. Actual parity is deferred to the roadmap's
workbook adapter/parity tasks, using owner-controlled local fixtures and source
hashes before/after read-only runs.

| Workbook tier | Parity status                                     |
| ------------- | ------------------------------------------------- |
| 40 MPW        | Not run; authoritative fixture unavailable to T01 |
| 55 MPW        | Not run; authoritative fixture unavailable to T01 |
| 65 MPW        | Not run; authoritative fixture unavailable to T01 |
| 75+ MPW       | Not run; authoritative fixture unavailable to T01 |

Each later parity run must compare dates, weeks/phases, rest placeholders, core and
flexible quantities, independent sessions/doubles, exact text/cell provenance,
recovery placement/units, hammer positions, progression wording and JSON round trip.
Synthetic tests cannot satisfy that acceptance gate. No 1.0 compatibility, native
persistence, browser rendering or Tauri behavior is claimed by T01.

### T01 verification record — November 13, 2026

| Check                                                   | Result                                                                                                      |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Full `pnpm verify` in the isolated worktree             | Passed: generation consistency, formatting, TypeScript, 123 tests in 13 files, production frontend build    |
| Focused contract coverage                               | 81 tests passed; existing 42 tests also passed                                                              |
| Clean source preparation                                | Fresh tracked baseline plus only the 20 T01 changed files; no node_modules or generated declarations copied |
| Clean `pnpm install --frozen-lockfile --ignore-scripts` | Passed; no install hook or existing generated type required                                                 |
| Clean-source full verification                          | Passed; declarations created by the explicit generation prerequisite                                        |
| Deliberately stale generated declarations               | Consistency check rejected them; restored declarations passed                                               |
| Source/profile safety                                   | Original development files remain unchanged; no app/profile launch, database access or migration            |
| Native packaging and workbook parity                    | Not run; outside T01 acceptance evidence                                                                    |
| Owner acceptance                                        | Pending; status remains Testing                                                                             |

Environment: Windows, Node 26.13.0, exact pinned pnpm 11.25.0 through its Node entry
point. The installed executable launcher remains blocked by Device Guard; no policy
was disabled or changed. A process-local launcher selected the same pinned Node
implementation for the actual `pnpm verify` commands. Test/build child processes
required execution permission. Neither initial launch restriction is counted as a
passing check; the subsequent complete runs above passed. Hosted CI/Node 22 has not
been executed for this branch.

The preexisting invalid nonboolean `allowBuilds.esbuild` placeholder was removed
from `pnpm-workspace.yaml`; the existing esbuild `onlyBuiltDependencies` allowlist
was retained. Dependency changes pin only Ajv and the type generator, with their
transitive dependencies; existing dependency resolutions are unchanged. The build
retains its preexisting large-chunk warning. No unrelated formatting fixes were
needed in this clean baseline; the untracked Phase 0 specification's formatting
issue remains in the preserved original workspace.
