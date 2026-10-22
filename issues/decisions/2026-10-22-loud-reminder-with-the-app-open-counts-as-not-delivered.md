---
title: "A loud reminder shown as an in-app banner still records as not delivered when no push device exists"
workstream: unattached
area: beebox
labels: [notifications, scheduler]
needs: [decision]
filed-by: agent
discovered-by: agent
discovered-in: worktree-risky-merge-review — adversarial review of the merges since 2026-10-08
---

A `bbx remind` card is `requested-by: boxholder`, so it sends `loud`. On a box
with no APNs device and no web-push subscription, both channels skip as
`no-audience`. `emitLive` has already shown the in-app banner to a person with
the app open, but `notificationReached` (`beebox/src/core/notify-boxholder.ts:63`)
counts a present-skip as reached only for `quiet` sends. The run records
`failure` and schedule health shows the reminder as failing.

The retry loop this caused (about 30 re-sends over a day after commit
1e580f3c4) is fixed in this worktree: a send where every channel skipped is
recorded once and not retried. What remains is the question of what the record
should say.

## Decision

Should a `loud` send count as reached when `presence.activeWeb > 0`, because
the banner was shown to someone with the app open? If yes, the reminder records
`success` and health shows nothing. If no, a box with no registered device
keeps showing each reminder as a failed send, which is accurate about push but
not about whether the person saw it. The distinction between "reached a device"
and "shown on screen" is a product call.
