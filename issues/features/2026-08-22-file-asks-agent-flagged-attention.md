---
title: "Let an agent flag a file for the boxholder's attention, without building an exhibit"
workstream: dev-comments
area: monorepo
needs: [design]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-dev-comments — designing document comments
labels: [workstreams-app, exhibits]
---

> **Job to be done:** *When I have built something specifically for the boxholder
> to look at — after a discussion, not as part of routine work — I want to point
> at the file and say so, so it reaches them without me building a page around
> it.*

The boxholder: *"I wish there was a way for the agent to say 'please look at
this, I made it for you to look at'. I'm not sure how that would work. Lots of
code changes aren't/shouldn't be like that, mostly stuff that's deliberately for
me based on discussion."*

Today the only way an agent can raise a hand is an **exhibit** — a directory, a
manifest, a separate origin. Right weight for a constructed page; wrong weight
for "look at this file I already wrote."

## The restraint is the load-bearing half

| Thing | Ask? | Why |
|---|---|---|
| An ordinary code change | **No** | The change is already visible; flagging routine work is how the queue rots |
| Something built deliberately for the boxholder after discussion | **Yes** | The case the mechanism exists for |
| Issues and plans | **No** | Boxholder: *"they don't generally need extra signaling, instead they are always kind of relevant"* — standing queues already |

`workstreams-app/docs/exhibits.md` records what happens without that restraint:
*"An over-applied tag rots the queue it feeds — the `manual-testing` flag did
exactly that… once a marker stops meaning anything, the human stops reading
it."* Whatever gets built, the agent-facing guidance must lead with the negative
cases.

## Why this is a design item and not a schema tweak

The obvious implementation — give the existing ask queue a second subject kind —
runs into three walls, all verified:

1. `askQueueEntrySchema` (`workstreams-app/src/shared/exhibits.ts:74-89`) requires
   `slug`, `permanent`, and a `path` documented as *"Path on the exhibits origin,
   joined to the queue's `origin`"*.
2. `AsksPage` builds every row's link as `queue.origin + entry.path`
   (`AsksPage.tsx:14-16`) — every row is an exhibits-origin URL.
3. Answering deliberately cannot happen on the workstreams origin:
   `workstreams-app/src/server/api/router.ts:71` — *"Read-only: answering an ask
   happens on the exhibits origin, never here."*

A file ask has no exhibits-origin path, no `disposition.json`, and nowhere to be
answered under the current split. So the design question is: **where is a file
ask answered, and what does "answered" mean for one?** Options worth weighing:
answer it in the general browser next to the file; treat it as `fyi`-only so
there is nothing to answer; or give the workstreams origin its own narrow
disposition write, which reopens a boundary that was drawn on purpose.

## Related

- [document-comments](../../beebox/docs/plans/document-comments.md) — the
  boxholder→agent direction of the same channel. This is the agent→boxholder
  direction, and the two should not end up with different vocabulary.
- [general-browser](../../beebox/docs/plans/general-browser.md) — its
  recency feed is where a flagged file would be badged.
