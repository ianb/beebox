---
title: "knowledge-audit --box crashes on a box package root (needs content/)"
workstream: quick-seeing-p5js
area: callback-box
filed-by: agent
discovered-in: worktree-quick-seeing-p5js — running the figure-canvas-loop audits against the worktree box clone
resolution: implemented
---

**Resolved.** `knowledge-audit run` now routes `--box` through
`resolveAuditBox` (`src/dev/lib/audit-box.ts`), which resolves a v2 package root
*or* its `content/` operational root to the operational root via the shared
`resolveOperationalRoot` helper — so `generateDocs`/`runTest` target the box
(where `.cb-box` lives) instead of ENOENT-ing on the package root. The
context-history ledger keys off the package-root basename either way (so a
`content/` path no longer keys as the useless "content"). The prior nested-box
guard is unchanged and still fires for a bare `test1`. Covered by
`test/dev/lib/audit-box.doctest.md`; docs example updated in
`docs/knowledge-audits.md`. See the commit in the closing note.

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
