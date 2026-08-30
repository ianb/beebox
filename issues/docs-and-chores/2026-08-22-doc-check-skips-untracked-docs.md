---
title: "doc-check passes a brand-new doc it would reject once staged"
workstream: unattached
area: beebox
filed-by: agent
discovered-in: worktree-user-stories-refresh — writing a plan doc and validating it before committing
---

`doc-check` discovers its inputs with `git ls-files` (`src/dev/doc-check.ts:76`),
which lists only tracked files. A newly written doc is invisible to it, so
running `pnpm doc-check` to check your work reports success, and the same check
then fails in pre-commit once the file is staged.

Observed: `docs/plans/user-story-journeys.md` written with `status: proposed`.
`pnpm --dir beebox doc-check` exited 0. `git commit` failed with
`invalid plan status` (the valid set is in `src/dev/doc-frontmatter.ts:6`).
Nothing about the first result said "this file was not examined".

That is the wrong way round: the moment you most want the check is while writing
a doc, and that is the only moment it does not run.

The sibling tool already resolves this. The docs browser reads
`--cached --others --exclude-standard` (`bin/router-docs.ts:355`) with a comment
saying why — "so in-progress, never-committed docs show up too" — and the
monorepo CLAUDE.md describes that set as the convention ("reads every `.md` in
that worktree — tracked or new-but-uncommitted, respecting `.gitignore`").
`doc-check` is the outlier.

**One wrinkle worth deciding rather than assuming.** The checks are not all alike
under this change:

- *Frontmatter validity* and *broken references* should clearly include
  untracked docs — that is the whole point.
- *Orphan detection* should probably not. A doc nobody links to yet is the normal
  state of a draft, so including untracked files there would flag every new
  document until it is wired up, which trains people to ignore the output.

So the fix is likely "widen the input set, and keep the orphan check to tracked
files", not a one-line flag change.

Blast radius today is nil — the working tree currently has zero untracked,
non-ignored `.md` files — so this only ever affects documents being written from
here on.
