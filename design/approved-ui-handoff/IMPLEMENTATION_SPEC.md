# Stride Plan approved UI implementation specification

## 1. Authority and precedence

This document is an implementation-grade handoff of the UI approved through iterative design review. It exists because the current implementation preserves much of the intended functionality but does not consistently resemble or behave like the approved designs.

Use the following precedence:

1. Explicit requirements in this document.
2. Canonical interactive HTML references in `reference/`.
3. Existing approved domain rules in `DESIGN.md`.
4. Current application behavior only when it does not conflict with the above.

The current UI is not a visual reference. Preserve its working import, persistence, duplicate, matching, segment, shoe-allocation, and confirmation logic, but restructure the presentation to match this specification.

## 2. Shared product and visual language

### 2.1 Product boundaries

- Windows-only and local-first.
- No account, cloud backend, telemetry, social layer, gamification, or AI coaching.
- Never diagnose injury, prescribe treatment, prescribe training, or rewrite the plan automatically.
- Preserve original prescriptions separately from plan revisions and actual outcomes.
- Keep imported FIT files, normalized samples, and recorded source laps immutable.
- Flexible and unplanned mileage may increase actual mileage but never compensates for a missed core session.

### 2.2 Global appearance

Use the existing Stride Plan shell and restrained utility aesthetic:

- Font: `Segoe UI Variable`, `Segoe UI`, then system sans-serif.
- Page background: warm light gray `#f4f6f3`.
- Primary panel: white `#ffffff`.
- Secondary/quiet panel: `#edf2ed`.
- Main text: `#19201a`.
- Muted text: `#69716a`.
- Border: `#d9dfd9`.
- Primary green: `#245f3e`; soft green: `#e5f2e8`.
- Informational blue: `#3b6687`; soft blue: `#e6eff6`.
- Workout/modified amber: `#8a5d22`; soft amber: `#f7eddc`.
- Skipped/error red: `#8b403d`; soft red: `#f6e8e7`.
- Long-run purple: use a muted accessible purple and soft purple surface. Purple is reserved for long-run identity in the weekly schedule.
- Main panels use 9–10 px radii, one-pixel borders, and very subtle shadows.
- Form controls use 6–7 px radii.
- Main page headings are approximately 24–30 px; section headings approximately 15–17 px; body copy approximately 13–14 px. Do not reproduce the tiny mockup text literally where it would violate accessibility.
- Use color only as a supplement. Every status, role, segment type, and warning must have a text label or icon/shape distinction.
- Avoid gradients, decorative motion, motivational slogans, excessive cards, and dense dashboard chrome.

### 2.3 Interaction standards

- One clear primary action per action group.
- Visible focus on every interactive control.
- Native buttons, inputs, selects, tables, and dialog semantics.
- All pointer interactions have keyboard equivalents.
- Controls that change data expose saving, saved, error, and retry states.
- Autosave drafts locally, but make final confirmation explicit.
- Support 200% Windows text scaling without clipped controls or horizontal page scrolling.
- Tables that cannot reflow use a focused horizontal table wrapper and retain keyboard access.

---

# 3. Log workout — Import FIT

Canonical reference: `reference/log-workout-fit.html`, variant **Import FIT**.

## 3.1 Purpose

This is the focused dialog opened from a planned day’s **Log workout** action. FIT import is the default because it is the normal path. Manual entry remains the adjacent secondary tab.

This dialog performs file selection, decoding feedback, safe duplicate screening, provisional role assignment, and handoff into Activity Review. It does not finalize weekly totals.

## 3.2 Dialog shell

Desktop target:

- Centered modal, approximately 780 px wide.
- Maximum height fits the application window; the body scrolls while header, tabs, and footer remain stable.
- Background uses the application warm-gray surface.
- Border radius approximately 14 px and restrained shadow.
- Close button in the upper-right with accessible name `Close log workout`.
- Escape closes only after confirming if files have been decoded or decisions changed.
- Initial focus goes to **Choose FIT files**.
- On close, focus returns to the triggering **Log workout** button.

Header content, in order:

1. Selected day/date, e.g. `Saturday, November 7`.
2. Heading: `Log workout`.
3. One-line planned-session summary, e.g. `Planned: 5 × 1 km workout + linked easy double`.

The date and planned session come from the selected Today/Plan date, not always the literal current date.

## 3.3 Entry-method tabs

Directly beneath the header:

- `Import FIT files` — selected by default.
- `Enter manually`.

Use proper `tablist`, `tab`, and `tabpanel` semantics with arrow-key navigation. The active tab uses green text and a two-pixel bottom rule, not a filled pill.

Switching tabs must preserve unsaved values in each tab for the life of the dialog. If decoded FIT files exist, switching to manual entry warns that the files will remain in the draft but will not be confirmed by the manual result.

## 3.4 Empty FIT state

The first body element is a full-width dashed drop target:

- Primary label: `Choose FIT files`.
- Secondary action/copy: `or drop several files here`.
- Help text: `Warm-up, workout, cooldown, strides, and doubles can be reviewed together.`
- Accept one or many `.fit` files.
- Support both file picker and drag/drop.
- Do not force one file at a time.

While files are decoding, replace the empty center with progress but keep the dialog stable. Announce progress through `aria-live="polite"` without announcing every decoded record.

## 3.5 Selected-file area

After selection, retain the drop target in a compact form or place the file section immediately below it. The selected-file section begins with:

- Heading: `{N} files selected`.
- Supporting copy: `Source files and source laps remain read-only.`
- Right-aligned `+ Add files` action.

Each source file is a quiet horizontal row, not a large card. Desktop grid:

1. 25–28 px status marker.
2. Flexible filename and metadata column.
3. Approximately 178 px provisional-role select.
4. Remove button.

Row content:

- Filename as the strongest line.
- Start time, distance, duration, and lap count as secondary metadata.
- Label `Proposed role` above or beside a select.
- Remove action with an accessible filename-specific label.

Example rows:

- `morning-warmup.fit` — `7:04 AM · 1.12 mi · 10:06` — proposed `Warm-up`.
- `track-workout.fit` — `7:18 AM · 5.38 mi · 43:42 · 9 laps` — proposed `Primary workout`.
- `cooldown.fit` — `8:04 AM · 0.84 mi · 8:11` — proposed `Cooldown`.

Provisional roles:

- Primary easy/recovery
- Primary long run
- Primary workout
- Warm-up
- Cooldown
- Strides
- Supporting recovery
- Unrelated

The role is a reversible suggestion. Activity Review remains the authoritative confirmation step.

## 3.6 File-status vocabulary

Every file row shows one of these non-color-only states:

- Queued
- Decoding
- Ready
- Exact duplicate
- Possible duplicate
- Failed
- Canceled

Exact duplicate:

- Explain that the byte-identical source was already imported.
- Default to excluding it.
- Offer `Open existing activity`, not a second import.

Possible duplicate:

- Explain the matching evidence: start time, duration, distance, device identity, or overlap.
- Do not silently exclude or merge.
- Carry the decision into Activity Review.

Failure:

- Keep successful files.
- Show the filename and readable reason.
- Allow `Retry file` and `Remove`.
- Never roll back unrelated successful decodes.

## 3.7 Duplicate summary

Below the rows, use one compact summary band. Successful example:

- Left: `Duplicate check complete`.
- Right: `No previously imported activities found`.

Warning variants must state exact and possible duplicate counts and provide a direct review action. Do not use a generic success-green box for errors.

## 3.8 Activity Review handoff preview

Below duplicate status, show a bordered explanation block:

- Heading: `Next: Activity Review`.
- Copy: `Confirm matching, primary activity, roles, laps, logical segments, overlays, and shoes before weekly totals change.`

This block is required. It sets the expectation that file selection is not final import confirmation.

## 3.9 Footer

Stable footer:

- Left status: `FIT import is the default entry method` or current save/error status.
- Right actions: `Cancel` and primary `Continue to Activity Review`.

Primary action behavior:

1. Validate that at least one nonfailed, non-excluded file is ready.
2. Create or update one import batch and one Activity Review draft.
3. Preserve verified source bytes in the packaged app before records can be confirmed.
4. Navigate directly to Activity Review with the first unresolved source selected.
5. Do not update final session outcome, weekly mileage, or shoe mileage yet.

## 3.10 Required differences from the current implementation

- Do not show only a large sparse file-picker placeholder.
- Decode and display each selected file inside the dialog.
- Show provisional roles, duplicate results, and per-file status before continuing.
- Use `Continue to Activity Review`, not a generic completion action.
- Keep the dialog visually dense and efficient; selected files should be readable without large empty gaps.

## 3.11 Responsive behavior

Under approximately 650 px:

- File row becomes status + filename + remove on the first row and role select on a second row.
- Header and footer actions wrap without clipping.
- Footer buttons may share the full width.
- Modal stays within the viewport and uses vertical body scrolling.
- Do not reduce essential type below accessible size.

## 3.12 Acceptance tests

- Opens on FIT tab from Today and historical Plan dates.
- Chooses and drag/drops multiple files.
- Displays decoding progress and partial success.
- Shows filename, time, distance, duration, laps, proposed role, and status per file.
- Adds and removes files without losing other rows.
- Detects byte-identical duplicates deterministically.
- Carries possible duplicates into review without silently merging.
- Preserves sources before confirmation in packaged mode.
- Continue creates an idempotent draft and opens the correct review batch.
- Cancel and close protect meaningful unsaved work.
- Weekly totals and shoe mileage are unchanged before final Activity Review confirmation.
- Tab order, Escape behavior, focus return, and screen-reader announcements are verified.

---

# 4. Timeline-focused Activity Review

Canonical reference: `reference/activity-review-timeline.html`, variant **Timeline focus**.

## 4.1 Nonnegotiable visual model

Activity Review is a dedicated full workspace, not a modal and not a long generic form.

For the selected activity, the pace timeline is visible immediately on opening the workspace. It is the dominant visual. It must not be hidden behind `Show details`, an accordion, a disclosure panel, or a stack of issue cards.

Desktop hierarchy:

1. Compact top bar.
2. Horizontal imported-file rail.
3. Two-column main workbench:
   - Flexible timeline/editor area.
   - Persistent approximately 258 px right inspector.
4. Stable review footer.

The current issue-first/vertical-source-rail layout is not the visual target. Issues remain supported, but they appear contextually without displacing the primary timeline workspace.

## 4.2 Top bar

Left group:

- Back action: `← Today` or the actual origin screen.
- Heading: `Review Saturday’s activity`.
- Planned-session subtitle: `Easy + strides · November 7`.

Right group:

- Text progress: e.g. `2 of 3 files reviewed`.
- Thin progress track beneath it.

The progress represents reviewed source files, not arbitrary wizard steps.

## 4.3 Horizontal source-file rail

Immediately below the header, show all imported sources horizontally as compact selectable widgets.

Each source widget includes:

- Status marker: checkmark or numbered pending position.
- User-facing role/title: Warm-up, Main activity, Cooldown, etc.
- Distance and duration.
- Current shoe and accumulated mileage.

Example:

- Warm-up — `1.12 mi · 10:06` — `Ghost 16 · 312.7 mi` — reviewed.
- Main activity — `5.38 mi · 43:42` — `Vaporfly 3 · 86.4 mi` — selected.
- Cooldown — `0.84 mi · 8:11` — `Ghost 16 · 312.7 mi` — pending.

Final rail action: `+ Add FIT files`.

Selected state uses border plus soft background. Reviewed state uses a checkmark. Pending state retains its number. Do not communicate state only through color.

If many files exist, wrap the rail or allow contained horizontal movement while keeping all keyboard reachable. Do not convert the primary desktop design to a permanent left sidebar.

## 4.4 Workbench header

Left:

- Selected activity title, e.g. `Main activity`.
- Source boundary copy: `Source file is read-only · Changes create a reviewed interpretation`.

Right, aligned on the same row:

- Activity-level shoe picker labeled `Shoes`.
- The selected/default shoe appears automatically.
- Each option includes current mileage.
- `+ Add shoes` is available.
- Overlay toggle/control. The approved default is `Pace + HR`; alternate `Pace only`. The production control may expand to Heart rate, Elevation, Cadence, or Power, but it must overlay the selected series on pace rather than replace pace.

## 4.5 Pace timeline

Desktop target height: approximately 300 px including axes and legend.

Required chart content:

- Pace is always the primary line.
- Default smoothing: approximately ten seconds; state the smoothing in the legend.
- Left pace axis labeled in the active pace unit.
- Bottom elapsed-time axis from `0:00` to source duration.
- Selected overlay line and optional subtle area, with its own clear scale or readable tooltip.
- Neutral horizontal grid lines.
- Recorded automatic laps as thin dashed neutral vertical lines.
- User-defined segment boundaries as stronger amber handles/lines.
- Suggested transitions as suggestions, visually distinct from confirmed boundaries.
- Pauses and recording gaps when present.

Legend order:

1. Pace and smoothing.
2. Selected overlay.
3. Automatic/source lap marker.
4. Confirmed/suggested boundary marker if visible.

Automatic mile/kilometer laps are reference landmarks only. They do not automatically create workout repetitions or user segments.

## 4.6 Timeline navigation and editing

Required interactions:

- Click timeline to place/select a cursor.
- `Split at cursor` creates a boundary if valid.
- Drag a confirmed boundary horizontally to refine it.
- Keyboard-equivalent boundary movement in sensible increments.
- Zoom into a range and reset zoom.
- Pan when zoomed.
- Select a timeline segment by clicking its range or the segment strip.
- `Merge with previous` or adjacent segment.
- Undo and redo all interpretation edits.
- Optional snap to source lap, pause, or suggested transition; snapping never changes source facts.

Boundary rules:

- Boundaries must be ordered and nonoverlapping.
- No zero-length segments.
- Segments cover the reviewed activity duration continuously unless a recorded gap is explicitly represented.
- Moving a boundary updates both adjacent segments atomically.
- Undo/redo restores boundaries, labels, and segment shoe overrides.

## 4.7 Segment strip

Immediately below the chart, show a proportional horizontal strip whose widths correspond to segment duration.

Each segment shows:

- Label.
- Elapsed start/end.
- Distance.
- Selected state with an outline plus text, not color alone.

Example:

- Easy running — `0:00–31:34 · 3.82 mi` — 72% width.
- Strides × 6 — `31:34–43:42 · 1.56 mi` — 28% width.

Segment identity colors are subtle:

- Easy/recovery: soft green or blue.
- Work/strides: soft amber.
- Warm-up/cooldown/other: neutral with explicit labels.

## 4.8 Editor action row

Directly under the segment strip:

- `Split at cursor`
- `Merge with previous`
- `Undo`
- `Redo` when applicable
- Right-aligned suggestion explanation, e.g. `Suggested boundary at 31:34 · pace changed sharply`.

The reason must be deterministic and concise. Do not claim automatic workout recognition.

## 4.9 Source laps

Source laps appear as a compact collapsed table/section beneath the action row:

- Heading: `Source laps`.
- Copy: `Reference only; automatic laps do not create segments.`
- Toggle: `Show {N} laps`.

Expanded table fields:

- Lap number
- Start/end elapsed time
- Distance
- Duration
- Average pace
- Average HR
- Original source-lap identity

The table is also an accessible exact-data alternative for source lap landmarks.

## 4.10 Persistent right inspector

The right inspector is synchronized with the selected segment and remains visible on desktop.

Top:

- Number/status marker.
- Selected segment title.
- `Selected segment` subtitle.

Segment controls:

- Segment label select: Work, Recovery, Warm-up, Cooldown, Strides, Easy, Other.
- Read-only start and end values.
- Segment statistics: distance, average pace, average HR, and available optional metrics.

Activity controls:

- Heading `Activity role`.
- Role select.
- Primary-activity radio/control.
- Explanation: `The primary activity receives the session’s RPE and outcome. Supporting files still count toward actual mileage.`

Shoe controls:

- Heading `Shoes inside this activity`.
- `Shoes for selected segment` dropdown.
- Default selection inherits the activity-level shoe.
- Options show accumulated mileage.
- Explanation: `Starts with the main activity’s shoe selected. Change it only when this segment used a different pair.`

A segment-level shoe assignment overrides the activity shoe only for that interval. Mileage allocation uses segment distance and is committed only at final confirmation.

## 4.11 Activity roles and bundles

Supported roles:

- Primary easy/recovery
- Primary long run
- Primary workout
- Warm-up
- Cooldown
- Strides
- Supporting recovery
- Unrelated

Rules:

- One activity is normally primary per planned-session bundle.
- Warm-up, cooldown, strides, supporting runs, and linked doubles remain separate immutable source activities.
- Supporting activity mileage counts toward actual mileage.
- RPE and main outcome attach primarily to the primary activity/session.
- Unplanned activities count as actual mileage but do not affect core completion unless explicitly attached as a replacement.
- `Unrelated` removes the activity from the selected session bundle without deleting it.

## 4.12 Easy run versus workout disclosure

The workspace is the same for easy runs and workouts.

Straightforward easy run:

- Timeline still appears immediately.
- A single whole-activity segment may be preselected.
- Role, primary designation, match, and shoe are already proposed.
- No forced segmentation.
- If there are no warnings, confirmation can be completed quickly.

Structured workout:

- Same layout, with visible multiple segments and stronger editing affordances.
- Work and recovery ranges are visually differentiated.
- Suggested transitions may be shown with explanations.
- Warm-up/cooldown may be separate files or segments.
- User can correct late/early/missed lap presses visually using pace changes.

Never create one segment per recorded lap automatically.

## 4.13 Matching and duplicate issues

The proposed planned-session match and evidence remain available without replacing the timeline. Use a compact contextual banner or inspector section when attention is required.

Show:

- Proposed planned session.
- Confidence label.
- Evidence such as date/time proximity, expected type, distance, and bundle context.
- `Change match` action.

Possible duplicates require an explicit decision:

- Same activity
- Separate activity
- Leave unresolved

Exact duplicates cannot be reconfirmed as new sources.

## 4.14 Footer and draft behavior

Stable footer:

- Left: `Discard draft`.
- Middle: `Draft saved locally`, `Saving…`, or a precise error with retry.
- Right: `Next file` and primary `Confirm all {N} activities`.

Drafts autosave after meaningful decisions. Save failures keep edits in memory and expose `Retry`; they do not falsely show saved.

`Next file` moves to the next unresolved source. It does not finalize the bundle.

## 4.15 Final confirmation

Before confirmation, show or make immediately available a bundle summary containing:

- Planned session and original prescription.
- Every attached source activity.
- Each activity’s role.
- Primary activity.
- Total bundle distance and duration.
- Segment classifications where used.
- Activity and segment shoe allocations.
- Journal data applied to the main session.
- Exact unresolved warnings.

Block confirmation for:

- No primary activity when one is required.
- More than one primary activity in the same bundle.
- Missing required role.
- Unresolved possible duplicate.
- Invalid/overlapping/zero-length segments.
- Unallocated timeline ranges.
- Missing shoe when shoe tracking requires it.
- Source preservation failure in packaged mode.

Warnings such as meaningful plan divergence may require acknowledgement but must not diagnose or prescribe.

Confirmation is atomic and idempotent:

- Confirm review decisions.
- Attach activities to the planned session.
- Update actual mileage and run days.
- Allocate shoe mileage.
- Set the appropriate completed/modified/replacement outcome.
- Preserve original prescription and source data.
- Save a revision snapshot.

Reopening a confirmed review is read-only by default. `Revise review` creates traceable new review decisions rather than mutating history invisibly.

## 4.16 Required differences from the current implementation

- Timeline is visible by default; remove the need to open a source-details disclosure.
- Source files use a horizontal top rail on desktop, not a permanent left rail.
- The timeline/editor is the largest area on the screen.
- Selected segment editing lives in one persistent right inspector, not a long stack of repeated segment cards.
- Issue summaries are contextual and compact; they must not push the timeline below the fold.
- Shoes are visible in source widgets and in the workbench header, with segment overrides in the inspector.
- Keep existing robust domain behavior, but remap it into this spatial model.

## 4.17 Responsive behavior

At approximately 800 px:

- Main workbench becomes one column.
- Inspector moves below the timeline with a clear heading.
- Source rail wraps into two columns or compact rows.
- Footer wraps without hiding confirmation.

At approximately 540 px:

- Source rail becomes one column.
- Workbench header controls stack.
- Timeline remains usable and may offer horizontal zoom/pan inside its own bounded region.
- Segment/action controls wrap.
- Footer actions become full-width rows.

## 4.18 Keyboard and accessibility

- Arrow-key selection in source rail and segment strip.
- Keyboard boundary selection, movement, split, merge, undo, and redo.
- Exact table alternatives for timeline segments and source laps.
- Chart accessible summary names selected activity, duration, segment count, overlay, and gaps.
- Focus remains in logical order: header → source rail → workbench controls → chart/segments → inspector → footer.
- Statuses and segment labels never rely solely on fill color.
- Chart tooltips are reachable by keyboard or mirrored in the synchronized table.

## 4.19 Acceptance tests

- One easy FIT file opens with the timeline visible and can be confirmed quickly.
- Warm-up/workout/cooldown files appear in one horizontal source rail.
- Pace remains visible while HR/elevation/cadence/power is overlaid.
- Automatic mile laps display without becoming segments.
- Split, boundary drag, keyboard move, merge, undo, and redo remain synchronized with the strip, inspector, and table.
- Late/incorrect lap presses can be corrected without altering source laps.
- Activity shoe defaults correctly; segment shoe override allocates only its distance.
- Primary activity and supporting roles validate correctly.
- Exact and possible duplicates use different flows.
- Autosaved draft survives restart.
- Confirmation is atomic and repeat-safe.
- Reopening shows the confirmed read-only review and revision path.
- 200% text scaling and keyboard-only completion are verified.

---

# 5. Weekly Review + weekly plan

Canonical references:

- `reference/weekly-review-layouts.html`, variant **Table first**.
- `reference/weekly-review-week-states.html` for **Current week**, **Upcoming week**, and **Completed week**.
- `reference/weekly-review-rearrange.html` for **Default view** and **Rearrange mode**.

Later decision that overrides an older drawing: long-run schedule bars use the purple treatment, not green.

## 5.1 Product model

Weekly Plan and Weekly Review are one week-centered experience rather than two unrelated destinations.

The default state is review/overview. It shows the plan, actual outcomes, and observations. Future schedule editing is available through an explicit **Rearrange week** mode; nothing is draggable in the default state.

The week’s state changes the information and actions:

- Upcoming week: plan preview and arrangement, no completion zeroes.
- Current week: progress through today, remaining sessions, provisional observations, and only future sessions movable.
- Completed week: final outcomes and explainable observations; no ordinary scheduling moves.

## 5.2 Page header

Left:

- Phase and week number eyebrow, e.g. `Base phase · Week 6 of 12`.
- Heading:
  - `Week preview` for future weeks.
  - `Weekly review` for current/completed weeks.
  - `Rearrange week` only inside rearrange mode.
- Date range and state, e.g. `November 2–8 · Today is Saturday`, `Starts Monday`, or `Completed`.

Right:

- Previous week button.
- `This week` or `Return to this week`.
- Next week button.

The week selector must be keyboard operable and preserve selected week when navigating within the screen.

## 5.3 Table-first hierarchy

The approved default is **Table first**:

1. Header.
2. Compact summary strip.
3. Dominant `Week at a glance` / `Session outcomes` table near the top.
4. Observations and selected rule explanation below.
5. Optional restrained mileage visualization only after the table, never as the dominant first element.

Do not substitute a dashboard of large metrics and charts above a small table.

## 5.4 Summary strip by week state

### Upcoming week

Show:

- Core planned.
- Flexible planned.
- Long run and scheduled day.
- Planned run days/activities.

Do not show completion as `0%`, actual mileage as `0`, missed sessions, or empty observations. Use `No results yet` and explain that outcomes appear after the week begins.

### Current week

The first two metrics are required and must use these concepts explicitly:

- `Planned through today`: total mileage for core and flexible sessions due on or before the literal current date.
- `Completed through today`: actual recorded mileage on or before the current date.

Also show:

- Core sessions due: performed versus due, with completed/modified detail.
- Remaining this week: future planned mileage and next meaningful session.

Do not compare future planned mileage against today’s actual as if it were missed.

### Completed week

Show:

- Core completion percentage and performed count.
- Core planned mileage.
- Actual mileage from all attached runs.
- Long-run actual versus planned.
- Run days may appear in the strip or table footer when space allows.

Core completion and mileage adherence are distinct. Extra mileage never raises core completion.

## 5.5 Week-at-a-glance table

The table is the primary weekly visual.

Current-week columns:

- Day/date
- Planned session
- Type
- Status
- Planned distance
- Actual distance
- Schedule/action state

Completed-week columns:

- Day/date
- Original plan
- Outcome
- Planned
- Actual
- RPE
- Details

Table-first comprehensive review may add Notes while preserving readability.

Rows distinguish:

- Core
- Flexible
- Rest
- Unplanned
- Today
- Upcoming
- Long run
- Linked workout/double group

Row rules:

- Original prescription remains visible beside actual outcome.
- Flexible row uses an explicit label and a subtle blue marker.
- Unplanned row uses an explicit label and does not imply core credit.
- Rest never appears failed.
- Future sessions show Upcoming/Pending, never Missed.
- Long run uses purple identity plus a text/icon label.
- Status chips always contain text: Completed, Modified, Skipped, Moved, Upcoming, Unplanned.

## 5.6 Current-week behavior

- Past/occurred rows are locked from schedule rearrangement.
- Today is visibly identified.
- Only sessions that have not happened may move.
- Progress observations are labeled provisional until the week ends.
- `What remains` lists future sessions and mileage.
- Observations exclude future sessions until an outcome is due or recorded.
- A moved session retains identity, original date, prescription, and revision history and does not create a skip.

## 5.7 Upcoming-week behavior

- Emphasize preview and arrangement.
- Nothing is missed or completed yet.
- Default table remains read-only until `Rearrange week` is activated.
- Show original dates under session names where relevant.
- Changes remain reversible and traceable.

## 5.8 Completed-week behavior

- Table shows final outcomes and original plan together.
- Late corrections are allowed through a deliberate `Edit an outcome`/review action.
- Corrections recalculate the week without deleting prior history.
- Final observations cite triggering records and missing data.
- Ordinary schedule dragging is disabled.

## 5.9 Default schedule view

Default view is clean and read-only:

- Heading `Week at a glance`.
- Right-aligned primary/secondary action `Rearrange week` when eligible.
- No drag handles.
- No per-row move dropdowns as the primary interaction.
- Footnote: `Nothing is movable until you choose “Rearrange week.”`
- Confirmation: `Original plan preserved`.

The earlier per-row date-select concept was superseded by explicit drag-and-drop rearrange mode.

## 5.10 Rearrange mode

Rearrange mode is deliberately entered; it is not the default.

Header changes to:

- Heading `Rearrange week`.
- Copy: `Drag only sessions that have not happened.`
- Actions: `Cancel` and primary `Done rearranging`.

Board header:

- Week date range.
- Copy: `Drag one long day bar onto another day to swap their training groups.`
- `Undo last move`.

### Required spatial layout

The seven days remain a vertical stack of long horizontal day bars. Do not convert them into seven narrow calendar columns.

Each day row:

- Approximately 86 px day/date column on desktop.
- Full-width training-group bar to its right.
- Clear drop target across the bar.
- Drag handle only while in rearrange mode.

This vertical long-bar design is essential because it preserves readable workout names, linked doubles, mileage, and drag targets without excessive horizontal space.

### Swap semantics

- Each day holds one primary training group.
- Dropping a group onto another day swaps the two day groups; it does not stack them.
- Rest is a valid placeholder group and swaps like a day assignment.
- A session retains identity and original scheduled date metadata.
- The revision records both groups’ old and new dates.
- Undo restores both groups atomically.
- Save status announces the swap, e.g. `Long run moved to Saturday; Workout + linked double moved to Sunday · saved`.

### Linked doubles

A double is linked to its primary workout day and moves as one training group.

Example:

- Saturday: `5 × 1 km` plus linked `Easy double`.
- Sunday: `Long run`.
- Drag Long run onto Saturday.
- Result: Long run moves to Saturday; workout and linked double move together to Sunday.

Never split the double from its primary workout through a day swap. If the user wants to unlink it, that is a separate explicit plan-edit operation outside rearrange mode.

### Visual identity

- Flexible easy: subtle blue treatment and `Flexible` label.
- Workout group: subtle amber treatment and `Workout` label.
- Long run: subtle purple treatment and `Long run` label/icon.
- Ordinary core/easy: restrained green/neutral treatment.
- Rest: dashed neutral placeholder.

Do not rely on these colors alone.

## 5.11 Keyboard equivalent for rearrangement

Dragging is never the only method.

Keyboard path:

1. Focus a movable training group.
2. Activate `Move` or a keyboard command.
3. Choose a target day from a list/dialog.
4. Preview the exact swap: `{A} will move to {day}; {B} will move to {source day}`.
5. Confirm.

The keyboard action uses the same swap domain function and undo history as drag/drop.

## 5.12 Observations and explanations

Below the weekly table, use a two-column region on desktop:

- Observation list.
- Selected rule explanation.

Each observation shows:

- Non-color symbol/icon.
- Name.
- One-line trigger summary.
- Disclosure/action.

Selected explanation shows:

- Why the observation appeared.
- Deterministic rule text.
- Every triggering record.
- Missing data and whether it matters.
- Links to the relevant session/activity.
- Disclaimer: review prompt only; no diagnosis or plan changes suggested.

Initial observations:

- Completed core week
- Consistent work laps
- Recurring soreness
- High easy-run RPE
- Comparable-run HR/pace mismatch
- Deteriorating work laps
- Accumulated subjective strain
- Plan divergence

Cutback weeks must not be flagged merely for lower planned mileage.

## 5.13 Metrics

- Core planned mileage excludes flexible sessions.
- Flexible planned mileage is separate.
- Actual mileage includes confirmed primary and supporting activities and unplanned runs.
- Core completion counts core session outcomes, not miles.
- Completed is full completion.
- Modified does not count as fully completed unless the explicit product metric defines a separate performed count; always show the distinction.
- Skipped flexible sessions remain distinguishable and do not reduce core completion.
- Rest days are excluded from completion denominator.
- Extra mileage cannot compensate for a skipped core session.
- Moved sessions remain the same session.
- Long-run distance uses the confirmed long-run bundle.
- Run days are unique local dates with actual running activity, including manual records.

## 5.14 Required differences from the current implementation

- Put the week table near the top and make it dominant.
- Add explicit upcoming/current/completed week states.
- Add `Planned through today` and `Completed through today` for current weeks.
- Do not render future sessions as missed or as zero completion.
- Combine plan visibility and review rather than making weekly review a disconnected metric screen.
- Add explicit `Rearrange week` mode.
- In rearrange mode use vertical long day bars, not horizontal calendar columns.
- Dragging swaps day groups; it does not create doubles or leave two primary groups on one day.
- Keep linked doubles with their workout.
- Use purple long-run identity.
- Provide an equivalent keyboard move flow.
- Keep observations explainable and below the table.

## 5.15 Responsive behavior

At approximately 850 px:

- Summary strip becomes two columns.
- Observation/explanation region becomes one column.
- Sidebar may compact according to the application shell.
- Weekly table stays within a labeled horizontal wrapper if columns cannot fit.
- Rearrange day bars remain vertical.

At approximately 520 px:

- Summary becomes one or two columns depending on readable width.
- Header stacks.
- Day/date column narrows but training bar remains readable.
- Linked double becomes a vertical sub-block inside the same group bar.
- Footer/status/keyboard hints stack.

## 5.16 Acceptance tests

- Upcoming week shows preview metrics and no false zeros/misses.
- Current week correctly calculates planned and completed through today.
- Completed week shows final outcomes and supports traceable late correction.
- Core completion remains separate from actual-mileage adherence.
- Flexible/unplanned mileage never fills a missed core session.
- Rest days never count as failures.
- Default view has no drag handles and no accidental moves.
- Rearrange mode enables only eligible future groups.
- Dragging onto an occupied day swaps the groups.
- Dragging onto Rest swaps the session and Rest placeholder.
- Workout plus linked double always moves together.
- Long-run swap uses the purple identity and preserves session ID/original date.
- Undo restores an entire swap.
- Keyboard move produces the same result as drag/drop.
- Current-week past rows and completed-week schedule are locked.
- Observations show rules, triggering records, and missing data.
- 200% scaling and keyboard navigation are verified.

---

# 6. Suggested component architecture

Names are illustrative; preserve repository conventions.

## 6.1 FIT logging

- `RunEntryWorkflow`
  - `EntryMethodTabs`
  - `FitImportPanel`
    - `FitDropTarget`
    - `FitImportProgress`
    - `SelectedFitFileList`
    - `SelectedFitFileRow`
    - `DuplicateSummary`
    - `ActivityReviewHandoff`
  - `ManualRunEntryPanel`
- `FitImportController` remains responsible for decode/cancel/retry orchestration.
- Pure functions determine proposed roles, duplicates, and whether continuation is allowed.

## 6.2 Activity Review

- `ActivityReviewScreen`
  - `ActivityReviewHeader`
  - `SourceFileRail`
  - `ActivityTimelineWorkbench`
    - `TimelineHeader`
    - `PaceTimeline`
    - `TimelineLegend`
    - `SegmentStrip`
    - `TimelineEditActions`
    - `SourceLapTable`
  - `SegmentInspector`
  - `ActivityReviewFooter`
  - `BundleConfirmation`
- Domain modules own matching, role/primary validation, segment boundaries, shoe allocation, duplicate resolution, confirmation projection, and revisions.
- UI state owns cursor, zoom, selected source, selected segment, and expanded source-lap table.

## 6.3 Weekly experience

- `WeeklyReviewScreen`
  - `WeekHeader`
  - `WeekStateSummary`
  - `WeekAtGlanceTable`
  - `RearrangeWeekMode`
    - `DayGroupBar`
    - `LinkedDoubleGroup`
    - `SwapPreview`
    - `KeyboardMoveDialog`
  - `WeeklyObservationList`
  - `ObservationExplanation`
- Pure domain functions determine week state, through-today cutoffs, summary metrics, movable eligibility, group membership, swap result, undo snapshot, and observations.

---

# 7. End-to-end completion checklist

## Visual fidelity

- Open each reference HTML beside the running app.
- Match information hierarchy, not merely colors.
- FIT dialog displays decoded file rows and roles.
- Activity Review opens directly to the dominant timeline.
- File rail is horizontal and inspector is on the right at desktop width.
- Weekly review is table-first.
- Rearrange mode uses vertical long bars and purple long run.

## Behavior

- Import several FIT files into one bundle.
- Review an easy run without forced segmentation.
- Review a structured workout and correct an inaccurate lap boundary.
- Overlay HR on pace.
- Assign different shoes to warm-up, workout, cooldown, and an internal segment.
- Confirm atomically and reopen read-only.
- Inspect upcoming, current, and completed weeks.
- Swap long run with workout + linked double and undo it.

## Safety and persistence

- Reimport exact FIT without duplication.
- Recover from one failed file in a multi-file batch.
- Preserve source bytes and source laps.
- Survive application restart with draft intact.
- Keep original plan and revisions traceable.
- Verify portable backup and restore with the new review data.

## Quality gate

- Add domain tests for every new calculation/state transition.
- Add rendered component tests for the major layouts and conditional states.
- Add keyboard tests for dialog tabs, timeline editing, source rail, rearrangement, and confirmation.
- Run `pnpm verify`.
- Test browser fallback and packaged SQLite behavior.
- Build through the Windows GitHub workflow if local application control blocks Rust executables.
- Record verification evidence and user acceptance before marking Complete.
