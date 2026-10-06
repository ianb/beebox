---
title: "bbx pub prepare publishes git-annex pointer text when an asset's content is not present"
workstream: publication-home
resolution: implemented
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-publication-home — checking how annexed assets interact with publication source
---

**Closed 2026-10-06:** prepare now refuses any output file whose content is a
git-annex pointer (`isAnnexPointer` from `beebox/src/lib/annex-pointer.ts`, called
in `beebox/src/publish/prepare/core/files.ts`). Detection is by content, so it
behaves the same on every box.

`annex.largefiles` is unscoped, so an image or PDF in a publication's source
folder is an annexed file. In a working tree it is an ordinary unlocked file.
In a fresh clone whose annex content was not fetched, the same path holds a
short pointer text.

`collectPublicationFiles`
(`beebox/src/publish/prepare/core/files.ts`) reads the bytes that are on disk.
It rejects symlinks but does not detect a pointer file. Prepare would publish
the pointer text under the image's name. The file inventory and hashes are
consistent, so no step reports a problem.

This has not been observed. It needs a box clone with missing annex content,
for example a restore that skipped `git annex get`.

A possible fix is small: prepare refuses a file that git-annex reports as a
pointer without content, and names the file. The check needs a decision on how
to detect a pointer (content prefix, or `git annex find --not --in=here`) and
whether a non-annex box skips it.
