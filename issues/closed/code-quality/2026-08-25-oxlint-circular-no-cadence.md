---
title: "oxlint and the circular-dep check still have no cadence"
workstream: chores-burn-down
resolution: implemented
---

**Closed:** This commit adds one weekly baseline-diff schedule for oxlint and circular-dependency findings.

2026-08-24, narrowed 2026-08-25.

**Mostly resolved.** This was filed asking for two things: weekly cadence for
the code-health sweeps, and a general mechanism to run scheduled dev-repo tasks
instead of hand-rolling a launchd script per job. The `schedules/` system
landed on `main` and delivers both — `bin/schedules` with one launchd tick,
per-job directories, durable alert records, and `schedules/knip-sweep` running
the dead-code sweep weekly with a baseline diff so only NEW findings are
reported. `bin/schedules lint` passes and a dry run of the sweep works against
the current config.

What remains is the smaller half. `callback-box/docs/maintenance.md` lists two
more sweeps whose cadence column still says "periodically" and "after big
refactors", which in practice has meant never:

- `pnpm lint:oxlint` — supplemental lint, catches what ESLint misses
- `pnpm lint:circular` — madge; type-only cycles are fine, a new *value* cycle
  means a module needs splitting

Both are cheap and both have the property that made knip worth scheduling: the
report is stable, so a diff against last week is nearly always empty and a
non-empty one is real news. `schedules/knip-sweep/run.ts` is the template —
the baseline-diff logic is the whole trick, and it is about forty lines.

Whether they are two schedules or one combined "supplemental lint" job is a
judgment call; one job with two sections keeps the alert volume down.
