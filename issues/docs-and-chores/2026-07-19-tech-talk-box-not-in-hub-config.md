---
title: tech-talk box exists on the prod server but isn't in hub.json
workstream: unknown
---

Noticed while verifying the fleet for the healthz-aggregation work
([design](../../beebox/docs/implemented-plans/hub-healthz-box-aggregation.md)):
`/home/beebox/boxes/tech-talk/` exists on the server (its
`node_modules/beebox` symlinks to the shared engine like every other
box), but `tech-talk` is **not** a slug in
`/home/beebox/.config/beebox/hub.json` — so the hub never serves it and it's
invisible to routing, health, and the box picker.

Either it's a leftover that should be removed from disk, or it's a box that
should be added to `hub.json` (which needs a hub restart — the config doesn't
hot-reload). Decide which and do it; unrelated to the health work itself.
