---
title: "Sweep open issues whose workstream: names a dead workstream"
workstream: unattached
area: bin
filed-by: agent
discovered-by: agent
discovered-in: "worktree-beads-vs-issues — comparing Beads' expiring claim leases against workstream: ownership"
---

`workstream:` on an open issue is set when a worktree takes responsibility
(`--issue` on launch, `/finish` re-stamps). Nothing clears it when the
worktree is culled without finishing, so `bin/issues list --workstream` and
the issues browser show ownership by a workstream that no longer exists.
Beads answers the same problem with claim leases that expire; that is too
much machinery for one developer running one session at a time.

Proposal: `bin/workstreams sweep` (or a `bin/issues` check) lists open
issues whose `workstream:` matches no live worktree or `worktree-<name>`
branch, and offers to reset them to `unattached`. No new field.
See [Beads vs. our issues/ queue](../../research/beads-vs-issues.md) §2.3.
