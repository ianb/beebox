---
title: Photo-batch uploads bypass git-annex (raw blobs + manifest-scheme files post-conversion)
---

The prod boxes converted to git-annex on 2026-07-31 (migration commit pair
present, `annex.version 10`, real objects on disk). But the
photo-batch-upload flow ran on one box the same evening and later, and:

- committed multi-megabyte JPEGs as **plain git blobs** (mode 100644, raw
  JFIF bytes in the object — verified on a photo in a delivered batch's
  attach directory), not annex pointers;
- wrote **old-style asset manifests** (`{"files": {..., "sha256"}}`) beside
  them, a scheme the annex conversion is supposed to retire;
- a later batch (2026-08-01) writes a different, small metadata sidecar
  (`{"filename","captured","source"}`) — also named `manifest.json`,
  confusingly — and was left staged uncommitted.

Suspected causes (updated 2026-08-01 after the annex verification pass:
`cb doctor annex --check` passes 7/7 on that box INCLUDING the `hook`
check — the pre-commit hook is installed and `annex.largefiles` matches the
asset classifier, so "missing hook" alone doesn't explain it):

1. **The photo-batch-upload flow still writes manifest-scheme files**
   post-conversion (chat-photo-batch-upload feature — separate worktree),
   and may commit via a path that bypasses the pre-commit hook (e.g.
   plumbing-level commit, or `--no-verify`).
2. **Timing**: the 07-31 batch may have been committed in the window after
   conversion but before the hook was installed; the hook being present
   *now* doesn't date its installation. If so, the writer bug still stands
   (old-scheme manifests) but new batches would annex correctly — worth
   testing with the next batch.

Consequences: repo bloat (megabyte blobs in git history), scheme drift, and
the scanner-ingest Track 0 assumption ("annex unconditionally") is met at
the box level but violated by this one flow. Cleanup needs a decision:
migrate the existing raw blobs into annex (history already has them either
way) and fix the writer.

Also: the sidecar-vs-asset `manifest.json` name collision made this hard to
diagnose (two unrelated formats, same filename) — worth renaming the
metadata sidecar.
