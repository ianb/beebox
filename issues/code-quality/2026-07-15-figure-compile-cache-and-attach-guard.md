---
title: "Figure compile route: loose .attach segment match + unbounded process-global caches"
area: callback-box
filed-by: agent
discovered-in: worktree-quick-seeing-p5js — adversarial review of the figure compile route while adding the canvas-loop runtime
---

Two residual findings from the 2026-07-15 route review (the symlink
containment bypass and cache-key staleness found alongside these were fixed
on the branch):

1. **Loose attach-scope gate** — `routes/figure.ts` accepts any resolved
   path containing *any* segment ending in `.attach`
   (`resolved.split(path.sep).some(seg => seg.endsWith(".attach"))`), rather
   than requiring the segment to be the attach scope of a real sibling card
   (`Name.attach/` next to `Name.<type>.card`). Root-confined (post-realpath
   fix) so not an escape, but it compiles source from directories that are
   not actually card attachments. Tightening means resolving the owning card
   and checking existence.

2. **Unbounded compile caches** — `compiler.ts` module-level `cache` and
   `metaCache` Maps have no eviction and are shared across all boxes the
   process hosts; agents iterating on figures/views grow them for the
   process lifetime. An LRU cap or per-box sweep on box shutdown would
   bound it.
