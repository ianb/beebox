---
title: "finish-preflight reports the delta since a tested revision"
status: implemented
workstream: finish-preflight-merge-state
issues:
  - ../../../issues/closed/features/2026-11-13-finish-preflight-reports-delta-since-tested-revision.md
---
# finish-preflight reports the delta since a tested revision

`bin/finish-preflight --tested <rev>` lists the paths that changed between a
revision whose checks passed and the merged HEAD, grouped by the sheet's checks
they reach, and marks the checks no delta path reaches. The finish agent then
decides which passes still hold without working out the delta by hand.

**Issues addressed:**
`issues/closed/features/2026-11-13-finish-preflight-reports-delta-since-tested-revision.md`.
Searched `issues/` for "tested revision", "delta", "reuse": the retrospective
watch item `finish-tested-revision-record` is the same request and is cited by
that issue; nothing else.

## Design

No design section: a developer tool's text and JSON output; nothing a box
person sees changes.

## Smallest fix and budget

Smallest fix: print `git diff --name-only <rev>...HEAD` under the sheet. That
leaves the mapping from path to check to the agent, which is the work the issue
asks to remove.

Chosen: one function that runs the existing per-path map
(`verificationCommands`) on each delta path and the existing test selector with
`--base <rev>` for beebox tests, then marks each sheet command reached or not.
Estimate: ~120 source lines (preflight shell, a pure grouping function in
`finish-preflight-delta.ts`, `selection()` gains a base), ~80 test lines,
~10 lines of `finish.md` changed. No new mapping.

## Stated preferences this plan trades against

- The developer's brief: "Reusing a check must stay the finish agent's
  judgment; preflight reports, it does not skip checks on its own." The
  report adds no `skip` to any `VerificationCommand`; `finish-verify` runs what
  it ran before.
- The brief: "Use the same selection logic `bin/finish-verify` and the
  change-based test selection already use; do not build a second mapping."
- Root `AGENTS.md`: agent and skill files only grow unless pruned; the
  `finish.md` edit replaces the hand-delta instruction rather than adding one.

## What already exists

- `bin/finish-preflight-lib.ts` `verificationCommands(input: CommandInput)`:
  the one per-path map from changed paths to checks (header: *"The per-path
  verification map lived in `.claude/agents/finish.md` until now;
  {@link verificationCommands} is the one place it lives."*). Reused, called
  per delta path.
- `bin/test-git.ts` `changedPaths({ base, cwd })`: *"Changed paths versus a
  base ref (default `main`), plus anything uncommitted"*, computed as
  `` `${base}...HEAD` `` plus porcelain entries. Reused with `base: <rev>`.
- `bin/test-select.ts` `--base <ref>` and `--json`: the same `changedPaths`
  with that base, then the import-graph selection. Reused through
  `bin/finish-preflight-select.ts` `selection()`, which gains a base argument.
- `.claude/agents/finish.md` step 3 already states the reuse rule: *"Before
  retesting, inspect the delta since the tested revision."* The judgment rule
  stays; only the mechanics move to the script.

## Prior art (external)

No decision depends on an external premise; git's three-dot diff semantics are
the only external behaviour, and the ancestor check below removes the case
where they differ from two-dot.

## Ontology

- **Tested revision** — a commit the caller says its checks passed at. Given by
  `--tested <rev>`, resolved to a full sha. Must be an ancestor of HEAD. Not a
  per-check record; one revision per run.
- **Delta** — `changedPaths({ base: testedSha })`: committed changes since the
  tested revision (main's merged changes included) plus uncommitted paths.
- **Sheet command** — a `VerificationCommand` from the sheet's `verification`
  list (existing).
- **Reach** — a delta path reaches a sheet command when `verificationCommands`
  on that single path yields a non-skipped command with the same key (the
  command string; `apple` by kind, because its command carries paths). The
  single-path call never sends a root config file to a package's checks, so a
  **shared input** (a root file in `ROOT_FILES`, `patches/`, an unclassified
  directory) reaches every sheet check, and a check's own runner or a sibling
  module of it (`bin/smoke`, `bin/smoke-lib.ts`) reaches that check. beebox
  tests follow the selector, run on the whole delta against the tested
  revision: a path reaches them when a selection reason names it; the check
  is reached when any test is selected, the selector fails, or a shared input
  is in the delta.

## Tracks / scope

One track.

1. `bin/finish-preflight-delta.ts`: `deltaSinceTested(input)` (pure) takes the
   delta paths, the sheet commands, the package set, `hasScript`, and the
   beebox selection for the delta (or null). It returns, per run sheet
   command, `{ command, reached, note? }`, and the delta paths grouped by the
   set of checks they reach, so the text prints every path once. Skipped sheet
   commands are left out. The I/O shell `sinceTested()` resolves and checks
   the revision and runs the selector when the sheet runs beebox tests.
2. `finish-preflight.ts`: `--tested <rev>` (string), resolved with
   `git rev-parse --verify <rev>^{commit}` before the merge (so `HEAD` means
   the tested tip); `git merge-base --is-ancestor <sha> HEAD` after it. Either
   failure is `TestedRevisionError`, exit 2. The sheet gains
   `sinceTested: SinceTested | null`, printed right after `verification:`.
3. `selection({ root, base })` passes `--base` through. Found while testing:
   a broad selection's JSON is several megabytes and overflowed `spawnSync`'s
   1 MB default buffer, which read as "selector failed"; the buffer is raised.
4. `finish.md` steps 1 and 3: pass `--tested <rev>` on every preflight run;
   the agent judges the reached checks as before. The finish skill already
   asks the dispatcher for "completed checks, their tested revision" — no
   change there.

## Could this be simpler?

The simplest version prints the delta paths only. It omits the grouping, so
every finisher still maps paths to checks by hand, which is the cost the issue
records (one full 415 s rerun). The grouping costs one pure function because
the map and the selector already exist; no new mapping is added.

A recorded tested revision (written by `finish-verify` on green, read by
preflight) was the alternative. Rejected: the evidence the finish reuses often
comes from the caller's own runs (`pnpm test:changed` in the session), which
no recorder sees, and a record adds state that can go stale across rebases.
The caller already reports its tested revision in the dispatch brief, so a flag
carries it with no new state.

## Subplans

None.

## Failure modes

- Tested revision not an ancestor of HEAD (rebased branch, a sha from another
  worktree): three-dot would diff from the merge base and hide changes. Exit 2
  with the reason. Strict.
- Revision does not resolve: exit 2.
- Selector fails for the delta: mark beebox tests `reached` (fail toward
  running) with the selector's failure note.
- Tested revision was dirty when tested: invisible to git. The agent's
  judgment, as today; the report states it covers committed and uncommitted
  changes since that commit only.
- Delta includes main's merged changes: they are listed and grouped like any
  path. Whether "independent merged work" preserves a pass stays the agent's
  call (`finish.md` step 3).

## Agent-flow / user-flow edge cases

- `--tested` with `--no-merge`: works the same; the ancestor check runs on the
  current HEAD.
- `--tested HEAD`: empty delta; every command `not reached` unless stragglers
  exist.
- Re-run after a post-green commit: the agent passes the new tested revision.

## NOT in scope

- Checks the delta reaches that the sheet does not list (a site path main
  brought in). The sheet decides what `finish-verify` runs, and it already
  leaves main's own changes to main's landings (`changedPaths` diffs
  `main...HEAD`). Raised by the plan review; rejected for that reason.

- Skipping or reordering checks in `finish-verify` based on the delta.
- Per-check tested revisions (one `--tested` per run; run preflight twice with
  `--no-merge` for two revisions).
- Splitting the delta by origin (main's merge vs the branch's own commits).
- Recording tested revisions anywhere.

## Open design questions

None.

## Knowledge audits

Not run: the change edits two lines of the finish agent's step 1 and 3; the
headless finish agent's next runs exercise it directly.

## What will hold this after it ships

Unit tests of `deltaSinceTested` and temp-repo tests of the revision refusals
in `bin/finish-preflight-delta.test.ts` (node:test, like the other selection
tests). The grouping cannot drift from the sheet because
it calls the same `verificationCommands`.

## Implementation order

1. `selection()` base argument; `deltaSinceTested` with tests.
2. Preflight flag, sheet field, text output; ancestor/resolve refusal tests.
3. `finish.md` edit.

## Plan review

Cross-model (codex gpt-6-sol), 2026-11-15. Accepted: shared inputs never read
as "not reached"; the selector sees the whole delta; the text prints every
path; the agent text keeps reuse as judgment and carries `--tested` through
reruns. Rejected: reporting checks absent from the sheet (NOT in scope).
Command names match because the per-path calls use the sheet's own
`selectorFailed`.

Diff review (codex gpt-6-sol), 2026-11-15. Fixed: a `MERGE_HEAD` naming
several commits is never cleared; `--no-merge` reads the merge state too; a
check's runner reaches it; path groups follow the selector's reasons.

## Rollout shape

Lands with the merge-state fix on the same branch. The finish of this branch
runs `main`'s preflight, which lacks the flag; nothing depends on it until it
is on `main`.
