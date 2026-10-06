---
title: "`bbx rm` of an upload-batch card reportedly leaves its `.attach/` scope behind"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-bulk-upload-stranding — end-to-end upload check on test1
---

During an end-to-end bulk-upload check on test1, the box's chat agent filed a
test batch by trashing its card with `bbx rm`. The agent then reported that the
card's `Batch.upload-batch.attach/` directory, which holds the uploaded files,
stayed in `tmp-upload/` and was still tracked by git. The agent moved it by
hand and committed.

`card-upload-batch.md` tells the agent to "delete the card and its attach dir
once everything is placed". A `bbx rm` that trashes only the card leaves the
blobs in the landing zone. The unfiled-batch sweep looks for cards, so it will
not report the leftover scope.

Unverified: this report comes from the agent's own summary and has not been
reproduced. First check: in a test box, run `bbx rm` on a card that has a
sibling `.attach/` scope and see whether the scope moves with it.
