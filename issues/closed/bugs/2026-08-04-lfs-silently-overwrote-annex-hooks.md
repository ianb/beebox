---
title: Git LFS silently overwrote git-annex's post-checkout/post-merge hooks on converted boxes
workstream: unknown
resolution: implemented
---

> **Closed 2026-08-06.** The acute damage was repaired in place (all five prod
> boxes now carry identical, correct annex hooks), and the specific cause is moot
> — Git LFS is being retired from the boxes, so it can't clobber the annex hooks
> again. The remaining "nothing detects this" hardening — have `runAnnexDoctor`
> verify the annex hooks exist and invoke `git annex` — is spun out and being built
> in `worktree-annex-doctor-hook-check`.

Found while clearing Git LFS residue off the deployed boxes (2026-08-04).

Four of the five deployed boxes had **no working `git annex smudge --update`
hook**. git-annex installs `post-checkout` and `post-merge` hooks that run its
smudge update; `git lfs install` had overwritten those files with the LFS
versions, and nothing noticed. The one box that never ran LFS still had the
annex hooks intact, which is how the difference showed up at all.

The breakage was invisible: `git annex info` reported a healthy repo, assets
were present, and the boxes served fine. It only surfaced when
`git lfs uninstall --local` removed the LFS-owned hooks and left the paths
empty, at which point comparing the boxes' hook sets made the gap obvious.

Repaired in place by removing the LFS-only hooks, stripping the LFS stanza out
of the merged `post-commit` (which also carries the callback-box url-check
block), and re-running `git annex init` to reinstall the real hooks. Every box
now has an identical set: `post-checkout=annex`, `post-commit=cb`,
`post-merge=annex`, `post-receive=annex`, `pre-commit=annex+cb`.

**The tension:** nothing detects this class of damage. `cb init` runs the annex
doctor's repair pass, but the doctor evidently does not verify that annex's own
hooks are present and are annex's. A box can sit for months with its smudge
hooks quietly replaced by another tool's — or deleted by a user cleaning up —
and the only symptom is unlocked-file content silently not being updated on
checkout or merge.

Worth considering: have `runAnnexDoctor` (`src/core/annex/doctor.ts`) check that
`post-checkout` and `post-merge` exist and invoke `git annex`, and repair them
if not. That would have caught this at any `cb init`. The `post-commit` case is
harder — it legitimately holds both another tool's block and callback-box's own,
so the check would need to be "contains the annex line" rather than "equals the
annex hook".

Also worth knowing: `git lfs uninstall --local` will happily delete a hook file
it recognizes as LFS's, without checking whether it displaced something first.
Any future "retire tool X" cleanup on a box should diff the hook set against a
known-good box afterward.
