---
title: "Scheduled notify: actions and promotion notices raised inside a wakeup child are delivered in-process, without push keys"
workstream: box-isolation-followups
area: beebox
filed-by: agent
discovered-in: worktree-box-isolation-followups — plan on-demand-job-triggers, NOT in scope
design: ../../beebox/docs/implemented-plans/on-demand-job-triggers.md
---

On a box whose wakeups run as a child process without the APNs and VAPID
keys, a notification raised inside that child never reaches a device. The
child sends it in-process, finds no keys, and records no delivery.

Finalize notifications and question alerts now go through the box server
(`routedSender` in `beebox/src/cli/lib/notify-route.ts`), which holds the
keys. Two senders still do not:

- the scheduled `notify:` action (`beebox/src/core/schedule/run-action.ts`)
  when it runs from an on-wakeup script in a `bbx engine wakeup` child
  (`beebox/src/cli/tick-utils.ts`);
- the schedule promotion notice (`beebox/src/core/schedule/promotion.ts`),
  reached from the same path.

Both work in the scheduler pass process and in the server's "run now".

Direction: pass `routedSender` to both on the on-wakeup path, as the plan did
for finalize. Check that a missing server falls back as `routedSender` already
does.
