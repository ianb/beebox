---
title: "generate-image trick resolves relative output paths against shell cwd but labels them box-root-relative"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: main — production box feedback triage (bbx feedback)
priority: important
resolution: wontfix
---

> Closed 2026-09-24 (boxholder): `generate-image` is a box-authored trick, not part of beebox, and the box copy already resolves relative paths against the box root (dated 2026-07-23) with a `BBX_GENERATE_IMAGE_NO_COMMIT` switch. The two beebox-side points moved to [trick auto-commit](../../bugs/2026-09-21-trick-auto-commit-whole-tree-race-and-secrets.md): auto-commit makes a misplaced output permanent, and relative path arguments to tricks have no shared convention.

The `generate-image` trick accepts a relative output path and prints a banner
claiming the resolved path is box-root-relative. In practice the path is
resolved against the shell's current working directory, not the box root.

Observed twice in one box:

1. Run from a nested content directory (several levels under the box root)
   with an output path that repeated that same nested prefix. The trick
   resolved it relative to cwd, producing a doubled directory tree (the same
   path segments nested inside themselves), while the banner still reported
   the box-root-relative form. The trick then auto-committed the misplaced
   card, so the mistake was captured in git before it was noticed.
2. Run from the box root with a path meant to be relative to a deeper
   directory; the trick silently created a new top-level directory at the box
   root instead. A subagent batch repeated the same mistake and left a full
   duplicate set of cards there that had to be removed by hand.

Agent shells reset their working directory between tool calls mid-session, so
"just cd first" is not a reliable workaround from the calling side — the fix
belongs in the trick.

## Suggested directions

- Resolve relative output paths against the box root always, matching what
  the banner already claims.
- Or: reject/warn when the resolved path would create a doubled path segment
  or escape an expected content directory.
- Print the resolved absolute path prominently before the (paid) model call,
  so a wrong resolution is visible before cost is spent.
- Because the trick auto-commits on success, a wrong-path generation currently
  costs a git revert plus attach-directory cleanup every time; a `--no-commit`
  flag, or a confirm-before-commit step when a new top-level directory is
  about to be created, would make the mistake cheap instead of sticky. This
  auto-commit behavior is also the subject of a separate, more general finding
  about `bbx trick`'s commit step (see the trick-auto-commit issue filed in
  this same triage).

## Why resolution is not obvious

The correct base for "relative" is a design choice (box root vs. an
in-progress content directory the caller has in mind), and the fix needs to
hold for every trick that accepts a path argument, not just this one.
