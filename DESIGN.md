# Stride Plan design

## Status

This file records the observed design baseline from the Phase 1–2 audit. It is not an approved redesign. Component specifications will be added only after discussion and user approval.

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

## Component specification register

No component specification is approved yet. Approved specifications will be added here with purpose, layout, information, interactions, states, edge cases, accessibility, dependencies, and acceptance criteria.

## Audit evidence

- Code inspected: all React screens/components, state and repositories, domain rules, tests, CSS, Tauri shell, capabilities, and migration.
- Rendered inspection: all six screens plus the historical run-entry dialog at the local browser-development viewport.
- Verified checks: formatting, TypeScript, 17 automated tests, and production build.
- Not visually verified: populated Activity Review, import validation preview, triggered observation details, native Tauri/SQLite behavior, Windows installer, 200% Windows scaling, and forced-colors rendering.
