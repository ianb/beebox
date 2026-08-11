---
title: "Invalid at/until dates in scheduled-script cards are silently inert"
workstream: schedule-cadence
area: callback-box
filed-by: agent
discovered-in: worktree-schedule-cadence — cross-model review of the cadence formatter
resolution: implemented
---

Implemented in the `schedule-cadence` workstream: `at`/`until` now require an
ISO 8601 shape that parses (`src/schemas/scheduled-script-fields.ts`), `cron`
must parse AND produce a previous occurrence, `rrule` must parse, and
cron/at/rrule are mutually exclusive (schema `superRefine`, fail-closed at
load). `createScheduledScriptTemplate` validates its output and throws rather
than emitting a card that can't load. The runtime catches in
`isCronDue`/`isRruleDue` now `console.warn` instead of silently returning
false. Sweep confirmed zero existing cards on any real box fail the new
validation.

The `scheduled-script` schema types `at` and `until` as plain `z.string()`
(`src/schemas/scheduled-script.tsx:54-56`). A malformed date passes validation
and then does nothing at runtime:

- `until`: `isDue` compares `ctx.now > new Date(script.until)`
  (`src/schemas/scheduled-script.tsx:195`). An invalid date makes the
  comparison always false, so the expiry bound silently never fires — the
  schedule runs forever while the card claims a cutoff.
- `at`: `new Date(script.at)` invalid means `ctx.now >= atDate` is always
  false, so the one-shot silently never runs.

Neither case produces a warning anywhere. `cb validate` accepts the card.

Fix direction: validate `at` and `until` as parseable datetimes in the schema
(`z.string().refine(...)` or a shared ISO-date field helper), so a bad date is
a card validation error at authoring time instead of a silent no-op. Same
question applies to `cron`/`rrule` strings, which are also only parse-checked
lazily at evaluation time (`isCronDue`/`isRruleDue` swallow parse errors and
return false).
