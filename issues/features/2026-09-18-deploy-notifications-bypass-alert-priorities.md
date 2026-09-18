---
title: "Deploy notifications pop up on every landing, outside the schedule alert priorities"
workstream: unattached
area: router
labels: [schedules]
filed-by: agent
discovered-by: agent
discovered-in: worktree-schedule-alert-signal — surveying notification channels for the alert cadence work
---

Schedule alerts now follow one rule: only `important` pops up, and `normal`
and `fyi` wait for a daily digest
([plan](../../beebox/docs/implemented-plans/schedule-alert-signal.md)). The deploy path
does not. `beebox/deploy/deploy.sh:57` `notify()` calls `BBX_DEPLOY_NOTIFY`
directly, with no durable record, for three outcomes:

- `✅ beebox deployed` on every successful landing (`deploy.sh:1005`) — a
  routine success, which the alert rules would call `fyi`.
- `❌ beebox deploy FAILED` — something a person should act on today.
- `⏸ beebox deploy interrupted` — the next landing redeploys.

So a busy landing day still produces a popup per landing, and a failure looks
like the successes around it. It was left out of the alert work because deploy
runs as its own process with no store, and routing it through
`bin/schedules alert` would make a non-schedule write schedule records.

Options, smallest first:

1. Drop the success popup, or make it quiet (log only); keep failure and
   interruption popups.
2. Give deploy outcomes a record the alerts page and digest can read (its own
   store, or a generic "alert source" beside schedules), so success is `fyi`
   and failure is `important`.

Related: [deploy reads an ssh failure as a signal](../bugs/2026-09-18-deploy-reads-ssh-failure-as-a-signal.md).
