---
title: "Review how the pre-finish test review step was applied in its first week"
workstream: test-value-research
area: testing
filed-by: agent
discovered-by: Ian
discovered-in: worktree-test-value-research — after designing the finish test-review step (2026-10-23)
labels: [tests, finish]
---

The pre-finish test review designed in
[2026-10-21-finish-reviews-new-tests-for-long-term-value](../docs-and-chores/2026-10-21-finish-reviews-new-tests-for-long-term-value.md)
decides without a human. Its criteria came from reading 60 existing files;
whether a developing session applies them the same way to its own new
tests, under finish-time pressure, is untested. One week of real finishes
is the evidence.

What to gather, from `git log main` since the step landed:

- Every `Tests: review before finish` commit: how many units it lists, the
  code and action per unit, and whether a branch that added tests has no
  such commit (the step was skipped or forgotten).
- For each edited unit, read the diff and say whether the edit kept the
  claim. For each removed unit, say whether the removal would be reversed.
- For each `K1?` unit, whether the session later said it saw the test fail.
- How long the step took where the session said; the research measured
  about one minute per file by a reader with no knowledge of intent.
- Whether any review-commit edit broke in `bin/finish-verify` or in the
  hourly suite afterwards (the ledger, `full-suite-red-*` issues).

What to decide from it: whether the codes are being applied as defined or
are drifting to all-OK (a rubber stamp) or to removing guards; whether the
script's flags were used or ignored; whether the commit format answers "was
this test reviewed" from `git log`. Record the counts and the calls as a
dated note on the finish issue, adjust the skill text or the flags, and
close this one.

Re-reviewed 2026-10-30: the step this reviews has not landed, so there is no week of finishes to read yet.
