---
title: "MAP.md files inside skeleton-hidden subtrees are never refreshed or removed"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: refresh-maps-correctness (worktree-refresh-maps-correctness)
---

`SKELETON_HIDDEN_PATHS` (`beebox/src/core/maps/precheck-ignore.ts`) hides whole
subtrees from maps: the precheck never produces a task inside them. A MAP.md
already present there stays forever, and the MAP.md import line in the directory's
`CLAUDE.md` keeps loading it into agent context.

On the worktree clone of `test1` (2026-09-18), three such files exist:
`_content/chat/MAP.md`, `_content/inbox/MAP.md`, and
`_bookkeeping/archive/MAP.md`. Their headers name pre-one-root paths
(`# Map: store/chat`, `# Map: box/inbox`, `# Map: store/archive`), so the
listings they carry describe a layout the box no longer has.

Resolution is a choice: have finalize (or a migration) delete MAP.md and the
MAP.md import inside hidden subtrees, or report them as an anomaly for the
boxholder. Deleting is the natural reading of "no MAP is generated inside it",
but a hand-written MAP.md in such a directory would be lost.
