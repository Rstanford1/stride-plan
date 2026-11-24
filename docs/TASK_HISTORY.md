# Task history index

Use this index to find existing technical evidence when it is relevant. It is not
an activity log, status tracker, approval record, or requirement for every PR.
Project Coordination retains ownership of [PROJECT_STATUS.md](PROJECT_STATUS.md)
and the shared trackers described in [parallel development](PARALLEL_DEVELOPMENT.md).

## Existing evidence

- [A3 FIT import state safety](A3_FIT_IMPORT_STATE_SAFETY.md): failure modes,
  root cause, correction, and verification for stale and overlapping imports.
- [I13 browser QA](I13_BROWSER_QA.md): isolated browser QA setup and limits.
- [Training-plan contract](../schemas/training-plan/README.md): versioned
  contract decisions, validation, and historical evidence.
- [T07 Windows acceptance](T07_WINDOWS_ACCEPTANCE.md),
  [T08.1 Windows acceptance](T08_1_WINDOWS_ACCEPTANCE.md), and
  [T08.1 packaged acceptance results](T081_PACKAGED_ACCEPTANCE_RESULTS.md):
  task-specific Windows and recovery evidence. These are historical, not proof
  of acceptance for a later revision.
- [Task ID mapping](TASK_ID_MAPPING.md) preserves links between current and
  historical identifiers. Consult the original task or PR for other evidence.

## Optional records

When a significant discovery has reusable value and no suitable evidence already
exists, a short record may be placed in `docs/task-history/` and linked here.
Prefer a task-specific file to routine edits of a shared index when concurrent
work would conflict. Include only relevant facts: objective and exact revision;
observed discovery and root cause; resolution; verification and its limits; and a
reusable lesson, with links to source evidence. Clearly label uncertainty and
separate approved decisions from proposals. Do not reconstruct project history,
copy an existing report, include personal data, or create a record for every PR.
