---
title: "Per-box reinstall check compares package.json to node_modules/react, so every deploy reinstalls every box"
workstream: unattached
area: beebox
labels: [deploy]
filed-by: agent
discovered-by: agent
discovered-in: worktree-risky-merge-review — adversarial review of the merges since 2026-10-08
---

The per-box reinstall check in `beebox/deploy/deploy.sh` (the `marker=` step
before "Converging boxes") compares `package.json` against `node_modules/react`.
Once a migration rewrites `package.json`, a no-op `pnpm install` never updates
that marker, so every deploy reinstalls every box during downtime. The last four
deploy logs show 6 of 6 boxes "installing" followed by "Already up to date".

A dedicated marker touched after a verified install would end that.
