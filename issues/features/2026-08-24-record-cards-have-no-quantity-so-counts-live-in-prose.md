---
title: "Counting things is a core inventory job, and a record card has nowhere to put a count"
workstream: unattached
area: callback-box
labels: [soft-launch, journey-findings]
filed-by: agent
discovered-by: agent
discovered-in: worktree-user-stories-refresh — journey B, 2026-08-24 walk
---

When I am cataloguing a drawer, I want the box to know how many of a thing I
have, so that in a shop I can ask "do I have glue sticks?" and get an answer I
can act on without reading a paragraph.

The walk did exactly this and it worked, once: "do I have a glue stick?" →
*"Yes — four… Don't buy a fifth."* Ten seconds. That is the job, and the
product did it.

**But the count is not stored anywhere.** `record.tsx` gives a record `name`,
`contains`, `description`, `location` and `sources`. There is no quantity
field. The four glue sticks exist only inside an English sentence, alongside
counts like "roughly 15–20" in
`store/inventory/Pens_and_Markers.record.card`.

Two consequences, both of which arrive later than the walk could see:

- **Updating a count is a prose rewrite.** "I'm down to three" cannot be a
  field edit; something has to re-author the sentence without disturbing the
  rest of it.
- **Answering a count is reading comprehension**, re-derived from prose on
  every question, with no way to sum, sort, or notice that a number has gone
  stale.

The agent had also promised a field that does not exist. It offered an item
card type *"with location and quantity fields"* and described the plan as "one
card for glue sticks, qty 4" — then created records with no such field. So the
model the user was given and the model on disk disagree from the first minute.

The walker named this as the thing that will rot: over six containers and
months of corrections, a count kept in prose is where drift starts. That is a
prediction, not an observation — the walk only covered one tray — but it is the
kind that gets more expensive to fix the longer the box runs, because by then
the prose counts are real data that has to be migrated.

Worth deciding alongside it: whether a count belongs on `record` at all, or
whether an inventory item is a different card type from a record of a place.
Related: [collection-views-are-badly-defined](2026-08-19-collection-views-are-badly-defined.md).
