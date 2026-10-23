---
title: "A deploy that fails after the services stop leaves production down, and the repair loop then runs while it is down"
workstream: unattached
area: beebox
labels: [deploy]
filed-by: agent
discovered-by: agent
discovered-in: worktree-risky-merge-review — adversarial review of the merges since 2026-10-08
resolution: implemented
---

Resolved: the activation script's EXIT trap now starts the services again when
the script exits non-zero between the stop and the restart. The CONTROL block
runs the repair loop only when both services are up and the trap did not have
to restart them, otherwise it prints that activation failed before the restart
and exits at once. The status probe reports a box it cannot query. A comment at
`pnpm store prune` warns against assuming a warm cache, and
`beebox/docs/server/deploying.md` now matches. The per-box reinstall marker was
split into [its own issue](../../code-quality/2026-10-22-per-box-reinstall-marker.md).

The activation script that `deploy.sh` runs on the server stops the hub and
the scheduler early (`beebox/deploy/deploy.sh:602`) and restarts them near the
end (`:932`). It runs under `set -euo pipefail`. Between those two lines sit the
frozen install, the better-sqlite3 guard, `pnpm store prune`, the deploy-info
and deploy-history writes, `visudo`, the systemd drop-ins, and the VAPID setup.
A failure in any of them aborts the script. The EXIT trap (`:594`) only takes
down the "deploying" page. Nothing restarts the services, so every request gets
a 502 until the next successful deploy or a manual restart.

Commit 159fd6e36 says every deploy after the TypeScript 7 merge failed the
frozen install after stopping the services. The local `deploys.jsonl` shows a
run of failed deploys on 2026-10-18 between 00:30 and 05:01 UTC. Whether the
hub stayed down that whole time is not proven; the server logs have rotated.

The CONTROL block (`:1145-1165`, commits 7f83bd66e and e1a829106) makes it
worse. When `maintenance_rc` is non-zero it runs `bbx engine migrate --sweep
--repair` for every box with a pending migration, up to 25 minutes per box,
one box after another. After a failure before the restart, the engine is
half-activated (new code, old dependencies) and the services are down, so the
repair runs against a stopped site and the "Deploy failed" notice arrives only
after the loop ends. `beebox/docs/server/deploying.md:27-30` says the repair
runs "after the other boxes are serving again", which is false for every
failure before the restart. The status probe's `2>/dev/null || continue` also
skips, with no message, a box whose engine cannot run.

Related, same script:

- `pnpm store prune` (`:767-768`) runs before "Converging boxes" (`:851`). On
  pnpm 10 it deletes every cached registry metadata file, so a migration that
  runs pnpm `--offline` always finds the cache empty on the server. That was
  the mechanism behind
  [the engine-link failure](2026-10-22-engine-link-spec-migration-fails-on-production.md),
  now fixed with `--prefer-offline`. A comment at the prune step would keep the
  next migration from assuming a warm cache.
- The per-box reinstall check (`:742-746`) compares `package.json` against
  `node_modules/react`. Once a migration rewrites `package.json`, a no-op
  `pnpm install` never updates that marker, so every deploy reinstalls every
  box during downtime. The last four deploy logs show 6 of 6 boxes "installing"
  followed by "Already up to date". A dedicated marker touched after a verified
  install would end that.

## Decision needed

1. Should the CONTROL block run the repair loop only when
   `systemctl is-active -q beebox-hub` reports the services up, and otherwise
   print that activation failed before the restart and exit at once? This is a
   small change and matches the documented behavior.
2. Should a failure before the restart try to start the services again on the
   old tree? The staged tree installs before the live tree does, but nothing
   checks that the live install will behave the same.
