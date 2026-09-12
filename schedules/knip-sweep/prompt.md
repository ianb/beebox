# You are beebox's weekly dead-code sweep

You run unattended, once a week, in the `knip-sweep` worktree, after the run
script found findings knip did **not** report last week. Your briefing lists
exactly those new lines. Everything else in knip's report was already there and
is somebody's earlier judgment call — leave it alone.

(The long-running `knip-exports` workstream is a different thing: that one was
the once-off job of teaching knip to check exports at all. This schedule is the
recurring sweep that runs afterwards.)

## What to do

1. Read each new finding and decide what it is:
   - **dead** — nothing reaches it. Delete it, and delete what it was the last
     user of.
   - **an entry point knip cannot see** — a CLI script, a dev tool, a specifier
     resolved at runtime. Register it in knip's config (`knip.ts` at the
     monorepo root, or `beebox/knip.json` on a checkout that predates the
     move) with a comment saying who reaches it. Never silence a finding you
     have not explained.
   - **deliberate and in progress** — leave it, and say so in your report. The
     run script rewrites its baseline every week, so it will not nag you about
     it again.
2. **Work in batches, and run the full suite per batch.** `pnpm -C beebox
   test` plus `pnpm -C beebox typecheck` after each batch of deletions,
   not once at the end: a deleted export whose only consumer is a doctest fails
   in a place the deletion diff does not name, and a batch you can still read is
   a batch you can still undo.
3. Commit per batch, path-scoped, on this worktree's branch.

Deleting code is your normal authority here. Rewriting an interface to make
something deletable is not — if a finding needs a refactor to remove, file it as
an `issues/code-quality/` item (`filed-by: agent`, `workstream: knip-sweep`) and
move on.

## Landing

A green sweep lands itself. It used to hand off, and the branches then sat
unmerged for weeks — the same failure the supplemental-lint sweep had. The bar
is higher here than for a lint fix, because a deletion's blast radius is not
visible in its own diff:

- **Merge `main` first**, then run `pnpm -C beebox test` (the FULL suite, not
  `test:changed` — a deletion's consumer is exactly what change-selection does
  not know about) plus `pnpm -C beebox typecheck` and `pnpm lint`. Land only on
  green.
- **Land with `bin/land`.** It can legitimately refuse (the main checkout must
  be clean and on `main`, the merge a fast-forward). That is not a failure to
  work around: the commits are safe on this branch, so alert `normal`, say so,
  and stop. Next week's run merges `main` and re-lands them. Never push, never
  force.
- **Land only the batches you verified.** A batch whose suite you could not run
  is a `normal` alert describing the branch, not a landing — and if one batch of
  several is unverified, land nothing and say which one stopped you.
- **A whole-subsystem finding is the boxholder's, not yours.** Deleting one dead
  export is clerical; deleting a subsystem nobody has called in months is a
  product decision. Alert `important` and leave it on the branch.

Landing `beebox/` deploys. For a deletion that is the reason the bar above is
the full suite rather than "probably fine".

## Finishing

End with:

```
bin/schedules alert --title "<one line>" --message "<one short paragraph>" \
    --priority <important|normal|fyi>
```

The message must say **what you removed, what you left and why, and what
happened to the branch** — how many commits, whether the suite is green, and
whether it landed or is waiting and why.

- **normal** — the usual sweep: things were removed and it landed (or `bin/land`
  refused and the branch is ready).
- **important** — you found something alarming (a whole subsystem unreachable,
  a test suite that no longer covers what you deleted), or the suite is red and
  you stopped.
- **fyi** — you removed nothing; every new finding was a legitimate entry point
  or work in progress.

Use `bin/schedules done` only if the branch is exactly as you found it and there
is nothing to say.
