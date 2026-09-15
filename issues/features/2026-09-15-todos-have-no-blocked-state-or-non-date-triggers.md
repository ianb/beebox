---
title: "To-dos cannot say they are blocked, and `start` is the only trigger currency"
workstream: unattached
area: beebox
needs: [design]
filed-by: agent
discovered-by: agent
discovered-in: main — a box agent reported that to-dos have no "waiting" state; the boxholder shaped the constraints
---

A to-do that is blocked on the outside world has nowhere to say so, and no way
to come back when the block clears. The design question is what a trigger may
be made of. The boxholder's constraint: **not free text that something must
re-read on a schedule to decide whether it fired.**

## The tension

`deriveTodoPlateState` puts an open to-do in `quiet` when today is before
`start`. That one state carries two unrelated situations:

- **Not yet time** — a project that begins in October. Needs no attention.
- **Blocked on the world** — chasing a refund confirmation, a permit, a reply.
  This is the one that rots, and the one worth reviewing.

Nothing distinguishes them, which is why a box agent perceived a missing
"waiting" status.

The staleness net has a matching hole. `review-sweep.ts` reports a to-do as
`stale` only when it has `created`, is over 45 days old, and has **neither**
`start` nor `due`. Give a blocked item a `start` date so it stops cluttering
the plate, and it becomes invisible to every sweep until that date arrives.
That is correct for a deferral and wrong for a blocker.

## What already exists

Read this before redesigning any of it.

- **Attributes** (`shared/todo-model.ts`, `shared/markdoc-config.ts`), on both
  the `{% todo %}` tag and frontmatter `todos:` entries: `text`, `id`,
  `status`, `assigned`, `by`, `created`, `due`, `start`, and nested
  `see-also`.
- **`start` is already a trigger** — the agent guide calls it "the *surfacing*
  trigger". Its currency is dates, and it is evaluated, not recognized.
- **Plate-states**, derived box-locally: `escalated`, `on-plate`, `quiet`,
  plus the terminal `done` / `dropped` / `parked`.
- **The review sweep** computes `escalated`, `stirring` (crossed `start` since
  the last pass, against a persisted baseline) and `stale`, then queues a job
  card only when one is non-empty.
- **Two standing rules.** The sweep computes, the agent judges, the boxholder
  decides — an agent never silently changes status, except an
  `assigned="agent"` item it finished itself, with `see-also` evidence. And no
  to-do is ever silently dropped; unreadable cards are reported.
- **No mutation command.** `bbx todos` queries; changing a to-do means editing
  the card.

## Directions worth designing

**Bind the trigger to box state instead of prose.** The box is cards and
paths, so a condition like "a card appears under this path" or "this card's
field reaches this value" is evaluable on every wakeup with no judgment. This
generalizes `start` rather than competing with it: a date and a card
appearance are both conditions the collector can test, which keeps one
mechanism with two currencies.

**Connector events may collapse into the same thing.** Connectors sync into
the box as cards, so "the reply arrives" and "a card appears" can be one
trigger rather than two subsystems.

**The prediction problem is the hard part.** An evaluable trigger asks the
author, at capture time, to predict where the evidence will land. Often that
is unknowable — a reply may arrive by mail, by email, or by phone. So the
design must decide what happens when the prediction is wrong, which is
probably a date floor: a trigger that never fires makes the item **late**,
not lost.

**Firing should surface, not transition.** The existing rule is that agents
raise and the boxholder decides. A trigger that performs a status change
inverts that per-to-do. The design should either respect it or overturn it
deliberately.

**A prose `waiting-for` may be worth having on its own**, with no trigger
machinery at all, purely to split `quiet` into "scheduled" and "blocked" and
to give the sweep something to chase. Cheap, and independent of everything
above.

## Ruled out, with reasons

- **A text convention** (`"Waiting on X: ..."` as the first words of `text`).
  Puts a queryable fact where nothing can query it, splits on spelling, and
  entangles the rendering with the marker.
- **A fifth status** (`waiting` beside `open`/`done`/`dropped`/`parked`).
  Blocked-ness is orthogonal to lifecycle, so the enum cannot hold both — and
  the combination it destroys is the valuable one: **blocked *and* overdue**,
  meaning the thing you are waiting for is late.
- **Reusing `assigned`.** It names box-internal labor (absent = the boxholder,
  `"agent"` = the agent). An outside party is not a worker the box can assign.

## Questions the design must answer

1. What is the minimum evaluable trigger vocabulary — and is card appearance
   under a path enough to be useful?
2. Is a date floor mandatory on every non-date trigger?
3. Does a fired trigger produce a new sweep list, or a plate-state?
4. Should a blocked to-do be exempt from the 45-day stale rule, or does it get
   its own, shorter one?
5. Is prose `waiting-for` a first step, or does shipping it make the evaluable
   version harder to adopt later?
