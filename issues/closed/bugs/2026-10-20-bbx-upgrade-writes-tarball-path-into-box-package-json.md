---
title: "`bbx upgrade --to` writes a machine-local tarball path into the box's tracked package.json"
workstream: unattached
area: beebox
labels: [box-shape, git]
filed-by: agent
discovered-by: agent
discovered-in: worktree-bug-burndown-4 — portable engine dependency plan
design: ../../../beebox/docs/implemented-plans/portable-engine-dependency.md
resolution: wontfix
---

Closed 2026-10-20 as accepted (boxholder decision). The only callers of
`bbx upgrade --to <tarball>` are the release smoke test, on throwaway boxes,
and Docker images, whose `file:/app/beebox.tgz` path is the same in every
container. Real boxes upgrade through deploy, which commits the portable
`link:.beebox/engine`. A tarball upgrade stays an explicit pin.

`bbx upgrade --to <spec>` writes `<spec>` into the box's `package.json` as the
`beebox` dependency (`bumpBeeBoxDependency`,
`beebox/src/cli/commands/upgrade.ts:151-159`), then runs `pnpm install`. A
`file:` tarball spec is a path on this machine. The box commits it, so box
history again carries a path that resolves only here. This is the same
problem that `2026-10-20-deploy-beebox-link-reaches-box-history.md` fixed for
deploy, `bbx init`, and worktree setup. Those paths now commit
`"link:.beebox/engine"` and keep the machine path in the gitignored
`.beebox/engine` link.

## Tension

An upgrade to a tarball is an explicit pin: the box runs a copy of that
engine, not a link to an engine directory. To be portable, the upgrade would
have to put the tarball's contents somewhere outside the box and point
`.beebox/engine` at that place. Nothing owns such a place today, and
`engine-link-spec-2026-10` deliberately leaves `file:` pins alone. Leaving it
as it is costs only boxes upgraded with `--to <tarball>`, which are release
smoke tests and installed (non-checkout) engines.
