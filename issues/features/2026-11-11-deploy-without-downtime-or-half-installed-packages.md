---
title: "Deploys stop the services for over a minute and leave box agents a half-installed package tree"
workstream: atomic-deploy
area: beebox
labels: [deploy, production]
filed-by: agent
discovered-by: Ian
discovered-in: "main checkout — a box agent's report during a docs deploy, 2026-11-11"
---

Every deploy copies the build into `/opt/beebox` in place (`rsync --delete`),
reinstalls packages, and restarts the hub and scheduler. `bin/deploy-status`
reports 66 to 84 seconds down per deploy on 2026-11-11. Two problems follow:

- **Box agents break mid-deploy.** A box agent that runs `bbx` in that
  window can find dependencies missing. On 2026-11-11 one reported that every
  `bbx` command failed with "Cannot find package @kwsites/file-exists" (a
  `simple-git` dependency), so it could not commit its work. It recovered
  once the deploy finished, but the agent could not tell why.
- **Small changes pay the full cost.** A change to a box-facing doc
  (`beebox/docs/box/`) needs only the regenerated `box-docs/` on the server,
  yet it gets the full sync, reinstall, and restart. (Test-only changes no
  longer deploy at all, since 4548e9ac7.)

## Directions

- **Install, then switch.** Build and install each deploy into a new release
  directory next to the live one, then switch a symlink (`/opt/beebox` or the
  box's `.beebox/engine` link target) in one step and restart. A `bbx` run
  sees the old install or the new one, never a partial one. Keep the
  previous release for a fast rollback. Check what the box links, the
  systemd units, and `deploy-info.json` assume about the fixed path.
- **A light path for box docs.** When every shipped path in a commit is under
  `beebox/docs/box/`, regenerate `box-docs/` and copy only it, under the same
  deploy lock and log, with no reinstall or restart. The hooks' path rule
  (`bin/deployed-paths.ts`) would classify a commit as full, docs-only, or
  none.
- **Tell box agents.** While a deploy runs, `bbx` could say "Bee Box is
  updating; try again in a minute" in place of a missing-module error.
  The deploy window already writes a marker page for nginx
  (`beebox/deploy/server-bin/bbx-deploy-window`).

Related: [release discipline and the update story](../decisions/2026-07-20-release-discipline-and-update-story.md).

## Status 2026-11-13

"Install, then switch" shipped on branch `worktree-atomic-deploy` (plan:
`beebox/docs/plans/atomic-deploy.md`): each deploy installs into its own
release directory, then switches `/opt/beebox` in one rename. Box agents no
longer see a partial tree. Still open: the box-docs light path (second
direction), the "Bee Box is updating" message (third direction; little left
to explain after the switch), and a `deploy.sh --rollback` command (plan
Track D, deferred). Issue left open for the light path.
