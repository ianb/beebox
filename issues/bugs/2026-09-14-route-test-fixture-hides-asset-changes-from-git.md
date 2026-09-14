---
title: "The route-test fixture box hides asset content changes from git, so any route test that rewrites an asset silently proves nothing"
workstream: full-embrace-annex
area: beebox
labels: [annex, git, testing]
filed-by: agent
discovered-by: agent
discovered-in: worktree-full-embrace-annex — running the suite after assets became git-tracked
---

In a box produced by `makeTestServer` (`test/helpers/test-server.ts`), a
same-size overwrite of a committed, annexed asset is invisible to git.
`git status` is empty, `git diff` is empty, and `git update-index --refresh`
does not shake it loose. The working file holds the new bytes; git and
git-annex both report the box as clean.

A box produced by `makeTmpBox`, and a real box produced by `bbx init`, both
report the same overwrite correctly as ` M`.

**This was first filed as a production data-loss bug on the file-delete route.
That was wrong, and the correction is the point of this rewrite.** The delete
route's preservation step (`src/webapp/routes/api-files.ts:297-303`) gates on
`pathsHaveChanges`, so on a box with this defect it would skip the "Saved
before user delete" commit and lose an uncommitted edit. But no real box has
the defect — only the test fixture does — so the route is not affected. What is
affected is every route test that writes an asset and then asserts on git
state.

## Reproduction

```
makeTmpBox({ git: true })   → write "version 1", commit, write "version 2" →  M
makeTestServer()            → write "version 1", commit, write "version 2" →  (clean)
```

Both 9 bytes, so the sizes match. A different-LENGTH second write is detected
in both.

## Ruled out

Each of these was tested and is NOT the cause:

- **Git's stat cache / racy-git.** Plain git (no annex) detects the same-size
  overwrite immediately. Measured index mtime and disk mtime differ by ~1s.
- **Inode reuse.** Rewriting via temp-file + rename, which gives the file a new
  inode, is still reported clean.
- **`cp -r` of an annexed box.** A shell `cp -r` copy of a real `bbx init` box
  detects the overwrite correctly.
- **A stale copied annex UUID or keys database.** Deleting `.git/annex` in the
  clone and re-running `annexNewBox` gives it a fresh UUID and a fresh keys
  database. The symptom is unchanged. (That change was reverted — it costs a
  `git annex init` per route-test server boot and bought nothing.)
- **Configuration drift.** Both fixtures report `filter=annex`,
  `annex.thin=false`, `annex.version=10`, and an unadjusted `refs/heads/main`.

## Unresolved

Why the template-clone box behaves differently is not established. The
remaining difference between the two fixtures is that `makeTestServer` copies a
prebuilt template directory with `fs.cp` and then commits into the copy,
whereas `makeTmpBox` runs `git annex init` in the directory it will use. The
mechanism inside git-annex that makes the clean filter emit a stale pointer
there has not been identified, and guessing at it twice has already produced
one wrong fix and one wrong severity assessment.

## Why it matters

The fixture is lying about the exact property this seam's tests exist to check.
`c47fd2be1` left a production box with 536 assets in neither git nor the annex,
and the reason it went unnoticed is named in
`issues/closed/bugs/2026-09-04-scan-import-gitignore-blocks-attach-staging.md`:
the fixture never ran the real init. This is the same shape — a box that looks
annexed and does not behave annexed — one layer further in.

Concretely: a route test that writes an asset, rewrites it, and asserts that
git noticed will pass whether or not the code under test is correct.

## First step

Establish the mechanism before changing anything. A bisect between the two
fixture construction paths — copy-then-commit versus init-in-place — with
`git annex --debug` on the clean filter would show which branch it takes.
