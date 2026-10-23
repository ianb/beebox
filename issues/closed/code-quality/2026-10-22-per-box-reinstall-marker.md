---
title: "Per-box reinstall check compares package.json to node_modules/react, so every deploy reinstalls every box"
workstream: unattached
area: beebox
labels: [deploy]
filed-by: agent
discovered-by: agent
discovered-in: worktree-risky-merge-review — adversarial review of the merges since 2026-10-08
resolution: implemented
---

Resolved: the per-box install moved into `beebox/deploy/server-bin/bbx-box-install`, which records a completed install as `node_modules/.bbx-install-stamp`, touched only after `pnpm install` exited 0 and the engine link verified. A box is reinstalled when the stamp is missing, `package.json` or `pnpm-lock.yaml` is newer than it, or the recorded install no longer verifies. Covered in `beebox/test/deploy/box-install.test.ts`. The first deploy after this change installs every box once to write the stamps.

The per-box reinstall check in `beebox/deploy/deploy.sh` (the `marker=` step
before "Converging boxes") compares `package.json` against `node_modules/react`.
Once a migration rewrites `package.json`, a no-op `pnpm install` never updates
that marker, so every deploy reinstalls every box during downtime. The last four
deploy logs show 6 of 6 boxes "installing" followed by "Already up to date".

A dedicated marker touched after a verified install would end that.
