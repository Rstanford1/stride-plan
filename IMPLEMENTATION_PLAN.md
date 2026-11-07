# Implementation plan

- Build a React and TypeScript shell with a calm, keyboard-first Windows layout.
- Define session, activity, journal, weekly metrics, and observation rules as testable domain modules.
- Add a local repository boundary with browser persistence for development and a Tauri SQLite adapter/migrations for packaged builds.
- Seed representative plan data from the reference workbook and support safe CSV/XLSX preview before import.
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
