---
title: Worktree box trash never fully deletes — git-annex objects are write-protected
---

`worktree-remove.sh` (and sweep) trash a removed worktree's box clone to
`~/.cache/callback-box/trash/` and background-`rm -rf` it. git-annex marks its
object files read-only (`.git/annex/objects/**` with `chmod a-w`), and plain
`rm -rf` fails on them on macOS — so every trashed box leaves its annex
objects behind permanently. Observed 2026-08-04: ~15 `box-*` remnant trees
totalling **547 MB** in the trash dir, one per removed worktree since annex
conversion.

Fix shape: `chmod -R u+w "$TRASH_ENTRY"` before (or instead of a bare)
`rm -rf` in the background-delete — both in `worktree-remove.sh` and any other
path that deletes a cloned box (sweep's orphan cleanup if it has one). Also do
a one-time manual purge of the accumulated remnants.
