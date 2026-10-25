---
title: "A per-box unit that hits its start limit stays failed until a deploy or `reset-failed`"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-box-memory-and-crash-recovery — the hub's slow retry covers the resident hub only
design: ../../beebox/docs/plans/per-box-units.md
labels: [box-isolation]
---

On the per-box unit path, a box that fails five starts in five minutes stays
down until a person acts. `beebox/deploy/systemd/beebox-box@.service` sets
`StartLimitBurst=5` and `StartLimitIntervalSec=300`. After the limit, systemd
keeps the unit `failed` until the next deploy or `systemctl reset-failed`.
`beebox/src/hub/socket-provider.ts` does not wake a `failed` unit; the hub
answers 503 with the unit's last journal line.

The resident hub supervisor now retries an `unhealthy` box every 5 minutes
(`UNHEALTHY_RETRY_MS` in `beebox/src/hub/supervisor/crash-backoff.ts`,
[plan](../../beebox/docs/plans/box-memory-and-crash-recovery.md)). The unit
path has no equivalent. The cause of the incident that prompted that work, a
stale admission lock that held for 5 minutes, is fixed on both paths. Any
other repeated start failure still latches a unit.

The unit path is not live yet. Possible remedies: the socket provider issues
`reset-failed` and a start on a slow timer, or on the next request after a
quiet interval; or the unit sets `StartLimitIntervalSec=0` with a longer
`RestartSec`. Either one keeps a crash loop slow and visible in the hub's 503.
