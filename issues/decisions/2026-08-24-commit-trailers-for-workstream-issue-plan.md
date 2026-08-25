---
title: "Monorepo commits record no association with a workstream, issue, or plan — though boxes already have a trailer vocabulary and a faceted reader"
workstream: unattached
area: monorepo
needs: [design]
labels: [git, workstreams, issues, provenance]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder wanting structured commit metadata
---

> I feel like we should have more structure in our git commit messages. Like
> trailers that show associations with workstreams, issues, plans, etc.

## What the monorepo's commits actually carry

Trailer keys across the last 400 commits:

```
290  Co-Authored-By
282  Claude-Session
  8  Contract-Unchanged
  1  Updated
```

Two of those are boilerplate the commit instructions append. `Contract-Unchanged`
is the only semantic one, added ad hoc for mobile-contract commits — and it is
the proof that people reach for this when they need it.

**Nothing records which workstream, issue, or plan a commit belongs to.**
Subject lines are structured (194 of 300 use a conventional prefix) and 17 of
300 mention an issue path somewhere in the body, but neither is queryable.

## Association is recoverable only by accident

The one surviving signal is the merge commits `/finish` produces —
`Merge branch 'main' into worktree-<name>` — which name the branch and do end up
on `main`. But `bin/land` is `--ff-only`, so a workstream's *own* commits land
directly with nothing on them. Asking "which workstream produced this line" means
walking merge topology and inferring, and asking "show me everything
`honest-diagnostics` did" has no answer at all.

Meanwhile three separate places already try to record the same association, all
in files rather than commits:

- issues carry `workstream:` (~72% `unknown`/`unattached`, so weak in practice)
- plans carry `workstream:` and an `issues: []` list
- the workstream registry carries `baseSha`

Each is written by hand at a different moment, and none of them can answer a
question about a specific commit.

## The pattern is already built — one layer over

Box repositories have exactly this and it works:

- **`callback-box/src/lib/git-trailers.ts`** defines a trailer-key vocabulary
  (`CONNECTOR_TRAILER_KEYS`: `Pulled-By`, `Created-By`, `Fetched-By`,
  `Pushed-By`, `Sent-By`, …), described as "the trailer-key vocabulary used by
  the history browse UI".
- **`getTrailerFacets()`** (`git-log.ts`) turns them into facets.
- **`history.ts`** exposes those facets as filters, so a boxholder can browse
  box history *by connector*.

So the repo already believes in queryable commit provenance, has a parser, a
facet builder, and a UI for it — applied to box content and never to its own
development history. That asymmetry is the finding: this is adoption, not
invention.

## What has to be decided

- **The vocabulary.** `Workstream:` / `Issue:` / `Plan:` is the obvious start,
  and the box side suggests the shape: a small closed set, grouped into axes.
  Worth deciding whether `Issue:` takes a basename, a repo-relative path, or
  several — and whether a commit may claim more than one.
- **Who writes them, and when.** Hand-written trailers rot; the whole reason
  `workstream:` is 72% empty is that it depends on someone remembering. The
  worktree branch name *is* the workstream, so a `prepare-commit-msg` hook could
  fill `Workstream:` with no human involvement. `Issue:` is harder — the agent
  knows what it is working on, the hook does not.
- **Whether anything reads them.** A trailer nobody queries is ceremony. The box
  side earns its vocabulary because a UI faceted on it. Name the consumer before
  the format: `bin/workstreams` reporting what a stream landed, the workstreams
  app showing an issue's commits, or `/finish` verifying that what it merged
  matches what it claimed.
- **Retrofit or not.** Existing history has none of this. `git notes` can attach
  metadata after the fact without rewriting; whether that is worth it depends on
  the consumer.

## Related

- [No way to know what a workstream covers](../features/2026-08-20-no-way-to-know-what-a-workstream-covers.md)
  — the same missing association from the issue-queue end. If commits carried
  `Workstream:`, "what did this stream actually do" would be answerable from git
  rather than from a field someone had to remember to fill.
- The commit-message convention itself lives in the root `CLAUDE.md`, which is
  where any new required trailer would have to be stated — and it is worth being
  honest that every added ceremony is a thing an agent can get wrong.
