---
title: "A fast manual rollback: `deploy.sh --rollback` switches back to the previous release"
workstream: unattached
area: beebox
labels: [deploy, production]
filed-by: agent
discovered-in: worktree-atomic-deploy — Track D of the atomic-deploy plan, split out
---

Production deploys now install each release beside the live one and switch
`/opt/beebox` to it ([atomic deploys](../../beebox/docs/implemented-plans/atomic-deploy.md),
[releases](../../beebox/docs/server/deploying.md#releases)). A failure after
the switch rolls back by itself. A bug found later, after a deploy passed its
checks, has one way back: `deploy.sh --ref <old-sha>`, which rebuilds and
reinstalls (a few minutes).

The previous release is still on disk, so a manual rollback could be a
switch and a restart: seconds of work. The plan's Track D has a design: take
the deploy lock (refuse when held), run `rollback --check`, stamp
`.deploy-requested` with the previous release's sha, and run a short
activation (window, stop, rollback, `install_units`, restart, health check)
under the maintenance controller. The cost is making `deploy.sh`'s build and
upload half skippable and assembling a second activation script, about as
large as the switch itself.

The boxholder is not sure this matters (2026-11-13): `--ref` works, and
the automatic rollback covers the common failure. Worth doing if a slow
`--ref` rollback ever hurts during an incident.
