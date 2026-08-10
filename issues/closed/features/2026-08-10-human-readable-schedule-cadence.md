---
title: "Schedule rows show raw cron — replace with a human-readable cadence"
workstream: schedule-cadence
area: callback-box
labels: [ui, scheduler]
resolution: implemented
---

Implemented in the `schedule-cadence` workstream: `describeCadence`
(`src/core/schedule/describe.ts`) composes cron (via cronstrue), rrule
(via rrule's `toText()`, already a dependency), `at`, `on-wakeup`, `once`,
`not-before` ("at most once every N"), and `until` into one sentence. Used
by the dashboard (raw expression kept as a tooltip) and `cb scheduled`.

The schedule list renders the raw expression: `cron 0 4 * * * ≥20h`,
`cron */15 * * * * +wakeup ≥10m`, `cron 0 6,18 * * * +wakeup ≥4h`. The
boxholder's verdict: *"Those are very hard to read. I know what they mean and I
can't read it."* If the person who wrote them can't scan them, nobody can.

Replace with a description of the cadence — "Every day at 4am", "Every 15
minutes", "Twice a day, at 6am and 6pm".

Rendered in `ScheduleRow` (`src/frontend/src/components/dashboard/ScheduleOverview.tsx:118-130`),
which prints `s.schedule` in a mono font and appends `+wakeup` and `≥{notBefore}`
as separate spans.

## A library covers part of it

[cronstrue](https://www.npmjs.com/package/cronstrue) is the standard answer for
the cron half — it turns `*/5 * * * *` into "Every 5 minutes", handles all the
special characters (`* / , - ? L W #`), takes 5/6/7-part expressions, has no
dependencies, and ships 30+ locales. It's a port of the C#
`cron-expression-descriptor`, so it's well-trodden.

**But cron is only one of the schedule vocabulary's timing forms.** The
`scheduled-script` schema (`src/schemas/scheduled-script.tsx:53-59`) has:

| Field | What it is |
|---|---|
| `cron` | cronstrue covers this |
| `rrule` | iCal recurrence — a different grammar; `rrule.js` has its own `toText()` |
| `at` | a fixed time |
| `until` | an end bound |
| `not-before` | a **minimum gap** between runs (the `≥20h`) |
| `on-wakeup` | also runs when the box wakes (the `+wakeup`) |
| `once` | fire once |

So this is "describe a schedule," not "translate a cron string." A design that
only wires up cronstrue will leave `rrule`, `at`, and `once` rows still unreadable
— and possibly worse, since they'd sit next to prose ones.

## The composition is the actual work

`cron 0 4 * * * ≥20h` is currently three tokens the reader has to combine
themselves. The useful output is **one sentence**: "Every day at 4am, at most
once every 20 hours." Likewise `*/15 * * * * +wakeup ≥10m` →
"Every 15 minutes and on wakeup, at most once every 10 minutes."

Getting `not-before` right matters and it's easy to phrase backwards — it's a
floor on the interval, so "at most once every N", not "at least".

## Keep the raw expression reachable

Don't delete it. The boxholder writes these, and an exact string is what you
need when editing or debugging one — a title/tooltip, a toggle, or the source
view. The prose is for scanning; the expression is for working.

## Open questions

- One shared formatter (backend, so `cb` output and any other surface get it
  too) or frontend-only? The same unreadability applies wherever a schedule
  prints.
- Does `rrule.js` earn its weight for however many `rrule` schedules actually
  exist, or is a narrower hand-written description enough for those?
- Timezone: cron here is machine-local. Say so, or leave it implicit?
