# Stride Plan design

## Status

This file records the observed design baseline and approved component specifications. The Today date navigation and manual run-entry workflow below were approved through iterative review and are now implemented for testing.

## Product principles

- Local-first and private: no account, cloud backend, telemetry, or social layer.
- Fast daily use: seeing the plan and recording a result should take under two minutes.
- Plan and reality stay separate: preserve original prescriptions, later plan revisions, and actual outcomes.
- Explain, do not prescribe: observations must cite records and missing data and must not diagnose or coach.
- Quiet utility: restrained presentation, limited charts, no gamification, slogans, or decorative motion.
- Accessible by default: keyboard operation, visible focus, text status labels, scalable text, and tabular chart alternatives.

## Current visual language (observed, not approved)

### Typography

- System stack: `Segoe UI Variable`, `Segoe UI`, Arial, sans-serif.
- Page titles are 30 px; major session values reach 38 px; section titles are 17–25 px.
- Eyebrows and table headings use uppercase, heavier weight, and wide tracking.
- Supporting text is commonly 11–13 px, which may be too small at some Windows scaling settings.

### Color

- Neutral warm-gray canvas, white panels, dark green sidebar, and green primary actions.
- Amber, red, and blue distinguish modified, skipped, and moved states.
- Focus uses a separate blue outline.
- Status pills include text, but progress dots and the outcome strip rely primarily on color; tables provide a text alternative in Weekly Review.

### Shape and elevation

- Panels use 9–10 px corner radii, one-pixel borders, and very light shadows.
- Controls use 5–7 px radii; badges are pill-shaped.
- Iconography is consistently sourced from Lucide.

### Spacing and layout

- Desktop shell: 248 px sidebar, collapsible to 68 px.
- Screens are centered, capped near 1220 px, and padded 34/42/60 px.
- Common gaps cluster around 9, 12, 14, 16, 20, and 27 px, but no named spacing scale exists.
- Layouts use CSS Grid for dashboard panels, metrics, activity review, settings, and trends.

### Interaction conventions

- Solid green buttons are primary; white bordered buttons are secondary; green text buttons are tertiary.
- Row actions are icon-only and depend on accessible labels and native title tooltips.
- Forms open in native `<dialog>` modals and save through a single primary action.
- Navigation shortcuts are `Alt+1` through `Alt+6`.
- A skip link, global `:focus-visible` outline, reduced-motion rule, and forced-colors adjustments are present.

## Current responsive behavior

- At 1100 px, two-column content collapses and metric grids reduce to three columns.
- At 800 px, the sidebar becomes icon-only and settings stack.
- `html` has a 940 px minimum width (680 px under the 800 px media query). This creates horizontal scrolling at constrained widths and is unlikely to satisfy comfortable 200% text scaling.
- Large plan and lap tables have no small-window alternative.

## Approved component specifications

### Date-aware Today dashboard

- The heading always begins on the literal local calendar date; it may never substitute a nearby planned session.
- Previous/next-day controls and a compact horizontal week picker allow direct navigation. A Today action returns to the literal date.
- A completed prior day shows its saved result. An incomplete prior day shows an inline prompt to add data, never a blocking pop-up.
- A date with no planned session uses an explicit empty state. Next session, imported-activity window, and reference guidance derive from current data.
- Date buttons are native keyboard controls with selected/today labels that do not rely on color alone.

### Run-entry workflow

- The focused dialog opens on FIT import because it is the expected primary path. Until decoding is implemented, the interface states that selection is only a preview and offers manual entry without claiming an import succeeded.
- Manual entry preserves the original prescription and records actual results separately. Outcomes are Completed, Modified, or Skipped; Modified requires a plain-language explanation.
- Distance and average HR are optional validated numeric values. Time may be entered as duration or average pace. Ambiguous one/two-part durations expose a compact interpretation selector; unambiguous h:mm:ss displays the same control geometry without a misleading arrow.
- RPE applies to the main session. Soreness defaults to None; location occupies stable geometry and becomes editable only when severity is above None. Sleep supports professional subjective labels or Garmin score plus duration.
- Shoe selection defaults to the current/default shoe and shows accumulated mileage. Saving adjusts mileage atomically with the journal and session revision.
- Notes grow automatically and cannot be manually resized. All field labels use the same label-to-control spacing, fixed-height widget rows do not jump as modes change, and the dialog provides a review step before saving.
- The modal title is programmatically associated; controls use native keyboard semantics and visible focus. Validation preserves valid zeroes and distinguishes missing values.

Acceptance criteria: the workflow can record completed, modified, and skipped results; accepts supported time formats and pace units; exposes conditional soreness/sleep fields without layout shift; reviews before save; persists after reload; and has pure domain plus rendered component tests.

### FIT import and Activity Review

Status: **Approved**. This specification reconciles the previously approved timeline-and-segmentation workspace with the later engineering investigation. It supersedes the unmerged activity-level timeline proposal; import batches and safety states support this interface but do not replace its selected-activity pace timeline.

#### Purpose and source-data boundary

- Activity Review is the workspace used after importing one or more FIT files to confirm how the source activities correspond to a planned session.
- Ordinary runs should be quick to confirm, while the same workspace must support workouts, warm-ups, cooldowns, strides, doubles, inaccurate lap presses, recording gaps, and shoe changes.
- Imported files, source activities, samples, and recorded laps are immutable. Corrections create review metadata, bundles, and user-defined segments without overwriting source facts.
- Source FIT files are read only. Packaged import preserves a verified untouched copy in application data before committing normalized records; the original file is never moved, renamed, overwritten, or deleted.

#### Core workflow

1. Select one or more FIT files from run entry or Data & Settings through one shared import service.
2. Decode, validate, hash, and preserve each source while reporting progress, partial success, cancellation, and recoverable failures.
3. Review each imported source activity, its suggested planned-session match, and any exact or possible duplicate result.
4. Confirm or correct the match, activity role, primary designation, and activity-level shoe.
5. Inspect the selected activity's pace timeline, optional metric overlay, recorded laps, pauses, gaps, and suggested transitions.
6. For activities that need interpretation, create or adjust meaningful segments, classifications, and segment-level shoe overrides.
7. Review the assembled session bundle, total distance/duration, journal fields that apply to the primary session, and unresolved warnings.
8. Confirm and save the coherent review atomically. Draft work must not affect plan completion, metrics, observations, or shoe mileage before confirmation.

#### Workspace layout

- A persistent top summary shows the planned session/date, unchanged original prescription, imported-file count, total distance/duration, auto-match explanation or confidence, unresolved issue count, review status, and **Confirm review** action.
- A compact imported-activity rail shows each source activity's start time, distance, duration, suggested role, match/review status, shoe, and duplicate warning. Selecting an item changes the details, timeline, and table without losing draft edits.
- The selected-activity header uses compact aligned summaries for distance, duration, average pace, average heart rate, elevation when present, source filename, start time, role, primary state, and assigned shoe. Avoid decorative dashboard cards.
- The pace timeline is the main review and editing surface. A synchronized lap/segment table sits below or beside it and is the complete non-visual alternative.
- The final bundle summary shows the planned session, every attached activity and role, primary activity, total distance/duration, shoe-mileage allocation, unresolved warnings, and journal data that applies to the main session.
- At constrained widths and 200% scaling, the summary, activity rail, selected-activity details, timeline, segment table, and bundle summary stack in reading order without requiring horizontal scrolling for core actions.

#### Timeline and metric overlays

- Pace is always the primary series. The runner may overlay heart rate, elevation, cadence, or power when available rather than replacing pace.
- Scales are independent or explicitly labeled. Color is paired with text, line style, landmarks, or patterns and is never the only way to understand a series or classification.
- Timeline landmarks distinguish recorded FIT laps, automatically generated mile/kilometre laps, user-created boundaries, pauses or gaps, selected ranges, and proposed transitions based on meaningful pace changes.
- Recorded laps are evidence, not automatic workout repetitions. Automatic transitions and segment classifications remain suggestions until the user confirms them.
- Timeline selection and table-row selection remain synchronized.

#### Segmentation

- User-defined segments may be classified as Warm-up, Work, Recovery, Cooldown, Strides, or Other.
- The runner may place a boundary, drag it precisely, remove or merge it, optionally snap it to a recorded lap/pause/visible transition, zoom for precision, select a range, classify it, and undo or redo edits.
- Segment validation prevents overlaps, invalid ordering, and unallocated recorded distance. Segment boundaries and classifications never alter source samples or recorded laps.
- Straightforward easy runs arrive with a primary easy/recovery role, default shoe, primary selection, quiet recorded-lap landmarks, and no required segmentation step.
- Workouts expose the same workspace in an expanded state with a larger timeline, differentiated work/recovery regions, boundary tools, overlays, and segment controls; they do not become a separate screen.

#### Activity roles, bundles, and shoes

- Supported activity roles are Primary easy/recovery, Primary long run, Primary workout, Warm-up, Cooldown, Strides, Supporting recovery, and Unrelated.
- Several source activities may form one planned-session bundle, but an activity belongs to at most one bundle and a confirmed bundle has exactly one primary activity when it represents session completion.
- Supporting activity mileage may contribute to actual mileage but remains secondary and cannot complete or rescue missed core work. Unrelated activities are retained for audit and excluded from completion and running metrics.
- Activity-level shoe selection defaults appropriately and shows accumulated mileage from the reusable shoe library. A user-created segment may override the activity-level shoe for its range.
- Shoe mileage changes only when the review is confirmed. Warm-up, workout, and cooldown files may use different shoes; a single continuous activity may use segment-level shoe overrides.
- RPE and general session notes apply primarily to the main session and are not repeated for every supporting activity.

#### Matching, duplicates, and import safety

- SHA-256 of original bytes identifies exact duplicates. An exact duplicate creates no second activity or source copy and explains the prior import it matches.
- A versioned deterministic comparison of the strongest shared facts—device identity, session start, normalized timer duration, and distance—may flag a possible duplicate. It is a warning requiring **Exclude new file** or **Import anyway**, never an automatic rejection.
- Plan-match suggestions consider explicit activity local date, planned/recorded distance, directly observable sport or segment structure, and whether another confirmed primary owns the session. Suggestions include plain-language evidence, remain editable, and leave exact ties unresolved.
- Import batches record decoded, failed, cancelled, exact-duplicate, possible-duplicate, excluded, and unresolved sources. Status text uses **New**, **Needs attention**, **Ready**, and **Reviewed**.
- Missing optional FIT fields produce omissions or warnings rather than failed decoding. Non-FIT, corrupt/truncated, failed-integrity, unsupported, and ambiguous multi-session sources return typed user-readable errors.
- Browser development may exercise decoding/review but must label durable preservation unavailable. Packaged preservation uses content-addressed app-data storage and never claims success until the copied bytes are verified.

#### Validation and confirmation

- Confirmation explains and blocks duplicate decisions that remain unresolved, multiple or missing primaries, missing roles, required shoes not assigned, overlapping/invalid/unallocated segments, implausible-date matches, incoherent bundle associations, and material differences from the original prescription.
- Warnings are review prompts, not diagnoses, coaching, or automatic plan changes.
- Draft edits persist without affecting confirmed activity decisions or downstream calculations. Confirmation stores source links, match/role/bundle decisions, segments, shoe allocations, review status, and the allowed session-completion transition atomically and idempotently.
- A reviewed import reopens read only. **Revise review** creates a new draft from the latest confirmed decisions; reconfirming appends revision history and never rewrites source facts or prior revisions.
- Persistence or preservation failures preserve the review draft, explain what was not saved, and offer a safe retry without creating duplicate mileage, activities, bundles, or completion changes.

#### Accessibility and responsive behavior

- The entire workflow supports keyboard navigation, visible focus, programmatic labels, non-color status/classification text, and 200% text scaling.
- Every timeline operation has a keyboard and synchronized-table equivalent, including selecting ranges/boundaries, adjusting boundaries, classifying segments, and undo/redo.
- Progress and save results use polite announcements; blocking validation uses an alert and moves or links focus to the relevant activity, segment, or control without repeatedly stealing focus.
- Source laps and user-created segments remain distinguishable in both the graph and table. The table includes number, start/end time, distance, duration, average pace, average HR, classification, and shoe assignment when applicable.

Acceptance criteria: generated or redistributable fixtures cover decoding and error cases without personal data; pure tests cover time conversion, duplicates, match explanations, bundle invariants, segmentation, shoe allocation, and completion boundaries; repository tests cover schema upgrades, backup/restore, ordered saves, rollback, retry, preservation, and idempotency; rendered tests cover easy/workout states, multiple files, timeline/table synchronization, keyboard boundary editing, duplicates, bundles, shoes, validation, confirmation, failures, reload, reopening, constrained windows, and 200% scaling. Until implementation, verification, and user acceptance are recorded, the component remains **Design approved**, not Complete.

## Audit evidence

- Code inspected: all React screens/components, state and repositories, domain rules, tests, CSS, Tauri shell, capabilities, and migration.
- Rendered inspection: all six screens plus the historical run-entry dialog at the local browser-development viewport.
- Verified checks: formatting, TypeScript, 17 automated tests, and production build.
- Not visually verified: populated Activity Review, import validation preview, triggered observation details, native Tauri/SQLite behavior, Windows installer, 200% Windows scaling, and forced-colors rendering.
