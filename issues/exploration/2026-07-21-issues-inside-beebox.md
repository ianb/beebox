---
title: "Move the issue system inside beebox"
workstream: open-source-readiness
area: beebox
filed-by: agent
discovered-in: worktree-open-source-readiness — launch-readiness conversation with the boxholder
labels: [soft-launch]
next-action: fixed
---

Boxholder (2026-07-21): "Moving the issue system inside beebox
would also be pretty reasonable. In some ways this is the todo system I
actually want, because this is the one I'm using and I'm liking."

The observation underneath: the `issues/` markdown-file queue — one
file per tension, category directories, frontmatter, cross-links,
closed-by-moving — has proven itself through real daily use, while the
box's own task-tracking story is thinner. Making it a beebox
capability (an `issue` card schema or pack, with the same conventions)
would give any box a working issue/todo system, and would make it
extensible: views, [meta issues](../docs-and-chores/2026-07-21-meta-issues.md)
with live open/closed rollups, agent filing with provenance, schedules
nudging stale items.

Half-thought-out, hence exploration. Things that made the current
system work that a port must keep: filing friction near zero, the
category-is-the-directory simplicity, tensions-not-mandates framing,
git as the archive. Related:
[issue-tracking-evaluate-beads](2026-05-26-issue-tracking-evaluate-beads.md)
(the buy-vs-build sibling — evaluating an external agent-oriented
tracker), and the installable-packs kernel in
[first-run-experience](../features/2026-07-20-first-run-experience.md)
(an issues pack would be a natural early pack).
