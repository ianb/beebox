---
title: "One malformed workstream row blanks the whole issues page, and a stray directory is enough to cause it"
workstream: streams-and-issues
area: router
needs: [design]
design: ../../callback-box/docs/plans/workstream-routing.md
labels: [workstreams-app, robustness, dev-tooling]
filed-by: agent
discovered-by: Ian
discovered-in: main session — the issues browser refused to load
---

The issues browser showed only:

```
Couldn't load workstreams: bin/workstreams list --json --include-removed
returned an invalid shape at 18.branch
```

Nothing else rendered. The cause was an **empty directory** at
`~/src/callback-worktrees/scratch` — created 2026-08-18 19:28, not a git
repository, no matching branch, containing nothing.

## The chain

1. `bin/workstreams list` treats any directory under the worktree root as a
   workstream, so the stray directory became a row with `branch: ""` and every
   git field `null`.
2. `workstreams-app/src/shared/workstreams.ts:48` declares
   `branch: z.string().min(1)`, so that row fails validation.
3. `workstreams-app/src/server/workstreams-command.ts:118` runs `safeParse` on
   the **whole array** and throws `InvalidWorkstreamsShapeError` on any failure.

So one meaningless row took down every workstream, issue, plan, and
testing view. Removing the empty directory restored it (45 rows, none with an
empty branch).

## Two defects, and the second is the one that matters

**The list should not claim a non-worktree is a workstream.** A directory with
no `.git`, no branch, and no registry history is not a workstream in any sense
the consumer cares about. Either skip it or emit it with an explicit broken
state — but do not produce a row that says "workstream named scratch" with a
blank branch.

**A malformed row must not blank the page.** This is the real bug. The current
shape is all-or-nothing: the page either renders every row or renders none. For
a *display* surface that is the wrong failure mode — it turns a one-row data
anomaly into a total outage of four views, with an error message that names a
JSON path and nothing actionable.

Per-row `safeParse`, rendering what parses and surfacing what does not, keeps
the anomaly visible without hiding the other 44 rows. Note the repo's own
posture here: fail-closed is right for authorization and wrong for rendering.

## Worth deciding, not assuming

- **Should `branch` be required at all?** `--include-removed` deliberately
  surfaces entries whose worktree is gone. A removed entry has no branch by
  definition, so `.min(1)` may be modelling a thing that isn't true — in which
  case the schema is the bug, not the row.
- **Where did the directory come from?** Worth a look: something created an
  empty dir under the worktree root and left it. If a failed
  `workstreams create` can leave that behind, the same outage recurs on the next
  failure. (A related near-miss the same day: an invalid worktree name reached
  the launcher and opened a session called `--help`, since fixed.)
- **Is anything else parsed all-or-nothing** from a CLI whose output grows a
  row per directory on disk? The same shape would produce the same outage.
