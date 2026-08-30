---
title: "Questions end-to-end: rollout + hardening followups"
workstream: unknown
area: beebox
design: ../../beebox/docs/implemented-plans/questions-end-to-end.md
---

Followups from the questions-end-to-end implementation (merged to main
2026-07-10, `29863299`). The feature is live in code but the rollout has
unfinished operational steps, and the review passes left named test gaps.

## Rollout (blocking — the feature is half-deployed until these run)

- **Run the `question-lifecycle` migration on prod boxes and
  `~/src/boxes/test1`** per `beebox/docs/migrations.md`
  (`scripts/migrate/question-lifecycle-run.ts` — dry-run first, then
  `--apply`; exit code 2 means select-options violations to fix by hand).
  It has only run on the questions worktree's test-box clone. Until it
  runs, existing question cards on those boxes carry the retired
  `answered-by:` field, lack `asked-at:` (so the aging sweep warns and
  skips them — no nudge, no expiry), and scan-import questions stranded in
  `.attach/` scopes stay invisible to every surface.
- **Template rollout parks.** `templates/procedures/process-pages.procedure.card`
  parked on the questions worktree's test-box clone at `bbx init` (observed
  2026-07-10) and will park on other existing boxes; check
  `process-retrospective.procedure.card` too. Both carry the rewritten
  question-card guidance (YAML format, `learning:`, no `answered-by`), so a
  parked box keeps issuing stale-format instructions to its agents.
  Force-accept per the template tracker flow (`config/template-versions.json`
  / `priorStockHashes`).

## Testing gaps (named by the codex review passes, deliberately deferred)

The doctests cover the in-process happy and rollback paths; the
process-level failure modes of the guarded transition
(`src/core/commands/question-transition.ts`) are untested:

- **Two-process contention** on the per-question file lock (CLI answer vs
  web answer vs aging expiry as separate processes) — lock timeout and the
  loser's status re-check.
- **Stale-lock recovery** (holder killed while holding
  `.beebox/question-locks/…`).
- **SIGKILL between writes** — the job-before-card ordering exists exactly
  so a crash never leaves `answered` with no job; the invariant is
  documented and code-ordered but has no test that kills the process
  between the two writes.
- **Hook failure after staging** — rollback unstages on commit failure;
  the tested trigger is "no git repo," not a pre-commit hook rejecting the
  commit after paths are staged.
- **End-to-end learning round-trip at the scenario tier** — question
  created → answered → follow-up job → reactor (fake agent) executes the
  directive and records the `learning` belief to its sink with
  `source: user-stated`. Every link is unit/doctest-covered; no single test
  walks the chain.
- **The nudge notification path has never fired for real** — only
  doctests. First box that crosses the 7-day threshold with a channel
  configured is the live test; worth provoking one deliberately.

## Observation followups (after the loop runs in the wild)

- Watch a few real answered questions: does the follow-up agent actually
  record `learning:` well (right sink, evidence-quoting, sensible decline
  notes)? A user-story-style spot check after ~10 real answers.
- The parked design question from the plan ("hypothesis at ask time" —
  should asking record the proposal as a hypothesis-grade belief the agent
  acts on while pending) — revisit once the base loop has been lived with;
  the `learning.proposal` shape was designed so this needs no schema
  change.
- Footnote, by design: scoped `bbx finalize -c <connector>` runs skip the
  question-alert/aging block (only the full finalize and `-c push` run
  it); if scoped finalize runs ever become a primary cadence, the sweep
  needs its own trigger.
