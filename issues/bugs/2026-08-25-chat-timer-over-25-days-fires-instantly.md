---
title: "A chat timer past ~25 days fires instantly — and a malformed one silently never fires"
workstream: unattached
area: beebox
labels: [journey-findings]
filed-by: agent
discovered-by: agent
discovered-in: worktree-user-stories-refresh — journey A, 2026-08-25 walk; mechanism traced by a verifier agent
priority: backlog
---

## Recovery assessment (2026-09-21)

Current code still passes the unrestricted future delay to `setTimeout` in
`beebox/src/core/chat/schedules.ts:290-301`. Missing or invalid `in` attributes
still log and skip in `schedule-tags.ts:23-33`. Both mechanisms remain present;
no new live timer was scheduled during recovery. The documentation attribute
correction from the old branch is recovered with this evidence.


> Recovered 2026-09-21 from `worktree-user-stories-refresh` at `f914fcb4e`.
> The account below describes the 2026-08-25 walk, not a new reproduction.
> Source line numbers in that account are historical. Current disposition is recorded below.


When I ask to be reminded about something in a month, I want the reminder to
arrive in a month, so I can stop carrying it — a reminder that fires now, or
never, is worse than none, because I have already stopped carrying it.

Two failure modes, one surface:

**1. Long delays overflow and fire immediately.** `armTimer`
(`src/core/chat/schedules.ts:294-310`) passes the delay to `setTimeout`
unclamped. Node clamps any delay over 2^31−1 ms (≈24.85 days) to **1 ms** with a
`TimeoutOverflowWarning`. Every chat timer longer than ~25 days fires at once.

Observed live in journey A: the user asked for a ~month-out reminder, the agent
set a 30-day chat timer, and it fired twice immediately (two `addSchedule`
calls, each overflowing). From the box's own log:

```
[ChatSchedules] Scheduled "tape measure decision" to fire at 2026-09-24T21:53:33.060Z (in 2592000s)
(node:50663) TimeoutOverflowWarning: 2591999997 does not fit into a 32-bit signed integer.
Timeout duration was set to 1.
[ChatSchedules] Firing schedule "tape measure decision"
```

Compounding it: `parseDuration` (`src/schemas/scheduled-script-duration.ts:34-59`)
has units `s/m/h/d/w` and no month, so "about a month" must be written `30d`/`4w`
— exactly the range that overflows. The natural phrasing of the request selects
the broken path. (`0m` also parses to 0 → the fire-now branch; theoretical.)

The fix shape is routine — chain shorter timeouts or re-arm on a cap — plus,
given the repo's sleep-time discipline, note that `startAwakeTimeout`
(`src/lib/awake-timeout.ts`) exists for long horizons and a month-long
`setTimeout` would misbehave across sleep anyway.

**2. A malformed tag silently never fires.** On parse failure the `<schedule>`
tag is dropped with only a `console.log` (`src/core/chat/schedule-tags.ts:23-33`
— missing `in`, or a `parseDuration` throw). The agent's prose has usually
already told the user the reminder is set. Same user-visible outcome as the
overflow — no reminder — by the opposite mechanism.

Also fixed alongside this filing: `docs/chat/schedules.md` documented the
attribute as `delay=`; the parser requires `in` (the agent-facing prompt was
already correct, so live agents were unaffected — but a doc reader writes tags
that path 2 silently drops).

The walk's user, watching the double instant fire:

> "If reminders don't fire reliably, this is a list, not an assistant."

Related: [agent-invented-root-cause](2026-08-25-agent-narrated-an-invented-root-cause.md)
— what the agent said while this was happening.
