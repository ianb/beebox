---
title: "Worktree box clones lack attachment binaries — image cards 404 their images"
area: callback-box
filed-by: agent
discovered-in: worktree-lightbox-gestures — every image in the lightbox rendered as alt text
---

In the per-worktree test1 clone (`~/src/box-worktrees/<wt>/test1/`), image
cards exist (`box/inbox/scan-*.attach/photo-*.image.card`) but their binary
attachment directories (`photo-001.attach/photo-001.jpg`) are absent, so
`/api/files/...jpg` 404s and every `<img>` in the UI — including the lightbox —
renders as alt text.

Likely the worktree-clone hook clones without git-lfs binaries (or the
attachments are gitignored/untracked in the source box). Consequence: any UI
work involving images can't be exercised against the worktree box without
hand-planting files. (The lightbox-gestures smoke test worked around it by
injecting a canvas-generated data-URI into the open lightbox.)

Check `~/src/boxes/test1` for whether the binaries exist there; if they do,
fix the clone hook (lfs fetch / include untracked attach dirs). If they don't,
seed a couple of small real images into the demo scans so image UI is testable
at all.
