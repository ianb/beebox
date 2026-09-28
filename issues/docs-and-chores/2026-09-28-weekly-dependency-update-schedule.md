---
title: "A weekly schedule that keeps dependencies current, with special care for a few important packages"
workstream: unattached
needs: [design]
area: beebox
labels: [dependencies, schedules]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder discussion, 2026-09-28
---

Nothing keeps ordinary dependencies current. There is no Dependabot or
Renovate configuration, and the only update schedules are `sdk-update`
(daily, the Agent SDK and Codex) and `docling-update` (a weekly watch that
only alerts).

## Policy (developer, 2026-09-28)

- **Update when we can, but not aggressively.** Stay reasonably current
  without chasing every release.
- **At most weekly.** No package gets a check more often than weekly.
- **The agent SDKs are the one exception.** They warrant the daily
  `sdk-update` check that already exists.
- **A few bigger, more important packages get special care.** Docling is the
  example: an upgrade there needs judgment (re-read `docling convert --help`,
  re-extract a sample document, diff the output), not a version bump.
- **Everything else** is "interesting but not essential" and belongs in one
  weekly sweep.

## What to design

- **The special-care list.** Which packages need judgment on upgrade, and
  what each one's check is. `docling-update` is the first member; decide
  whether it folds into the new schedule as one entry or stays separate.
- **The sweep.** What it checks: pnpm workspaces (`pnpm outdated -r`), the
  Python tools run through `uv`/`uvx`, and Swift packages in `ios-app/`.
  Decide whether it only reports, or also applies settled patch and minor
  updates on a branch, runs the checks, and lands them with `bin/land` the
  way `supplemental-lint` lands its fixes.
- **Settling.** Like `docling-update`'s 14-day window, skip releases that are
  too new, so a yanked or quickly patched release is never picked up.
- **Major versions.** Report them, or file an issue each, instead of
  applying them.
- **Deploys.** Landing a change to root pnpm files or `beebox/` deploys to
  production. Decide whether sweep updates land on their own or wait for the
  developer.

Use the bbx-authoring-schedules skill for the schedule itself.
