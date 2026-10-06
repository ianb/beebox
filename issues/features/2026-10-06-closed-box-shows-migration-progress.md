---
title: "A box closed for migration shows only \"closed\"; it should show what is running and how far along it is"
workstream: unattached
area: beebox
labels: [migrations]
filed-by: agent
discovered-by: Ian
discovered-in: main — a local box closed by the hourly migration sweep
---

On 2026-10-06 the boxholder found a local box "seemingly closed for
migration" with no sign of what was happening or when it would end. The
hourly `box-convergence` schedule had started `bbx engine migrate --sweep
--repair` after a migration landed on main (publication cards, `1bdd7e011`).
The run took the box's exclusive maintenance phase
(`.git/bbx-maintenance/phase.json`: `reason: migration`, `phase: exclusive`)
and then spent more than seven minutes in a `git add -A` through git-annex.
The box was in use moments before; three trick runs committed in the two
minutes before it closed.

Today the closed box answers with one sentence: "Box <name> is closed for
migration (pid …); it reopens when that process finishes or exits"
(`beebox/src/hub/server/box-unavailable.ts`, from the box-maintenance-no-wedge
work; the iOS web view shows the same text). Nothing says which migration,
which step, how long it has run, or whether it is progressing or stuck.

## Wanted

A progress indicator while a box is closed for maintenance:

- What is running: the migration name (or "repair", "sweep"), and the phase.
- The current step and, where countable, progress (for example "committing:
  staging files" or "card 120 of 450").
- How long it has run, and when the page will retry.
- A clear signal when a step has made no progress for a long time, so a stuck
  run is distinguishable from a slow one.

The closed page should update itself and reopen the app when the box opens,
instead of requiring a reload.

## Notes

- The maintenance owner already writes `phase.json` and lock metadata
  (`beebox/src/lib/box-maintenance.ts`); a small progress record beside them,
  written by the migration runner (`beebox/src/core/migration-run.ts`,
  `migration-sweep.ts`), is a natural source. Keep it cheap: progress writes
  must not slow the migration.
- The hub serves the closed response; the progress must be readable without
  the box server, which is not admitting work.
- Related, not in scope here: whether a sweep should wait for an idle box
  before closing it.
