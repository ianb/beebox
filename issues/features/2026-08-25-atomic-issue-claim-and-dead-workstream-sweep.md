---
title: "Atomic --issue claim on main; sweep ownership held by dead workstreams"
workstream: unattached
area: bin
filed-by: agent
discovered-by: agent
discovered-in: "worktree-beads-vs-issues — comparing Beads' compare-and-set --claim against launch-session.sh"
priority: backlog
---

Source: [Beads vs. our issues/ queue](../../research/beads-vs-issues.md) §2.3.

## 1. The claim is not atomic

`bin/lib/launch-session.sh:52` runs `assign-issue-workstream.ts` inside the
new worktree, so the `workstream:` stamp lives on the branch until merge and
`main` never sees it. Two launches can claim the same issue. Beads'
`bd update --claim` is a compare-and-set: assignee := actor, refuse if
another actor holds a live claim, idempotent for the same actor.

Proposal: `launch-worktree-session --issue` commits the stamp to `main`
before creating the worktree (from the main checkout, the way `bin/land`
merges; docs-only commit, ~1s of hooks), and refuses when the field already
names a live workstream (one with a worktree or `worktree-<name>` branch).
Idempotent for the same name. The in-worktree write goes away. Git is the
lock; no lease, no heartbeat.

## 2. Ownership held by dead workstreams

Nothing clears `workstream:` when a worktree is culled without finishing.
`bin/workstreams sweep` reports orphaned worktrees and private branches, not
orphaned ownership.

Proposal: `sweep` lists open issues whose `workstream:` names no live
workstream, resets them to `unattached`, and sets `next-action: reconfirm` —
a dead owner is evidence the issue's state is unknown, and `reconfirm` puts
it in the developer's normal pass. (Alternatives considered: report only;
reset without the tag.)
