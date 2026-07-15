---
title: "knowledge-audit --box crashes on a box package root (needs content/)"
area: callback-box
filed-by: agent
discovered-in: worktree-quick-seeing-p5js — running the figure-canvas-loop audits against the worktree box clone
---

`pnpm knowledge-audit run --box ~/src/box-worktrees/<wt>/test1` crashes with
ENOENT on `test1/.cb-box` during the doc-regen step (`generateRules`), because
the shape-2 box marker lives at `test1/content/.cb-box`. Passing
`--box .../test1/content` works. The regen path appears to resolve the box
root without the `getBoxShape` nesting logic the rest of the CLI uses —
`docs/knowledge-audits.md`'s `--box ~/src/boxes/test1` example presumably
predates shape 2 or works only for non-package boxes.

Fix direction: route the audit runner's box resolution through the shared
box-shape helper (`src/lib/box-shape*`), and update the docs example. Note
also the existing guard from the earlier incident ("knowledge-audit --box is
a path" memory / nested-box refusal) — whatever changed for that should
cover this path too.
