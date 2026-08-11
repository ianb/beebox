---
title: "EXPORT.md: agent instructions for getting your data out"
workstream: open-source-readiness
area: callback-box
filed-by: agent
discovered-in: worktree-open-source-readiness — launch-readiness conversation with the boxholder
labels: [soft-launch]
---

Data export on the SECURITY.md pattern (boxholder, 2026-07-20): not a
suite of end-to-end export tools, but an **instruction doc addressed to
the user's agent** — "your data is cards in a git repo; here is the
layout; here is how to turn it into <calendar/notes app/plain
files/whatever>." Small helper tools where they make steps easier, but
the doc is the feature, not an automated pipeline per destination.

This is the third instance of a deliberate pattern: every user of this
system has an agent by definition, so a well-written agent-legible
operational doc IS the capability — same move as
[agent-install](../../callback-box/docs/agent-install.md) (agent adapts
install to the environment) and the
[agent-maintained security report](2026-07-20-agent-maintained-security-report.md)
(committed prompts as process). It also demos the system's own thesis:
plain files + git means exit is genuinely easy, and this doc proves it
instead of claiming it.

Include the backup sliver: a paragraph on setting a git remote so the
box's history has a second copy (wakeup already pushes when a remote is
configured) — see also
[git-push-confirmation](../decisions/2026-07-20-git-push-confirmation.md)
for the trust angle of automatic pushes.

Trust/launch value: "how do I leave" answered plainly is a feature for
exactly the friendly-but-cautious audience of the
[soft launch](../decisions/2026-07-20-soft-launch-posture.md).
