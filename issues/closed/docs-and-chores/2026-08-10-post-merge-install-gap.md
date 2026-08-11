---
title: "Merging a dependency-adding change breaks the main checkout's cb until pnpm install runs"
workstream: workstreams
area: callback-box
filed-by: agent
discovered-in: worktree-schedule-cadence — full suite failed after landing a change that added cronstrue
resolution: implemented
---

Resolved by `55ce6925`, which adds a checkout-local post-merge dependency sync. The hook runs
`pnpm install --frozen-lockfile` when a merge changes `pnpm-lock.yaml`. It runs
before local deploy and build work, applies to main and worktrees, and reports a
failed install on stderr while completing the hook's other duties. It also
compares the worktree for squash merges, where `HEAD` does not move.

The `dist/cli.mjs` bundle externalizes all packages (`scripts/build-cli.mjs`,
`packages: "external"`), so a new dependency must exist in `node_modules` at
runtime. When a merge to `main` adds a dependency, the main checkout's bundle
rebuilds (post-commit deploy hook, or `bin/cb`'s staleness self-heal) and
starts importing the new package — but nothing runs `pnpm install` in the main
checkout, so every `cb` invocation there fails with `ERR_MODULE_NOT_FOUND`
until someone installs by hand.

This is a recurring problem — the boxholder reports being bitten by it
before, independent of this incident.

This is not hypothetical: landing cronstrue (2026-08-10) broke `cb` for every
consumer of the main checkout — including real boxes at `~/src/boxes/*`, whose
box packages resolve `callback-box` from it — until a manual `pnpm install`.
The field-test doctests caught it only because they exercise the main
checkout's bundle.

Fix direction: the root husky `post-merge` hook (which already exists to
trigger deploy) could run `pnpm install` when the merge touched
`pnpm-lock.yaml` — the standard post-merge-install pattern. Alternatively
`bin/cb`'s self-heal could detect `ERR_MODULE_NOT_FOUND` from the bundle and
suggest (not run) the install. The server deploy path is unaffected —
`deploy.sh` installs — it's only local checkouts that go stale.
