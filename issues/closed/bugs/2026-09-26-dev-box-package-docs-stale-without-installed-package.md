---
title: "A box whose node_modules/beebox is not an installed package keeps stale box-docs, because ensurePackageDocs writes to the running engine's own root"
workstream: unattached
area: beebox
labels: [box-docs, dev-boxes, docs-gen]
filed-by: agent
discovered-by: agent
discovered-in: worktree-doc-structure — refreshing ~/src/boxes/test1 after the 2026-09-26 landing
resolution: implemented
---

Closed 2026-09-26 by the no-code direction: `~/src/boxes/test1/node_modules/beebox`
is now a symlink to the main checkout's `beebox/` package, the same shape the
worktree clones and `scaffoldPackageRoot` produce, so the engine's `box-docs/`
is the box's. The stale copy was moved aside, not deleted.

`ensurePackageDocs` (`beebox/src/core/docs-gen/package-docs.ts`, around line
219) writes the package docs to `PACKAGE_ROOT/box-docs/`, where
`PACKAGE_ROOT` (`beebox/src/lib/package-root.ts`) is resolved from the running
module's location. On a production box `node_modules/beebox` is a symlink to
the installed engine, so the two coincide. On the primary dev box
`~/src/boxes/test1`, `node_modules/beebox/` is a bare directory holding only a
`box-docs/` copy; the dev router runs the engine from the main checkout, so
every refresh updates `~/src/beebox/beebox/box-docs/` and the box's copy
stays at whatever was last copied in (2026-09-24 until a hand `rsync` on
2026-09-26).

The agent guide points at `node_modules/beebox/box-docs/` on every card-type
line and in "Where the docs are", and `bbx search` indexes that directory
(kind `engine-doc`), so a dev-box agent reads and searches stale docs without
any signal. `bbx docs refresh` has no way to name the box's package root.

## Direction

Either make the dev box a real package consumer (a `node_modules/beebox`
symlink to the checkout, as the worktree clones under `~/src/box-worktrees/`
already have), or have `ensurePackageDocs` write to
`<boxRoot>/node_modules/beebox/box-docs/` when that path exists and is not the
running package. The first needs no code; the second makes the engine own a
directory inside a foreign `node_modules`. Whichever is chosen, a health check
that compares the box's `box-docs/README.md` against the running engine's
would have caught the two-day drift.
