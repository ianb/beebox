---
title: "The one-root migration appends a second, unmarked asset ignore block, so the converted box can never be un-ignored"
workstream: unattached
area: beebox
labels: [annex, git]
filed-by: agent
discovered-by: agent
discovered-in: worktree-full-embrace-annex — converting the last manifest-scheme box
---

The v2 to v3 `one-root` migration leaves a box `.gitignore` with **two** copies
of the asset ignore rules. The original managed block survives with its marker
(`# bbx-assets (managed by bbx attachments init-gitignore)`) and its unanchored
patterns (`**/*.attach/**/*.jpg`). The migration then appends a second copy,
path-anchored to the new root (`/_content/**/*.attach/**/*.jpg`) and carrying
**no marker**.

`bbx attachments unignore` rewrites only the marked block. It detects the
unmarked copy, refuses, and tells the operator to delete those 17 rules by
hand. So a box converted by `one-root` cannot reach the annex through the
supported command path.

This is the same failure family as `c47fd2be1`: an asset ignore rule in a
spelling the managed-block machinery does not recognize, hiding asset bytes
from both git and the annex with nothing reporting it. Here it fails closed
(conversion refuses) rather than open, which is the better direction — but it
blocks every v2 box from converting, and the hand edit it demands is exactly
the step an operator can get wrong.

Observed on `~/src/boxes/about` (a scratch box, zero assets) on 2026-09-14
with git-annex 10.20260717. The box had 17 unmanaged rules at `.gitignore`
lines 72-88 alongside the intact managed block at lines 36-55.

Relevant code: `src/core/migrations/one-root-move-plan.ts` builds the move
plan; the managed-block marker and its rewrite live in
`src/core/commands/attachments-gitignore.ts`
(`GITIGNORE_BLOCK_MARKER`, `isManagedBlockLine`).

The tension: the migration is right to re-anchor paths for the one-root
layout, and `unignore` is right to refuse rules it did not write. What is
missing is that the migration should rewrite the block it already owns rather
than append a competing copy. Whether the anchored or unanchored spelling is
the one a v3 box should carry is the open question — `isManagedBlockLine`
only recognizes the unanchored form.

Discovered alongside
[a symlink the same migration cannot map](2026-09-14-one-root-migration-refuses-claude-md-symlink.md).
