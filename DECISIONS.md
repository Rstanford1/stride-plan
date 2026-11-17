\# Stride Plan — Decision Amendments

This is a concise record of later approved decisions. It supplements, but does not automatically replace, detailed approved design specifications.

\## 2026-11-14 — External AI conversion replaces direct spreadsheet import

\*\*Approved:\*\* Users convert coach-provided Excel, PDF, CSV or other documents into Stride Plan JSON 1.1 using an external AI agent.

Stride Plan remains responsible for validation, warnings, original-source preservation, draft persistence, and safe later activation.

No embedded AI provider, workbook parser, automatic activation, or cloud conversion service is required.

\*\*Implementation:\*\* T06, merged as PR #10.

\## 2026-11-15 — Offline-first operation

\*\*Approved:\*\* Viewing and editing plans, journaling, local FIT import, analysis, and navigation work without internet access. Garmin synchronization may defer while offline and resume when connectivity returns.

\## 2026-11-15 — Activity date assignment

\*\*Approved:\*\* Garmin activity dates use the activity's local start date. Preserve original timestamps and timezone information, and allow the user to override the assigned training date without changing the original recording.

\## 2026-11-16 — AI coding-agent experiment

\*\*Agreed development experiment:\*\* Evaluate Qwen3.6 35B-A3B through OpenCode on three bounded tasks.

This is not approval to delegate general product decisions or high-risk development to a local agent. Evaluate results before deciding whether to expand its role.

\## Open decisions

Detailed T07 user-interface choices recovered from historical discussions require confirmation against original approvals before implementation. Do not infer that an entire proposed roadmap or design document is approved.
