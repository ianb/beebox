---
title: "Figure compile route: loose .attach segment match + unbounded process-global caches"
workstream: chores-burn-down
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

3. **`bundleView` cache is blind to edited imports (views side)** — the
   cache keys on the *entry* file's mtime+size, but `bundle: true` inlines
   imports, so editing an imported helper leaves the entry's stat unchanged
   and serves stale compiled output. The figure route now sidesteps this by
   compiling with `cache: false` (2026-07-15), but the *views* system
   (`AgentViewRenderer` etc., which does cache) still has the gap. Proper
   fix: track every input file via esbuild's `metafile` and include their
   mtimes in the freshness check (or hash the dependency set). Found by the
   cross-model route review.

## Implemented in this workstream

This commit resolves item 1: the route now requires the `.attach` directory to
have a real sibling card with the same basename. Items 2 and 3 remain open and
need a cache-eviction and dependency-freshness design.
