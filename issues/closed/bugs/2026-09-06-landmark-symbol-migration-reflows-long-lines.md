---
title: "landmark-symbol.ts's frontmatter rewrite can reflow long scalar lines"
workstream: card-visibility
area: beebox
priority: normal
labels: [migrations, yaml]
filed-by: agent
discovered-by: agent
discovered-in: card-visibility worktree, Track D, writing the landmark-links-prominence migration (a sibling of landmark-symbol.ts)
resolution: implemented
---

> Closed 2026-09-06 (card-visibility, Track E): fixed in the same worktree with doctest cases — see the plan `beebox/docs/plans/card-prominence.md`.

`scripts/migrate/landmark-symbol.ts`'s `rewriteLandmarkSymbol` edits the
frontmatter YAML document in place (`parseDocument` + `.set()`/`.delete()`)
and reserializes with a bare `doc.toString()`. `yaml`'s default `toString()`
wraps scalars at ~80 columns — for a landmark with only short `label`/`symbol`
lines this never shows, but any landmark whose frontmatter carries a longer
scalar (a long `label`, a `destinations[].rules` string) would get the WHOLE
frontmatter block reflowed on migration, not just the two keys the migration
touches — the exact "surgical edit, not a whole-file reflow" property the
migration's own doc comment promises.

Found while writing `landmark-links-prominence.ts` (Track D,
`docs/plans/card-prominence.md`): its own `markPrimary` hit the identical bug
against real `test1` cards (long `contains:`/`note:`/`evidence:` scalars in
`.lesson-plan.card`/`.progress.card`) and was fixed there by passing
`{ lineWidth: 0 }` to `doc.toString()` — the same option
`renderFrontmatterBlock` (`src/cards/frontmatter.ts`) already uses, and for
the same reason (folding a long scalar changes the on-disk diff without
changing meaning).

Fix: add `{ lineWidth: 0 }` to `landmark-symbol.ts`'s
`` `---\n${doc.toString().trimEnd()}\n---${rest}` `` call, and re-run its
doctest (`test/scripts/migrate/migrate-landmark-symbol.doctest.md`) to
confirm the short-line fixtures are unaffected. No test1 landmark actually
has a long enough scalar to trigger this today (confirmed while running
Track D against test1: `landmark-symbol` is one of the box's pending
migrations, unexercised so far), so it hasn't corrupted a real box yet, but
it will the first time a landmark card's `label` or `destinations[].rules`
runs long.

