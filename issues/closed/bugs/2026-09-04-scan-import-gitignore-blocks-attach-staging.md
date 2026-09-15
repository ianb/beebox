---
title: "Scan-import/PDF-extract staging fails on a fresh v3 box: the default .gitignore blocks its own attach binaries"
workstream: scan-ingest
area: beebox
labels: [scan, git]
filed-by: agent
discovered-by: agent
discovered-in: worktree-box-layout-criteria — Track A2 (one-root box layout), 2026-09-04
priority: normal
resolution: implemented
---

> **Closed by the full-embrace-annex workstream, 2026-09-14.** Fresh boxes are annex-shaped from their first commit, so the default `.gitignore` no longer hides a box's own attach binaries. The scheme that did is deleted.
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

## Reconfirmed live 2026-09-13 — reproduced, not fixed

The `reconfirm?` guess does not hold: this is still broken, and I reproduced the
mechanism rather than reading for it. On a fresh `makeTmpBox({ git: true })` box
with no annex conversion — the shape a real fresh box has — writing
`_content/inbox/scan-x.attach/page-001.jpg` and calling `stageFiles`:

```
{"ignored":true,
 "rule":"**/*.attach/**/*.jpg	_content/inbox/scan-x.attach/page-001.jpg",
 "staged":"FAILED: The following paths are ignored by one of your .gitignore files:"}
```

`git check-ignore -v` names the stock rule, and the staging call fails, exactly as
filed. `stageFiles` still has no `force` option (grepped `src/lib/git.ts`).

What has changed nearby, and why it is not this: `c47fd2be1` (2026-09-06, "Catch
path-anchored asset ignore rules, not just one spelling") fixed `isAssetIgnoreRule`
missing a path-anchored spelling of these rules, which had left one production box
with every asset reaching neither git nor the annex. Adjacent — same ignore
block — but it repairs the *detection* of those rules, not scan-import's inability
to stage past them.

Field removed. Still open on its original terms: the issue lists three candidate
resolutions and says it needs a product decision, which is the boxholder's call,
not something to pick while reconfirming. The next pass can skip the reproduction
and start from that decision.

## Resolution chosen 2026-09-14 — annex-always, in its own workstream

The boxholder settled the product decision this issue was waiting on: *"I want
every box currently and forever in the future to use annex. So we should just be
making it right, always, and not worry about cases where it isn't right."*

That is a fourth resolution this issue did not list, and it dissolves the bug
rather than handling it: `bbx init` produces an annex box, where the un-ignore
block makes staging work, so there is no manifest-scheme box for scan-import to
fail on. The three resolutions listed above are all superseded — in particular
the `force` option is now known to be actively wrong, since
`findStagedUnlistedBinaries` (`src/core/annex/staged-unlisted.ts:65-88`, wired
at `src/cli/commands/validate-pre-commit.ts:99-103`) blocks any staged
attach-scope blob over 1 MB and scan pages are 2000px q88 JPEGs
(`src/core/commands/scan-import-helpers.ts:113-125`), routinely over — so force
would turn a loud early failure into a loud late one carrying a misleading "run
`bbx doctor annex`" message, and under 1 MB would silently commit raw asset
bytes into history.

Under annex-always, scan-import's own change is an `invariant()` rather than a
graceful refusal: a manifest box becomes a broken invariant, not a supported
state.

**Owner:** `issues/features/2026-09-14-every-box-uses-git-annex.md`, with the
design drafted at `beebox/docs/implemented-plans/annex-at-init.md`. Not being fixed in
`scan-ingest`, which was told to behave as though annex-always already ships.
Kept open until that work lands, since the reproduction in this body is the
regression test that work owes.
