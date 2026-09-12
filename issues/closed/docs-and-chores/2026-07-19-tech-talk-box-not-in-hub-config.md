---
title: tech-talk box exists on the prod server but isn't in hub.json
workstream: unknown
priority: important
resolution: implemented
---

Noticed while verifying the fleet for the healthz-aggregation work
([design](../../../beebox/docs/implemented-plans/hub-healthz-box-aggregation.md)):
`/home/beebox/boxes/tech-talk/` exists on the server (its
`node_modules/beebox` symlinks to the shared engine like every other
box), but `tech-talk` is **not** a slug in
`/home/beebox/.config/beebox/hub.json` — so the hub never serves it and it's
invisible to routing, health, and the box picker.

Either it's a leftover that should be removed from disk, or it's a box that
should be added to `hub.json` (which needs a hub restart — the config doesn't
hot-reload). Decide which and do it; unrelated to the health work itself.


## Closed 2026-09-12 — retired, as intended

Boxholder: "I meant to permanently retire tech-talk." The question this issue
posed (leftover to remove, or box to add to `hub.json`?) is answered, and the
removal already happened.

Verified on the server: the boxes directory no longer contains `tech-talk`,
and it is absent from `hub.json` too — which is now correct rather than a gap.

Four empty leftovers remain, none of them box content, all left in place:

- `/home/beebox/.claude/projects/-home-beebox-boxes-tech-talk{,-content}` and
  the two pre-rename twins under the old home path — **0 transcripts
  each**, so nothing to preserve or lose.
- `/home/beebox/box-backups/pre-annex-tech-talk.tar.gz`, 112K — a backup of
  the retired box, deliberately not deleted. It is the only surviving copy.

Historical mentions in `docs/plans/asset-offbox-storage.md`,
`docs/implemented-plans/hub-healthz-box-aggregation.md` and a closed issue are
records of what was true then; left alone.
