---
title: "Composer thumbnails and the sent attachments list run in reverse order"
workstream: capture-photo-flow
area: beebox
labels: [low]
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — B-inventory journey walk, 2026-10-08
resolution: implemented
---

> Fixed in `e2d468d33`. Cause: photos picked together encode concurrently, and `addImage` appended each one as its encode finished. A smaller photo picked second usually finished first. The tokens went into the text in pick order, but the thumbnails and the `<attachments>` block (built from `images`) were in finish order. The store now keeps images in id order.

Both B-inventory walks attached several photos in one go. The composer showed
the thumbnails in reverse order, and the sent message listed them reversed.

- Walk 1: thumbnails appeared as 2, 1. The `<attachments>` block in the
  transcript listed `[image#2]` before `[image#1]`.
- Walk 2: the sent message listed `[image#5]` before `[image#4]`.

The agent sees the same reversed order, so "the first photo" is ambiguous when
a person says it.

The cause is not traced. Start where the composer builds its attachment list
and where the `<attachments>` block is serialised. Check whether the list is
prepended instead of appended, or sorted by an unstable key.

Reports: [B](../../../beebox/test/user-stories/journeys/B-inventory/reports/2026-10-08.md) (row 13),
[B2](../../../beebox/test/user-stories/journeys/B-inventory/reports/2026-10-08-2.md) (R2).
