---
title: "Box engine symlinks: should anything repair a dead link automatically?"
workstream: orama-semantic-search
needs: [decision]
area: callback-box
filed-by: agent
discovered-in: worktree-orama-semantic-search — live-testing semantic search on a local box
---

Found 2026-07-10: 13 of 13 local boxes under `~/src/boxes/` had a dead
`node_modules/callback-box` symlink, so any box-local schema (a `bill`
here, an `outline`/`progress` or `itinerary`/`stop` pair there)
silently failed to load in local CLI use — those card
types vanished from search, validation, and templates with only a
stderr `Warning:`. Prod unaffected (real installs).

**Immediate repair done 2026-07-10**: all 13 links repointed at
`~/src/callback-box/callback-box` (the main checkout); schema loading
verified clean on the schema-bearing boxes. Nothing left broken.

## Research (2026-07-10)

Cause, fully traced:

1. `scaffoldPackageRoot` (`callback-box/src/core/box/package.ts:133-138`):
   when a box lacks `node_modules/`, it symlinks
   `node_modules/callback-box` at **the running engine's own
   `PACKAGE_ROOT`** — an absolute path to whatever checkout ran the
   command — explicitly as a bootstrap: *"Track F's real install replaces
   this symlink with an actual dependency."* For these local boxes that
   real install never happened, so the bootstrap became load-bearing.
2. On 2026-07-04, 08:19–11:56, the box-packageify migration
   (`scripts/migrate/box-packageify.ts:449`, which "reuses
   scaffoldPackageRoot wholesale") ran per-box, baking in each box's
   then-current engine path: twelve boxes → `~/src/callback-mono/…`,
   and `test1` → the `cb-as-library` worktree it was migrated from.
3. That same evening (~20:56, per `~/src/callback-mono.bak`'s mtime) the
   monorepo directory was renamed `callback-mono` → `callback-box`,
   orphaning the twelve; the `cb-as-library` worktree's later deletion
   orphaned `test1`'s. Six days of silent breakage followed.

**Detection implemented 2026-07-10** (the boxholder's call: the health
check owns this, not `cb validate`; and the symlink model stays — one
shared engine link per box means updating the main checkout updates
every local box at once). Two new checks in the health router
(`src/webapp/trpc/routers/health-engine.ts`, doctested):

- `engine-link` (v2 boxes) — error when `node_modules/callback-box`
  doesn't resolve to a readable engine (message carries the dead target
  and the `ln -sfn` repair); warning when a non-worktree-clone box pins
  a `callback-worktrees` checkout (the test1 failure path, flagged
  before the worktree dies).
- `box-schemas` — error when any box-local schema file failed to load
  (the registry recorded failures for `cb status` and "`/healthz`" per
  `schema-load-status.ts`'s own doc, but the health router never read
  them — now it does).

The remaining tension (why this isn't closed): **nothing repairs the
link automatically.** Candidate mechanisms — `cb` self-repairing a dead
link to its own `PACKAGE_ROOT` (changes which engine a box pins, so it
needs a deliberate decision), or finishing the Track F real-install
story locally (but a pinned install would end the update-all-boxes-at-
once property the boxholder wants). Detection now makes breakage loud;
repair remains a human `ln -sfn` guided by the health message.
