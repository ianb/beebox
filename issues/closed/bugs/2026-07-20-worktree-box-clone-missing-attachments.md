---
title: "Worktree box clones lack attachment binaries — image cards 404 their images"
workstream: lightbox-gestures
area: callback-box
filed-by: agent
discovered-in: worktree-lightbox-gestures — every image in the lightbox rendered as alt text
resolution: implemented
---

In the per-worktree test1 clone (`~/src/box-worktrees/<wt>/test1/`), image
cards exist (`box/inbox/scan-*.attach/photo-*.image.card`) but their binary
attachment directories (`photo-001.attach/photo-001.jpg`) are absent, so
`/api/files/...jpg` 404s and every `<img>` in the UI — including the lightbox —
renders as alt text.

Consequence: any UI work involving images can't be exercised against the
worktree box without hand-planting files. (The lightbox-gestures smoke test
worked around it by injecting a canvas-generated data-URI into the open
lightbox.)

## Fixed 2026-07-20 — and it wasn't LFS

Root cause is **not** git-lfs and not a broken hook. The source box has the
binaries (69 images in `~/src/boxes/test1`), and **none of them are tracked in
git — by design.** Assets inside `*.attach/` scopes are deliberately gitignored
and tracked by a per-dir `manifest.json` (size + sha256) instead; see
`callback-box/docs/asset-manifests.md` and the `cb-assets` block in the box
`.gitignore`. So `git clone` faithfully reproduces the repository and the bytes
were never in it.

Fixed in `.claude/hooks/worktree-create.sh` by copying the gitignored
attachment binaries after the clone — the same move the hook already makes for
gitignored connector secrets a few lines above, which is the identical problem
shape. It asks git for exactly what it left behind:

```
git ls-files --others --ignored --exclude-standard -z -- '*.attach/*'
```

so it can't drift from the ignore list the way a hardcoded extension list
would, and repo-root-relative paths make it layout-agnostic (v2 `content/` vs
legacy). Verified end to end against `~/src/boxes/test1`: clone alone yields 0
jpgs; with the copy step, 69 (80 files including other attachment types).

**Only affects newly created worktrees.** Existing worktree box clones still
lack their binaries — re-create the worktree, or copy them across by hand.
