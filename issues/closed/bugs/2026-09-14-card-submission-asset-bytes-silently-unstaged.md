---
title: "Card submission asset bytes reach neither git nor a manifest, with no error"
workstream: unattached
area: beebox
labels: [scan, git]
filed-by: agent
discovered-by: agent
discovered-in: worktree-scan-ingest — research for 2026-09-04-scan-import-gitignore-blocks-attach-staging, 2026-09-14
resolution: implemented
---

> **Closed by the full-embrace-annex workstream, 2026-09-14.** `acceptSubmission` now asserts the box is annex-shaped before writing any bytes (`assertAnnexBox`), and assets are no longer gitignored, so the directory pathspec stages them.
`acceptSubmission` (`src/core/cards/accept-submission.ts:152-200`) writes a
submission's image bytes into an attach scope and stages at `:195-199` by
naming the *directory*. `git add <dir>` silently skips ignored contents, so on
a manifest-scheme box the stock asset-ignore block
(`GITIGNORE_BLOCK`, `src/core/commands/attachments-gitignore.ts`) drops every
asset byte: they are not committed, not in a `manifest.json` (nothing on this
path calls `saveManifest`), and not in `git status`. Exit code 0.

This is the same ignore-block seam as
`2026-09-04-scan-import-gitignore-blocks-attach-staging`, and the opposite
failure shape. There, individual asset files are named, so `git add` exits
non-zero and the user at least sees an error. Here the pathspec is a directory,
so the loss is silent — which is worse, and is why this is filed separately
rather than folded into that issue's resolution.

The manifest scheme no longer has a claim hook to catch this later: the
installed pre-commit hook (`src/core/install-validation-hooks.ts:210-260`) runs
only `git annex pre-commit` (gated on `.git/annex/`) and
`bbx validate --pre-commit`; `scanBoxAttachments` runs only from
`bbx attachments verify`/`migrate` and `to-annex`'s preflight. So bytes written
this way stay unrecorded until someone happens to run
`bbx attachments migrate` — the state `c47fd2be1` found on a production box
(536 assets in neither git nor the annex, found only by running
`git check-ignore` per box).

Production boxes are all annex-shaped, where the un-ignore block makes this
path work, so this is a fresh-box bug: `bbx init` always produces a
manifest-scheme box. Whatever resolution the scan-import issue takes should
cover this call site, and `connectors/gmail-threads.ts:135-142` →
`connectors/gmail.ts:175-186`, which fails the loud way on the same seam.

Not reproduced — read from the code while researching the scan-import issue.
Reproducing it wants a browser-task or card submission carrying an image on a
`makeTmpBox({ git: true })` box, asserting the bytes are neither committed nor
manifest-listed.

## Owner assigned 2026-09-14 — annex-always

Same resolution as the sibling scan-import issue: the boxholder decided every
box uses git-annex, now and forever, so an annex-shaped box un-ignores assets
and the directory pathspec at `:195-199` stages the bytes normally. Tracked
under `issues/features/2026-09-14-every-box-uses-git-annex.md`.

This one still needs its own test after that lands, and the assertion has to be
on the filesystem — bytes committed — rather than on the return value, because
the defect is that the return value already says success.
