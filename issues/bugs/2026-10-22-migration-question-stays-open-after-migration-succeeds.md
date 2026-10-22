---
title: "A migration's repair question stays open after the migration later succeeds"
workstream: unattached
area: beebox
labels: [migrations]
filed-by: agent
discovered-by: agent
discovered-in: worktree-risky-merge-review — adversarial review of the merges since 2026-10-08
---

When a migration fails with repair on, the bounded repair writes
`Migration_<name>-<n>.question.card` (`beebox/src/core/migration-repair.ts:71-75`).
When the script later exits 0 and commits, the sweep records the migration and
deletes the repair receipt, but nothing touches the question
(`beebox/src/core/migration-sweep.ts:86-93` and `:293-295`). The code predates
the engine-link failure; that failure made it visible.

With an unanswered question left on the box:

- every later sweep returns `attention`;
- the migrations health check stays not-ok ("Repair questions: …");
- `sweepWithoutWork` returns null while any question is unanswered, so every
  hourly `--yield` pass closes the box to new work (up to a 15 s drain) only to
  report the stale question;
- an answer to the question runs its directive: an agent repair for a
  migration that is already applied.

A test proved the sequence: the script fails once with repair on, then two
passes succeed; the statuses are `failed`, `attention`, `attention`, and
`migrationQuestions` still lists `Migration_<name>-0`.

This is live in production now: the engine-link repair wrote a question on each
production box on 2026-10-20, and the migration later succeeded on every box.
Checking and cleaning those cards is the `engine-link-migration-fix`
workstream's territory; this issue covers the framework.

## Related

A stale unanswered question also hides a later exit-2 result. `runBoundedAttempt`
(`migration-repair.ts:99-103`) returns at once with the caller's code when an
unanswered question exists. Sequence: the migration fails hard (exit 1) and
writes question 0; someone fixes the blocking card by hand without answering;
the next run converts and exits 2 with `leftover:` lines. The sweep sees
`{code: 2, question: q0}`, commits, and records the migration as
partial-applied. No agent runs and the leftover output is on no card, which
breaks the documented contract that the question carries the rerun's output.
Because the migration is now recorded, the leftover check never runs again. A
test proved this too. Fixed in commit 130469082: an exit 2 behind an open
question is now `deferred-repair` and records nothing; the stale question still
hides the new output until it is answered, which the fix above would cover.

## Proposed fix

When a migration commits with exit 0, mark its unanswered
`Migration_<name>-*` questions as resolved (an answer such as "superseded:
migration applied <time>") and commit them with the migration. In
`runBoundedAttempt`, when the current code or failure text differs from what an
unanswered question records (at minimum exit 2 against a question written for
a hard failure), write a new question with the current output instead of
returning the stale one (the second half is what remains after 130469082).
