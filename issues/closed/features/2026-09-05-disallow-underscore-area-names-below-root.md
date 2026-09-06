---
title: Disallow underscore-area names anywhere below the box root
workstream: box-layout-criteria
resolution: implemented
---

The v3 root closed vocabulary (`beebox/src/lib/box-root-vocabulary.ts`,
enforced by `bbx validate` and the pre-commit root check) governs only the
root level. Nothing today prevents a directory named `_content`, `_config`,
`_bookkeeping`, `_publish`, or `_tmp` from being created *inside* an area —
e.g. `_content/recipes/_config/` or `_content/_content/`.

Why it matters:

- The display-path vocabulary assumes area names appear only as the first
  segment: bare display paths are `_content`-relative, `Config:`/`Bookkeeping:`
  labels are derived from the first segment. A nested `_content` or `_config`
  makes paths that read like machinery but aren't (and vice versa), and gives
  `detectDisplayFormPath` heuristics ambiguous material.
- The one packageify-era data bug we cleaned up (doubled subtrees, a path
  segment repeated into itself) would have been caught earlier by exactly this
  rule.
- Agents naming a directory `_tmp` inside content is a plausible accident; the
  underscore prefix should stay a reserved, single-purpose signal.

Decision (boxholder, 2026-09-05): `_tmp` MAY nest — it genuinely acts the
same at any depth (the box `.gitignore` ships an unanchored `_tmp/` pattern,
so a nested one is already ignored anywhere). The other four area names
(`_content`, `_config`, `_bookkeeping`, `_publish`) are disallowed below
the root.

Sketch: reject a non-root path segment matching one of those four in
`bbx validate`, the pre-commit check, and at the write path
(`resolveBoxNamespacePath` / `bbx create`/`mv`), with an error naming the
reserved word.

Fleet scan (2026-09-05): the only hits are `_config/_template-updates/…`,
which deliberately mirrors box-relative destination paths (parked template
updates keyed by where they'd land), so `_config/_template-updates/_config/`
etc. are structural, not accidents. The rule needs to exempt that mirror
(or apply only outside `_template-updates`). No other nested area names
exist on any local or prod box.
