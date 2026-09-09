---
title: "Scan-import/PDF-extract staging fails on a fresh v3 box: the default .gitignore blocks its own attach binaries"
workstream: unattached
area: beebox
labels: [scan, git]
filed-by: agent
discovered-by: agent
discovered-in: worktree-box-layout-criteria — Track A2 (one-root box layout), 2026-09-04
priority: normal
---

`bbx scan-import` (photo flow and PDF extraction) writes originals and derived
images straight into `_content/inbox/<session>.attach/…` and stages them with
`stageAndCommitPaths` (`src/core/commands/scan-import.ts`,
`src/core/commands/pdf-extract.ts`) — a plain `git add`, no force flag
(`stageFiles`, `src/lib/git.ts:230`).

Every freshly-scaffolded box's default `.gitignore` (manifest-scheme boxes —
`bbx init`/`scaffoldBoxRoot`, `src/core/box/index.ts`) carries
`GITIGNORE_BLOCK` (`src/core/commands/attachments-gitignore.ts`), which
ignores `**/*.attach/**/*.<ext>` for every asset extension — `.jpg`, `.avif`,
`.pdf` included, with no exemption for scan-import's own output. So on any
box that has not converted to git-annex (the default), staging these files
fails outright:

```
The following paths are ignored by one of your .gitignore files: …
hint: Use -f if you really want to add them.
```

Reproduced via `test/core/commands/scan-import-photo-flow.doctest.md` and
`test/core/commands/pdf-extract.doctest.md` against a
`makeTmpBox({ git: true })` box with no `annex: true` — exactly the shape a
real fresh box has.

Why it went unnoticed until now: the old `makeTmpBox` never ran the real
init, so fixture boxes had no asset-ignore block and raw staging succeeded.
The shapeVersion-3 `makeTmpBox` scaffolds the production `.gitignore`, which
surfaced the failure; the scan/pdf/bulk-upload doctests now declare
`{ annex: true }` (asset bytes visible to git) so they pass — that matches
annex-converted boxes but leaves the manifest-scheme path untested and, on a
real pre-annex box, broken. Not introduced by the one-root work: `git log`
shows `scan-import.ts`/`pdf-extract.ts`/`git.ts` untouched since before it.

Needs a product decision, not a mechanical fix: route scan-import/pdf-extract
asset writes through the manifest/annex-aware staging path (write per-dir
`manifest.json` entries on manifest-scheme boxes; stage bytes on annex
boxes); or exempt scan-imported originals from the ignore block / give
`stageFiles`/`stageAndCommitPaths` a `force` option these callers opt into;
or decide scan intake requires an annex-converted box and fail with a clear
message.
