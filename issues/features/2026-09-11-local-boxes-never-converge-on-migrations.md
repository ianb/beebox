---
title: "Nothing migrates local boxes — only prod converges, so a dev box silently falls behind until someone notices a missing card"
workstream: unattached
area: beebox
priority: important
labels: [migrations, boxes, dev-environment]
filed-by: agent
discovered-by: Ian
discovered-in: main session — a local box was missing its interface cards; "I guess it should [happen automatically]"
---

A local box was found with **12 pending migrations**, its manifest last touched
2026-09-05, and no `_config/interface/` directory at all — so neither
`canonical-interface-cards` nor `remaining-interface-cards` had ever run and
the box had no `settings.card`. It surfaced only because the boxholder noticed
the card was missing.

Nothing converges local boxes. The only automatic migration anywhere is in
`beebox/deploy/deploy.sh:717-748`: after a prod deploy, in the at-rest window
between `bbx-wait-quiet` and the restart, it walks `/home/beebox/boxes/*/` over
SSH and runs `bbx migrate --sweep` then `bbx docs refresh` per box. That loop is
prod-only. There is no hook, no scheduled job, and nothing on box start that
does the same for `~/src/boxes/`.

So every local box drifts from the shipped code until a human runs `bbx migrate
--apply` by hand. A second box was mid-drift at the same moment: it had the
first interface-card cohort but not the second.

## The setting already exists — do not invent one

`beebox/.env` carries a `BOXES=` line naming exactly the local boxes (four, at
filing time), and `readBoxes` in
`workstreams-app/src/router/router-real-effects.ts:63-72` already parses it —
it is how the dev router knows what to serve. A local convergence step should
read the same list rather than introduce a second source of truth about where
boxes live.

Note the asymmetry worth preserving: `bin/lib/worktree-create.sh:409-419`
deliberately drops the `BOXES=` line when copying `.env` into a worktree, so a
worktree serves its own cloned box instead of the developer's real ones. A
convergence step must respect that — it should converge the developer's boxes,
not a worktree's clone, and must never touch a box a worktree is using.

## What to decide

- **When it runs.** Candidates: a `schedules/` job (the repo already has that
  machinery and an alert surface), a post-merge hook on `main`, or box start.
  The deploy analogue runs after new code lands, which argues for post-merge —
  but a hook that migrates data on every merge is a bigger promise than one
  that reports drift.
- **Whether it applies or only reports.** `--sweep` applies and commits each
  migration; it also skips a dirty box and stops at a procedure-kind migration.
  Reporting drift and letting the human run it is the conservative option and
  may be the right one for a machine the developer is actively working in.
- **Dirty boxes are the normal case locally, not the exception.** The box that
  prompted this was blocked precisely because it held uncommitted work that
  does not yet validate. `--sweep` would skip it silently. Whatever is built
  must make a skip visible — deploy.sh prints one line per box and continues,
  which is the right shape.

## Related

- `beebox/src/core/migration-sweep.ts` owns the sweep policy; reuse it rather
  than writing a second one.
