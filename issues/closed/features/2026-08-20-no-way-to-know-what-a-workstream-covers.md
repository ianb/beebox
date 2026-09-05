---
title: "No way to find which workstream should own a new issue — names carry no scope, and the field is mostly empty"
workstream: streams-and-issues
area: monorepo
design: ../../../beebox/docs/implemented-plans/workstream-routing.md
labels: [workstreams, issues, discovery]
filed-by: agent
discovered-by: Ian
discovered-in: main session — trying to place a new capture issue
resolution: implemented
---

Implemented by the workstream-routing plan: launch records now carry concise
descriptions, the CLI and app expose routing state/action/age, and the launch
skill routes related work before creating a new stream.

Also answered from the commit side: `pnpm commit-provenance --workstream
<name>` lists every commit a stream produced (see
`beebox/docs/implemented-plans/commit-provenance-trailers.md`).

> I think there's a workstream that *should* own this (one that already exists),
> but I'm not sure.

There is no way to answer that. A workstream is a name on a branch; nothing
records what it covers. The only way to infer scope is to grep `issues/` for
items already carrying that `workstream:` value — which mostly fails, for two
compounding reasons.

## The ownership field is largely unpopulated

Counted 2026-08-20 across the open queue:

```
282  unknown
 42  unattached
 23  open-source-readiness
 17  integration-tests
 10  elixir-skills-review
  …
```

**Roughly 72% of the field carries no signal.** Restricted to capture-related
issues, 51 are `unknown`. So the inference-by-grep route is not merely awkward,
it usually returns nothing.

`unknown` is documented as backfill-only — "never written for a new issue" — so
this is historical residue rather than ongoing practice. But it is the bulk of
the data, and it means the field cannot answer questions about the past.

## The field conflates a live owner with a tombstone

Workstreams are deliberately ephemeral: the worktree-session redesign exists
precisely so issues outlive the worktrees that discovered them. The consequence
is that `workstream: elixir-skills-review` may mean *actively owned by a live
session* or *touched once by something collected weeks ago*, and nothing marks
which.

`issues/CLAUDE.md` already separates `workstream:` (ownership) from
`discovered-in:` (provenance), which is the right distinction — but neither
field carries liveness, and ownership by a workstream that no longer exists is
not really ownership.

## What would actually help

Worth designing rather than assuming; three shapes, cheapest first:

- **A one-line description per workstream**, recorded when it is created and
  visible in `bin/workstreams list` and the workstreams app. The launcher
  already takes a briefing — the first line of it is nearly this, and could be
  captured at no extra cost to the person spinning one up.
- **Liveness in the answer.** "Which workstream owns this" should distinguish
  *live*, *dormant but revivable* (branch exists), and *gone*. The registry
  already knows all three; the issue queue does not surface any of it.
- **Reverse lookup as a first-class question.** Given a new issue, what existing
  workstream is closest? Labels and `area:` already cluster issues; a workstream
  inherits a cluster implicitly by what it owns, and nothing computes that.

## Worth noting

The queue has grown past the point where a human holds it in their head — ~300
open issues, 66 workstreams merged in the last fortnight. The `next-action:`
machinery keeps the *queue* navigable; nothing does the same for the
*workstreams*, and placing new work is where that gap shows up.
