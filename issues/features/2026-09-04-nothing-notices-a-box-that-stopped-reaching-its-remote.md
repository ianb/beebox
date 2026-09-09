---
title: "Nothing notices a box that has stopped reaching its remote"
workstream: deploy-separation
area: beebox
filed-by: agent
discovered-in: worktree-deploy-separation — split out of the add-box push-credential fix
priority: backlog
---

A box that cannot push looks completely healthy. It serves, agents run, commits
land locally, wakeups succeed. The only symptom is that its history stops
arriving anywhere else, and nothing reports that — not the deploy, not any
health check, not the box itself.

The [push-credential fix](../closed/features/2026-09-04-add-box-does-not-set-up-the-push-credential.md)
removed one *cause* (a box added without a usable credential). It did not
address the silence, and the silence is what made that cause expensive: the
condition persisted indefinitely because nothing was watching for it. Other
causes remain — a revoked or expired credential, a deploy key removed when a
`gh` auth token is de-authorized, a remote renamed, a network path that stops
working, a wakeup that quietly stops running.

**What exists now.** Admin → Backup (`src/core/box/backup-status.ts`) reports,
per box, whether a remote is configured, how many commits are unpushed, and
what assets exist only on that machine. That is the right measurement, but it is
*pull*: someone has to open the page for one box and read it. Nobody opens six
Admin pages to check whether anything broke.

**Fix direction.** The measurement is already there and cheap (a git call and a
directory walk, ~25ms), so this is about surfacing rather than computing:

- A **fleet view** — one row per box the hub serves — answers "is anything at
  risk" at a glance. It needs a cross-box UI surface, which does not exist yet
  (`src/hub/` is all backend); that was considered and deferred when the Backup
  section was built.
- An **alert** is the version that needs nobody to look: a box whose unpushed
  count has been non-zero for N days, or whose last successful push is older
  than N days, is worth a notification through the existing boxholder-alert
  path (`src/core/notify-boxholder.ts`).

The alert is the one that would have caught the original incident. Note it needs
a notion of "last successful push", which the current measurement does not have
— ahead-count alone cannot distinguish a box that pushes daily and is briefly
ahead from one that has not pushed in months.

Thresholds and which surface to build are open, and the second is a product
decision about how much the boxholder wants to be told.
