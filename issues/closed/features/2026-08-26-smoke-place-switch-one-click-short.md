---
title: "The smoke walk opens the place menu but never selects a landmark — it stops one click short of the surface that broke"
workstream: smoke-review
area: callback-box
labels: [smoke-tier]
filed-by: agent
discovered-by: agent
discovered-in: worktree-smoke-review — weekly smoke-tier shape review, run 20260826-140915
---

The `place-menu` step clicks `#cb-nav-place`, then asserts the menu is
expanded, carries its fixed rows, shows no error row, and lists at least one
landmark (`bin/smoke.ts`, `placeMenuFailure` in `bin/smoke-lib.ts`). It never
selects a landmark. So the walk proves the affordance renders and stops
there — the navigation the menu exists to perform is unwalked.

That is where the window's bug was.

## Evidence

[Stuck in one landmark](../closed/bugs/2026-08-20-cannot-switch-landmarks-from-chat.md) — the place menu
listed all 7 landmarks correctly, `chat.placeMenu` returned `problems: []`, and
selecting one did not move you. Every assertion the current step makes would
have passed on that box. The cause was server-side and shared, not iOS-only as
first suspected: `chat.lastSessionForDirectory` and `chat.directoryFor` read
only committed history, so a switch to a landmark whose only session was an
uncommitted reservation coined a fresh chat each time. Fixed 2026-08-25 in
`8d80ef30`.

Supporting, outside this window and outside the walk's reach:
[iOS: selecting a landmark starts a NEW chat](../closed/bugs/2026-08-04-ios-landmark-opens-new-session-not-most-recent.md) — a
second defect in the same click, resumed correctly on web, so a browser walk
would not have caught that one. It is here to say the click has a history, not
as a second gate failure.

## The caveat a later reader should weigh

The 2026-08-20 trigger was a specific state — a landmark whose only session is
a reservation with no committed history row. A walk of `test1` would hit the
switch, not necessarily that state, so this is not a claim the proposed step
would have gone red on that commit. The argument is narrower: the walk already
pays ~3.6s (p50) to open this menu, and the assertion boundary sits one click
before the behaviour the surface is for.

## What the step would do

Extend `place-menu`, or add a `place-switch` step after it: select a listed
landmark by ref and assert the consequence — the chat page is now bound to that
landmark's directory and the place pill names it. Assert on the resulting state,
never on the click's exit status; `bin/browse click` dispatches a mouse event
at the box centre and reports success either way (see
[browse click does not dispatch](../closed/bugs/2026-08-21-browse-click-on-a-ref-does-not-dispatch.md)).

Costs to weigh against the 120s budget: a navigation plus a snapshot, on the
order of the existing `card-open` step (5.3s p50). Current whole-walk times are
25.7–32.9s, so there is room.

## Step counts this review read (all time = this window; the tier is one day old)

```
step             ran  failed     p50   last failure
restart            5       0    0.7s   never failed
cold-start         5       1    2.4s   2026-08-26T18:38:22.701Z
backend            4       0    5.3s   never failed
chat-shell         4       0    5.1s   never failed
place-menu         4       0    3.6s   never failed
browse-list        4       0    3.1s   never failed
card-open          4       0    5.3s   never failed
page-errors        4       0    0.5s   never failed
```

Do not read those as a record for or against any step. All five runs are from
2026-08-26 between 18:37 and 19:06, on the branch that built the tier.

Related: [A smoke tier at merge and deploy](../closed/exploration/2026-08-26-merge-time-smoke-tier.md).
