---
title: History blob URLs don't encode file paths (or decode git's quoted paths)
---

`BinaryFilePreview` builds `/api/history/blob/<hash>/<file.path>` by string
interpolation (`CommitDetail-tabs.tsx`), and `parseDiff` copies `diff --git` /
`rename to` paths verbatim. A repo path containing `#`, `?`, or `%` produces a
URL that requests the wrong blob or 400s; git's quoted-path syntax (for
unusual bytes) is never decoded. Pre-existing behavior — noted during the
history-annex work (Codex review finding), out of scope there. Fix is
`encodeURIComponent` per segment in the frontend plus quoted-path decoding in
`parseDiff` if we care about non-ASCII filenames in history.
