# Implementation plan

- Build a React and TypeScript shell with a calm, keyboard-first Windows layout.
- Define session, activity, journal, weekly metrics, and observation rules as testable domain modules.
- Add a local repository boundary with browser persistence for development and a Tauri SQLite adapter/migrations for packaged builds.
- Retain the existing seed plan and legacy imported records; accept new plans only as validated Training Plan JSON 1.1 with preview, exact-source preservation and draft persistence. External AI conversion of coach documents happens independently of Stride Plan (revised T06).
- Implement Today, Plan, Activity Review, Weekly Review, Trends, and Data & Settings as complete vertical workflows.
- Verify domain transitions, metrics, duplicate detection, import validation, persistence, backup/restore, keyboard behavior, and production output.

## Running checklist

- [x] Inspect repository and source workbook
- [x] Runnable application shell
- [x] Domain model and persistence
- [x] Plan and run-entry workflows
- [x] Activity review and import workflows
- [x] Weekly review, trends, and explainable observations
- [x] Backup, restore, and settings
- [x] Automated verification and packaging notes

## Revised JSON import direction (November 14, 2026)

- T06: remove direct spreadsheet/CSV import and exclusive dependencies. See
  DESIGN.md and ROADMAP.md for approved scope, verification and acceptance status.
- T07 (future): guided external-AI conversion, authoritative prompt and accessible
  JSON schema. No integrated AI provider or hosted conversion service.
- T08 (future): validate externally generated JSON against representative 40, 55,
  65 and 75+ MPW coach plans.
- T11 (future): integrate and refine JSON import and drafts, rather than workbook
  parsing. Stride Plan owns validation, provenance, persistence and safe activation.
