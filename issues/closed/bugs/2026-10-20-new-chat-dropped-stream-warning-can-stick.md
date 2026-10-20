---
title: "In a new chat, a turn stream that drops before the session id arrives can leave the warning up"
workstream: bug-burndown-4
area: beebox
labels: [chat, ui-sensibility]
filed-by: agent
discovered-by: agent
discovered-in: worktree-error-severity — cross-model review of the chat status-bar severity change, 2026-10-17
priority: normal
resolution: implemented
---

**Closed:** Fixed in f8a37022e, 93187d95f and 73bef8b7a. Accepted residual: the server keeps a turn's session id only in memory for 60 s after the turn finishes; a page that cannot refresh within that window, or a box restart, still shows the warning until the next send, dismiss or reload.

Split from the
[one-pink-bar issue](2026-08-25-one-pink-bar-three-severities.md)'s
residuals. Reported by the reviewer, not reproduced.

In a new chat, if the live turn stream fails before the box assigns the
session id, the chat machine keeps `sessionInput: "new"`. Every history
refresh after the drop then takes the no-history branch, so the "reply will
appear" warning can stay up until the next send, a dismiss, or a reload, even
after the reply lands.

Two test-box runs of a new chat recovered normally (2026-10-17), so the window
may be narrow or closed by other timing.

A reliable fix ties the session assignment to the accepted turn, so the page
knows the session id once the send is accepted. That is a protocol choice for
the boxholder. Start by reproducing it: make the turn-stream subscribe fail on
the first turn of a new chat, before the session id event, and watch the bar.
