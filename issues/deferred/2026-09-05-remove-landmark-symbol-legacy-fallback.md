---
title: "Remove the navigation.symbol legacy-tolerance code once every box has run landmark-symbol"
workstream: sidecar-shell
activate-on: 2026-12-05
category: code-quality
filed-by: agent
discovered-by: Ian
discovered-in: sidecar-shell — docs/implemented-plans/card-symbol.md Track D
priority: normal
---

`docs/implemented-plans/card-symbol.md` Track D folded a landmark's mark into
the standard `symbol` field, migrating `navigation.symbol` up via
`landmark-symbol` (`beebox/scripts/migrate/landmark-symbol.ts`,
registered in `beebox/src/core/migrations.ts`). Readers accept both shapes so
existing boxes keep working before they run the migration. Once every box that
matters has `landmark-symbol` recorded in its `_config/migrations.jsonl`
(including prod boxes — this worktree's box clone is migrated; nothing else has
been), that tolerance is dead weight.

**The exact code that exists only for the legacy shape:**
- `beebox/src/core/landmark/symbol.ts` — `readLandmarkSymbol`'s
  `navigation.symbol` fallback branch (prefer the card's own `symbol`, fall
  back to the nested one).
- `beebox/src/schemas/landmark.ts` — the `symbol` key admitted explicitly on
  `LandmarkObject`, and the `navigation.symbol` field on the landmark schema.
- `beebox/src/core/migrations.ts` — the `landmark-symbol` migration's manifest
  entry itself stays forever (append-only registry), but once no box needs the
  fallback the *runnable* migration script becomes a retired tombstone like
  `box-packageify.ts`.

Safe to remove once every box that matters has `landmark-symbol` in its
`_config/migrations.jsonl`, prod included.

## Generated docs converge before the data does

Noticed 2026-09-06 by another workstream: a box's regenerated
`.agents/skills/beebox-rule-card-landmark/SKILL.md` teaches the new top-level
`symbol` while that box's landmark cards still carry `navigation.symbol` and its
`_config/migrations.jsonl` has no `landmark-symbol` entry. The per-box docs
regenerate from the engine schema on ordinary `bbx` activity, while the data
migration runs on its own schedule, so the two are never in step.

This is benign — readers accept both shapes, new landmarks are written the new
way, and the sweep converges the data later — but it *looks* like a finished
migration in a box that has not run one. Two consequences for whoever picks this
up: do not read a regenerated rule file as evidence that a box has migrated
(check the manifest), and do not remove the legacy fallback on the strength of
the docs having converged.
