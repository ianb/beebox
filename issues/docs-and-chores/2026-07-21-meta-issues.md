---
title: "Meta issues: tracking issues that aggregate other issues"
workstream: open-source-readiness
area: issues
filed-by: agent
discovered-in: worktree-open-source-readiness — launch-readiness conversation with the boxholder
labels: [soft-launch]
---

The boxholder wants meta issues as a first-class idea — "that's a
Bugzilla feature I like" (2026-07-21). A meta issue is an issue whose
body is a curated set of links to other issues plus the framing that
makes them one effort: a tracker, not a task. **Not a launch blocker**
— filed because the idea is good, per the boxholder.

The convention already half-exists:
[soft-launch-posture](../decisions/2026-07-20-soft-launch-posture.md) is
the first real instance (decisions + a gate list linking child issues +
a session index). What would make it a convention rather than a
one-off:

- A way to mark one: simplest is a `meta: true` frontmatter flag (or
  just a title convention); the category stays whatever fits.
- Children link back to their meta issue (the `discovered-in:` field
  already carries session provenance; a meta link is the durable
  version).
- `doc-check` already validates the links both ways, so the graph
  stays sound for free.

If [the issue system moves inside callback-box](../exploration/2026-07-21-issues-inside-callback-box.md),
meta issues become a card-ref pattern and could get real aggregation
(open/closed rollup on the meta's view) — worth keeping the two ideas
linked.
