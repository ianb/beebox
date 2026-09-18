---
title: "Schedule alerts have no severity: a notification and a failure look the same"
workstream: unattached
area: router
labels: [schedules]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder reading two alerts side by side
---

`bin/schedules alert` takes `--priority important|normal|backlog|fyi`
(`bin/lib/schedules.ts:302`). That vocabulary is the issue queue's, and it
answers "how soon should someone work on this", not "what kind of thing is
this". The boxholder wants the second axis: **warning / error / notify**.

Two alerts from the same evening show the gap:

- `deferred-issues` — "1 public and 0 private issue(s) became active", at
  `--priority normal` (`schedules/deferred-issues/run.ts:61`). Nothing is
  wrong. It is a notification, and the new-private-issue part is worth
  knowing, but it reads like every other open item.
- `full-suite` — "1 test file fails on main", also an alert in the same list.
  Something is broken.

The UI already renders the priority as a pill and the message as Markdown
(`workstreams-app/src/frontend/components/ScheduleAlerts.tsx:8,24`), so the
presentation side is mostly a matter of having something real to show.

## What to decide

- Is severity a new field, or does it replace `priority` on alerts? Priority
  belongs to the developer on an issue; on an alert the schedule knows the
  kind and the developer does not set it. Two overlapping scales on one record
  is the smell the boxholder's "minimize invented concepts" preference warns
  about.
- What the three levels mean, concretely: `error` = something is broken and
  needs a person; `warning` = something may be wrong or is degrading;
  `notify` = this happened, no action. A schedule must be able to pick one
  without guessing.
- Presentation per level: a `notify` item should be quiet and collapsible; an
  `error` should be the one thing that stands out. Acknowledged items already
  collapse (`ScheduleAlerts.tsx:80`).

## Markdown in the messages

The renderer handles Markdown, but most schedules write plain lines. The
deferred-issues message is one example: a bare filename, no link, no structure.
Compare `full-suite`, which writes bold labels and a bullet list and reads
well. This is a per-schedule authoring fix plus, probably, a line in
[bbx-authoring-schedules](../../.claude/skills/bbx-authoring-schedules/SKILL.md)
saying the message is Markdown and what a good one looks like. An activated
issue should link to the issue.

Related: [make schedule alerts less noisy](2026-09-18-schedule-alert-noise-daily-cadence.md).
