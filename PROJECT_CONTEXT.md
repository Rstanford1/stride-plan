\# Stride Plan — Project Context



Updated: November 16, 2026



\## Purpose



Stride Plan is an offline-first Windows desktop application for managing running training plans, recorded activities, training journals and performance review.



It is built with Tauri 2, Rust, React, TypeScript and SQLite.



The application prioritizes preservation of coach instructions, explainable calculations, user-controlled decisions, and local data ownership.



\## Important product rules



\- Preserve original prescribed workouts separately from user revisions and actual results.

\- Do not automatically modify training plans or provide AI-generated coaching prescriptions.

\- Preserve original FIT recordings and relevant source metadata.

\- Missing activity information must not silently become zero.

\- Plan changes, activity confirmation, and other consequential operations require deliberate user action.

\- Normal local functionality must remain available offline.



\## Training-plan import



T06 replaced direct Excel/CSV imports with JSON 1.1 intake.



Users convert coach documents externally using an AI agent of their choice. Stride Plan validates the resulting JSON, reports errors and warnings, preserves original instructions and exact source bytes, and saves a persistent draft.



Saving a draft does not activate the plan.



T06 was implemented, tested, accepted, and merged as PR #10.



\## Development status



\- T01–T06: merged and accepted for their defined scopes.

\- T07: guided external-AI document-to-JSON conversion workflow; next planned feature.

\- T08: representative coach-plan conversion validation; future work.

\- T11: broader JSON import and draft integration; future work.



Completion of these tasks does not mean all related product features are finished.



\## Repository and authority



Read `AGENTS.md` first, then `README.md`, `DESIGN.md`, `UI\_INVENTORY.md`, and `ROADMAP.md`.



Historical Phase 0 documents contain important design and architecture discussions, but proposed material must not be treated as automatically approved.



Protect existing Git worktrees and uncommitted changes. Check current Git state before coding.



\## AI development workflow



ChatGPT is used for product decisions, architecture review, task definition, and acceptance.



ChatGPT Work is preferred for complicated or high-risk repository changes, migrations, native integration, security and difficult debugging.



A limited three-task experiment will assess Qwen3.6 35B-A3B through OpenCode for small, bounded implementation tasks.



Measure total elapsed time, manual intervention, correctness, verification, and review effort. Do not assume a local model is more efficient merely because it can produce working code.



\## Immediate priorities



1\. Maintain concise documentation of approved decisions.

2\. Run and evaluate the three-task local coding-agent experiment.

3\. Continue T07 planning and implementation through separately approved tasks.
