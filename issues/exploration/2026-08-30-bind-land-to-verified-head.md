---
title: "Bind bin/land to the exact head that finish verified"
workstream: research-no-mistakes
area: tooling
labels: [git, tests]
filed-by: agent
discovered-in: research/no-mistakes-review.md
---

`/finish` has a strong procedural gate but `bin/land` has no durable evidence
that the branch tip it is about to merge is the tip that passed that gate.

Today `.claude/agents/finish.md` requires a clean tree, a green
`bin/finish-verify`, and re-verification after every post-green commit. Then
`bin/land` independently requires a clean `main`, a branch that contains current
`main`, and commits ahead of it. Those checks prevent conflictful or dirty
landings, but a direct `bin/land` invocation—or a finish-agent mistake—can merge
a head for which no verification result exists.

No Mistakes v1.60.3 records the exact review-approved SHA and checks that every
later head equals or descends from it before publication. Its daemon/database
and force-push design do not fit this repository, but the invariant may.

Investigate a small receipt owned by the existing commands:

- record branch, exact HEAD, contained `main` SHA, and verification kinds after
  `bin/finish-verify` completes green;
- decide where the finish agent's judgment-only steps (Track O, plan/issue
  reconciliation) enter the receipt, so tests alone cannot authorize landing;
- make `bin/land` require and consume a matching receipt;
- invalidate/refuse when HEAD or `main` changes;
- preserve the current reduced re-verification rules for post-green docs-only
  commits rather than silently requiring the full suite;
- keep `schedules/full-suite` as the hourly post-merge net.

The design should remain one local landing path, with no proxy remote, daemon,
PR requirement, force-push, or second worktree.

Source comparison: [research/no-mistakes-review.md](../../research/no-mistakes-review.md).
