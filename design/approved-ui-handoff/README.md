# Approved UI handoff

This export is the implementation source of truth for the three approved workflows that drifted from their visual designs:

1. **Log workout → Import FIT**
2. **Timeline-focused Activity Review**
3. **Weekly Review + weekly plan/rearrangement**

Start with [IMPLEMENTATION_SPEC.md](IMPLEMENTATION_SPEC.md). It defines the exact hierarchy, appearance, interaction rules, data behavior, responsive behavior, and acceptance tests. The HTML files in `reference/` are the canonical interactive drawings from the design discussion.

When prose and an older implementation disagree, follow this export. When prose and the reference drawing appear to disagree, follow the explicit precedence notes in the specification; they capture later user decisions such as the purple long-run treatment.

## Instructions for a coding agent

1. Read the repository `AGENTS.md`, `README.md`, `DESIGN.md`, `UI_INVENTORY.md`, and `ROADMAP.md`.
2. Read all of `IMPLEMENTATION_SPEC.md` and open every HTML file in `reference/` before editing.
3. Audit the current UI against the “Required differences from the current implementation” sections.
4. Implement one vertical slice at a time in this order:
   - FIT import dialog
   - Activity Review shell and immediately visible timeline
   - segment editing and right inspector
   - weekly state-aware table-first review
   - explicit rearrange mode with drag-to-swap
5. Preserve the current FIT decoding, duplicate handling, source preservation, drafts, confirmation rules, and domain tests. This is primarily a presentation and workflow correction, not permission to discard working data behavior.
6. Keep all calculations and validation in named domain functions.
7. Update the approved design/status documentation as work progresses.
8. Run `pnpm verify`, browser visual checks, keyboard checks, and the Windows packaging workflow before requesting acceptance.

Do not mark these components **Complete** until the user accepts the rendered result against the reference HTML.
