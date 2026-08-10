---
title: "bin/private-issues status misreports the MAIN checkout as state=invalid"
workstream: unknown
area: callback-box
filed-by: agent
discovered-in: main session — boxholder asked to set up private issues, status said invalid
resolution: implemented
---

> **Resolved in `105187ec`** — main-checkout mounts now validate against the private repository's primary tree, and the removal path protects the main checkout.

`bin/private-issues status <main-checkout>` prints `state=invalid` for a **correctly
set up** main checkout. The mount is fine — the symlink resolves to the private
repo's primary tree, `init` confirms "repo already initialized, symlink already
present", and `private-issues/` is browsable. Only the status *classification* is
wrong. This is a "confusing output reads as broken" trap: it made a working setup
look failed.

## Cause

`pi_mount_state` (`bin/private-issues:151`) applies **worktree**-mount logic to
every path, including the main checkout. It derives:

- `PI_NAME = basename(wt)` → `callback-box`
- `PI_BRANCH = "worktree-$PI_NAME"` → `worktree-callback-box`
- `PI_TARGET = "$PI_WT_ROOT/$PI_NAME"` → `~/src/private-issues-worktrees/callback-box`

Then the symlink check (`:176-181`) requires the mount to point at `PI_TARGET` on
branch `PI_BRANCH`. But the **main checkout** correctly symlinks to the private
repo's **primary tree on `main`** (`~/src/callback-private-issues`), per the design
("main → the private repo's primary tree" — `bin/CLAUDE.md`, `issues/CLAUDE.md`).
Primary-tree ≠ `PI_WT_ROOT/callback-box`, and `main` ≠ `worktree-callback-box`, so
it falls through to `PI_STATE="invalid"` (`:180`).

The function has no main-checkout case. It is written for worktrees, but `status`
is a public command a developer naturally runs on the main checkout to check setup.

## Fix direction

Special-case the main checkout in `pi_mount_state` (or in `status`): when
`wt == PI_MAIN`, "valid" means the `private-issues` symlink resolves to `$PI_REPO`
(the primary tree) and the repo passes `pi_repo_valid`, with no worktree/branch
expectation. Keep the worktree logic for every other path.

## Repro

```
bin/private-issues init <main-checkout>     # -> "already initialized" / "ok"
bin/private-issues status <main-checkout>   # -> state=invalid  (should be valid)
```
