/** Owner's complete original prompt, kept intact as the production baseline. */
export const originalConversionPrompt = `# Convert My Training Plan for Stride Plan

I want you to convert my coach-provided running training plan into a JSON file compatible with **Stride Plan Training Plan Schema 1.1**.

I have provided:

1. My original training-plan document (Excel, PDF, or another format).
2. Stride Plan's authoritative \`1.1.schema.json\`.
3. An example JSON file demonstrating the required structure.

Use the provided schema as the authority for property names, required fields, allowed values, and structural relationships. Do not invent a different JSON format.

## Your responsibilities

### 1. Understand the entire source

Inspect every relevant page, worksheet, date, training week, phase, legend, footnote, and coach instruction.

Preserve:

- All training dates and week boundaries.
- Planned distances and durations, with their actual units.
- Workouts, easy runs, recovery runs, long runs, races, and explicit rest days.
- Primary sessions and linked doubles where explicitly identified.
- Core versus flexible/optional work when established by the source.
- Warmups, cooldowns, repetitions, sets, recovery intervals, rest durations, strides, and pace or effort targets.
- Hammer repetitions and progression instructions.
- Coach comments, footnotes, and special instructions.

Never silently omit a session or instruction.

### 2. Preserve the coach's original words

Copy original workout instructions into the appropriate \`coachText\` fields as faithfully as possible.

Preserve meaningful wording, numbers, punctuation, line breaks, units, and qualifications.

Structured workout data should supplement the original instructions, never replace them.

Do not rewrite or improve the coach's training prescriptions.

### 3. Never invent missing information

Do not assume:

- A blank calendar cell is a rest day.
- An unspecified recovery number means seconds or minutes.
- Every day's first run is the main run.
- Every secondary run is optional.
- All mileage counts as core mileage.
- A progression instruction authorizes changing the original prescribed values.
- Missing distances, dates, pace targets, or workout components can be filled using conventional running advice.

Use supported unspecified, partial, or unstructured representations when permitted by the schema. Record unresolved interpretation in \`reviewNotes\` with an appropriate path.

If a required field cannot be established truthfully and the schema provides no unknown representation, ask me for clarification rather than guessing merely to produce valid JSON.

### 4. Preserve structure and source evidence

Create stable, unique identifiers for the plan, version, weeks, days, sessions, and workout components.

Keep source provenance where you can establish it reliably, including original worksheet/cell references where available.

Only include a source file SHA-256 hash if you have actually calculated it from the original file. Never invent a hash or source location.

Do not mislabel a PDF as an Excel workbook or fabricate provenance to satisfy the schema. If the provided format cannot be represented faithfully, explain that limitation.

### 5. Follow JSON schema 1.1 exactly

Use \`schemaVersion: "1.1"\`.

Follow all required fields and allowed enumerations in the attached schema, including the manifest, sources, provenance, calendar, phases, weeks, pace references, progressions, and review notes.

Use valid quantities with explicit units. Keep distinct concepts such as original distance, recovery time, and pace targets separate.

Preserve unsupported broader progression instructions as coach text with appropriate review notes rather than inventing structured rules.

If you have access to a JSON Schema validator, validate your output against the supplied schema. Do not claim validation succeeded unless you actually ran it.

### 6. Verify conversion completeness

Before delivering the file, compare the converted output against the original plan.

Check that:

- Every source training date is accounted for.
- Every listed session and explicit rest day is represented.
- Weekly mileage targets match the source where explicitly provided.
- Doubles and optional sessions retain their distinctions.
- Workout repetitions, recoveries, and original instructions are preserved.
- No unsupported assumptions have been introduced.

Identify any missing, conflicting, or unreadable source content.

## Final output

Provide a downloadable UTF-8 \`.json\` file named \`stride-plan-training-plan.json\`.

Do not wrap the JSON inside Markdown or add explanatory text to the file.

In your chat response, provide a short separate conversion report stating:

- Plan title and date range.
- Number of weeks and sessions converted.
- Any unresolved source ambiguities.
- Whether actual schema validation was performed.
- Anything I should manually compare with my original document.

Do not change my training plan, provide coaching advice, or invent workouts. Your task is faithful data conversion only.`;

/** Additions reconcile the approved T07 requirements with the unchanged T01 contract.
 * No PDF workaround or new PDF conversion procedure is approved here.
 */
const legacyClarifiedPrompt = `${originalConversionPrompt}

## Stride Plan JSON 1.1 contract clarifications

- The example is synthetic and demonstrates structure only. Never copy its workout values, dates, source identities, or prescriptions into my plan.
- Read every relevant page and worksheet. Preserve meaningful whitespace, including leading/trailing spaces and line breaks, in ordered coachText string arrays at the appropriate manifest, phase, week, day, session, or workout-component level. Structured fields supplement this exact text; never replace, summarize, or improve it.
- Missing values are not zero. Omit unknown optional quantities rather than filling them with zero or null. A blank date is kind: "unspecified", with no sessions and a review note; only explicit rest is kind: "rest". Never infer missing dates. Ordered weeks must partition the inclusive calendar, with one day group per date and only first/last weeks partial.
- Same-day runs are not automatically doubles. Session role is main, double, independent, or unspecified. A double needs an explicitly established main in the same day and primarySessionId linking to it; the first session is not automatically main. Participation is required or optional, and completionClass is core or flexible. Optional must be flexible; an explicitly required double can be core. Extra/flexible mileage cannot complete missed core work. If participation/completion distinctions cannot be established, clarification is essential because there is no unknown value for those fields.
- Quantities use value plus unit OR min/max plus unit, never both. Distance units are m/km/mi and duration units s/min. Pace bounds use s/mi or s/km. Retain the actual source units; do not infer recovery units, total mileage, or missing pace targets from running convention.
- Workout structureStatus is complete, partial, or unstructured. Partial/unstructured needs an explanatory reviewNote. Unstructured has no parsed blocks. Preserve known structure as partial and all unresolved text faithfully. Do not interrupt for every ambiguity: ask only when essential information cannot be represented truthfully in a valid file.
- Use the schema's block → set → repetition nesting. One-based set/repetition indices match array order; repetition counts are represented by the arrays. Set quantity/targets are defaults; supplied repetition quantity/targets replace those defaults, and an empty targets array clears targets. Preserve warmups, cooldowns, strides, sets, repetitions, rest and recovery boundaries, pace and effort targets.
- recoveryAfter belongs to the precise repetition, set, or block boundary stated by the coach. Recovery is an interval with quantity, movement, coachText, and optional targets, or an ordered components sequence with coachText. Do not duplicate a boundary or invent final recovery. An ordered block with role: "recovery" uses afterId naming its immediate predecessor. Unknown movement can be unspecified; unknown recovery quantity/units stay in coachText in a partial/unstructured workout, not a fabricated numeric interval.
- hammerRepetitionIndices identifies existing repetitions without increasing counts or inventing faster targets. Structured progressions have scope set or repetition, workoutSessionId, ordered sequence IDs in that workout, original coachText, and only supported optional parameters. Do not execute progressions or rewrite prescribed values. Broader week/phase progressions remain exact coachText plus an unsupported reviewNote.
- Required root fields are schemaVersion, requiredFeatures, manifest, sources, provenance, calendar, phases, weeks, paceReferences, progressions, and reviewNotes. Use empty collections where allowed. No additional required features are supported: requiredFeatures is []. Do not invent properties or undocumented enum values.
- IDs are stable, document-wide unique where required, 1–128 characters matching [A-Za-z0-9][A-Za-z0-9._:-]*. Plan, version and parent-version identities are distinct. Keep IDs across corrections; do not regenerate unrelated workout identities.
- Provenance paths and reviewNotes paths use RFC 6901 JSON Pointers to existing output values; covering container mappings are supported, and coachText needs provenance. Source and location kinds must agree. File-source records require real fileName and calculated lowercase SHA-256; a required hash cannot simply be omitted to make a file valid. Stride Plan records the incoming output file's byte hash separately; do not invent a self-hash inside the output document. Never invent hashes, worksheet/cell locations, document types, or validation results. If a necessary fact cannot be represented faithfully, explain the limitation instead of fabricating a substitute.
- reviewNotes codes are ambiguous, unsupported, conflict, or missing-source-text. The first three are review warnings; missing-source-text is blocking. Do not hide missing original instructions as a harmless warning. Preserve uncertainties, conflicts and unreadable source content.
- Before delivery compare training dates, weeks/phases, every session and explicit rest day, supplied weekly mileage, core/flexible/optional/required distinctions, doubles and links, repetition counts/distances, recoveries/units, hammer/progression wording, exact original instructions, and unresolved ambiguities against the source. JSON Schema validation alone does not prove source fidelity or Stride Plan semantic validity. Report exactly what validation actually ran.
- Deliver JSON only in the downloadable UTF-8 stride-plan-training-plan.json file. Keep the short title/date-range/week/session-count/ambiguity/validation/manual-comparison report separate in chat. Do not provide training advice or change the plan.`;

/** Current downloadable artifacts and instructions both target 1.2. */
export const conversionPrompt =
  legacyClarifiedPrompt.replaceAll("1.1", "1.2") +
  `

## Version 1.2: independent mileage, scheduling and priority

- Existing JSON 1.1 files remain accepted without reinterpretation. Produce new conversions against the supplied 1.2 schema. PDF provenance remains unsupported; never invent a source type or hash.
- Week totalMileageTarget is the independently supplied weekly total, using value/unit or min/max/unit with m, km or mi. Do not calculate it from sessions, coreTarget, flexibleTarget or the manifest mileage-tier label. A 75+ tier label is not an instruction to invent a range. Omit unknown targets.
- Session schedulingPolicy is fixed-date, movable-within-week or unspecified. The original containing date and week stay unchanged. A movable policy permits redistribution only inside that original week; it never executes a move.
- Session priorityClass is priority, supporting or unspecified. Keep it independent of participation (required/optional), completionClass (core/flexible), role and runType. Never infer a priority long run merely from its title. Missing classifications remain missing or unspecified with review notes, never false, supporting, fixed, required or optional defaults.
- Preserve coachText and its provenance exactly. For each supplied known new field add interpretationEvidence with its exact JSON Pointer path. kind coach requires covering source provenance. kind user-policy requires policyId referencing an interpretationPolicies record with id, exact statement and approval user-approved. Only record approval actually supplied by the user; never manufacture it or put the user's policy into coachText. If neither basis is established, omit the classification rather than guess.
- When the user explicitly approves Option B, record that policy separately: key workouts (including designated threshold, intervals and long runs) are priority; prescribed easy mileage may be redistributed within the same week; weekly mileage and priority completion are separate; optional doubles remain optional; moving easy mileage creates no automatic missed-priority penalty; meeting mileage cannot conceal a missed priority workout. Explicitly identify the sessions covered by that approval through evidence paths. This is interpretation evidence, not a new coach instruction.
- Do not alter workout blocks, sets, repetitions, recovery parsing or prescriptions to satisfy these new fields. Previously reported 18 malformed workouts remain a separate conversion-fidelity review. Validation cannot establish fidelity to inaccessible source documents.
`;
