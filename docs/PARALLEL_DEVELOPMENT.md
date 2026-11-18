# Parallel development and merge coordination

This policy governs simultaneous Stride Plan work. It lets an agent complete an
owner-approved task through a review-ready draft PR without changing merge,
release, product, safety, or data authority. It supplements `AGENTS.md`; when
there is a conflict, preserve product and data-safety boundaries and ask the
repository owner or Project Coordination to resolve it.

## Roles and ownership

- **Project Coordination** owns `docs/PROJECT_STATUS.md`, the master work
  tracker, integration ordering, and any centrally requested updates to
  `ROADMAP.md` or `UI_INVENTORY.md`.
- **Milestone agents** own only their task branch, worktree, task-specific
  specification, implementation, tests, and evidence. They preserve approved
  decisions and verification there; they do not routinely edit master trackers.
- The repository owner alone authorizes a merge. A maintainer may carry out an
  authorized merge but must record that authorization in the PR or acceptance
  evidence. No agent changes GitHub settings or merges automatically.
- Keep current IDs in new work while retaining legacy B/T and I/A IDs unchanged
  in historical branches, commits, PRs, test reports, and acceptance records.

## Task preflight and lifecycle

1. Verify the repository location, Git, required task tools, available GitHub
   authentication/permissions, fetched `origin/main`, the current worktree
   list, local status, and active PRs. Record the exact source SHA and any
   unavailable tool or connection; do not claim an unavailable operation passed.
2. Create one new branch and one isolated worktree for the task from current
   `origin/main`. Do not repurpose a worktree that has another task or changes.
3. Before editing, list the files to change and identify overlaps with active
   PRs. Explicitly name shared interfaces, persistence/database migrations,
   dependencies, generated contracts, and shared documents affected.
4. If an overlap affects behavior, a shared interface, a migration, or shared
   documentation ownership, agree on an owner and integration order before
   implementation. If that cannot be established, stop and request Project
   Coordination or owner direction.
5. Keep the branch narrowly scoped. Rebase or merge only your own worktree
   after checking current `origin/main`; resolve only conflicts within your
   approved task boundary.

After the owner approves a task, make routine in-scope technical decisions
independently: implement and refine the approved behavior, repair formatting,
compilation, and tests, add regression coverage, resolve mechanical conflicts
in your own branch, rerun checks, commit, push, and open or update a draft PR
when access permits. Do not seek additional approval for those routine steps.
Escalate only material scope, product, architecture, safety, security,
data-integrity, semantic-conflict, shared-interface, or integration decisions.
Routine authority never authorizes destructive operations, unapproved
migrations, historical-data rewrites, or GitHub settings changes.

Never reset, clean, stash, force-checkout, force-push, delete, or otherwise
alter another agent's workspace. Never use normal installed-profile data during
testing. Use synthetic fixtures, browser development storage, or a deliberately
isolated test profile; source workbooks, FIT files, databases, backups, and
credentials remain untouched and uncommitted.

## Shared documents and interfaces

Task-specific specifications and evidence are the normal record for a
milestone. Project Coordination consolidates those records into the master
tracker. An agent may edit a shared document only when its task boundary names
the document or Project Coordination explicitly assigns it. Before doing so,
the agent must announce the target section, source evidence, and active-PR
overlap, then sequence that change with the other owner.

For a shared interface, exported type, schema, database migration, or workflow
dependency, the producing task documents the compatible contract and migration
order; consuming tasks do not assume an unmerged API or schema. Database
migrations must be ordered, reversible or safely forward-only as approved, and
tested against the applicable isolated baseline/upgrade path. Parallel PRs must
not use the same migration identifier.

An agent may resolve a mechanical Git conflict in its own branch by preserving
both approved changes, then rerunning relevant verification and reporting the
resolution. A semantic conflict is an escalation, not a merge-resolution task.
Do not rebase merely to refresh documents; refresh only when required for
compatibility or controlled integration.

## Acceptance revisions and reporting

Record the exact tested SHA and preserve its acceptance evidence. Avoid an
unnecessary rebase after acceptance. When a later commit affects tested
behavior, rerun the relevant verification and record the new SHA; it does not
inherit prior acceptance automatically. Distinguish implemented behavior,
automated verification, packaged Windows acceptance, owner acceptance, merged
code, and released application.

Every draft PR or task handoff records task ID and scope; branch; source SHA;
exact tested SHA and acceptance SHA when relevant; changed files; active-PR
overlaps and dependencies; conflicts and resolution; local and hosted results;
packaged Windows status; remaining risks/work; and the exact owner action
needed. Preserve legacy B/T and I/A identifiers in historical and acceptance
records.

## Integration sequence

1. Project Coordination compares each ready PR with current `origin/main` and
   the other active PRs, including changed files and the declared dependency
   graph.
2. Merge prerequisite contracts, migrations, and shared primitives first, one
   authorized PR at a time. Refresh the next PR against the resulting
   `origin/main` and repeat its relevant checks.
3. Merge independent feature PRs only after their declared interfaces and
   migration prerequisites are present. Shared-document consolidation follows
   feature integration and is performed by Project Coordination.
4. For each integration, record source SHA, merge commit, changed files,
   conflicts and resolution, local/hosted checks, remaining work, and whether
   packaged Windows acceptance is applicable, complete, pending, or not
   applicable.

Local verification and hosted CI are separate evidence. Run `pnpm verify` when
the environment supports it. UI work also records browser rendering and
keyboard/focus/empty/error/disabled/window-size checks. Packaged Windows
acceptance is separately tracked and never inferred from a build or green CI.

## Safe recovery

If a conflict or test failure appears, preserve the worktree, capture the
source SHA and failure, and stop the affected integration. Do not overwrite,
delete, or reset another task. Project Coordination decides whether to rebase,
prepare a focused compatibility PR, or defer the task. A rejected or superseded
PR remains historical evidence; preserve its legacy identifiers and acceptance
record rather than rewriting history.

## Walkthrough A — routine documentation conflict

Two approved feature branches edit the same task-evidence section. Preflight
detects the overlap. If both statements are compatible, the agent updating its
own branch performs a mechanical resolution that retains both facts, runs
documentation and applicable repository checks, and reports the result without
unnecessary approval. If the statements assert competing approved behavior or
ownership, the agent preserves both versions, identifies the decision required,
and asks Project Coordination or the owner to choose. The master tracker itself
remains with Project Coordination unless specifically assigned.

## Walkthrough B — unapproved schema or data change

An approved frontend task discovers that a SQLite schema change or historical
data rewrite would be needed. The agent identifies it as outside the approved
scope, stops that affected implementation path, leaves existing data and
worktrees untouched, records the risk and safe alternatives, and requests
explicit owner approval for a separately scoped migration. It may finish
unrelated safe frontend work and verification. It does not create a production
migration or demonstrate the policy with destructive operations.
