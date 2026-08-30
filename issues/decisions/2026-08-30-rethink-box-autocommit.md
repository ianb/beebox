---
title: "Autocommit causes a lot of issues — decide how box content commits should actually work"
workstream: unattached
needs: [design]
area: beebox
labels: [cards, git]
filed-by: agent
discovered-by: Ian
discovered-in: main session — "autocommit causes a lot of issues; we should think about how to handle it"
---

The box commits its own content automatically (after agent turns, procedures,
capture delivery, generated-docs refreshes, migrations — every writer path
ends in a commit). The boxholder's verdict: **autocommit causes a lot of
issues**, and the handling deserves a deliberate decision rather than more
per-symptom patches.

The symptom trail this month, as the evidence base (each was treated
separately at the time):

- **Dirty-tree wedges**: a prod box skipped its generated-docs refresh on
  deploy ("Working tree is not clean") — an uncommitted half-state blocked an
  automated writer.
- **Lock contention**: `git-lock.doctest` flakes; concurrent writers (chat
  turn + sweep + refresh-maps) racing one index.
- **History noise / weight**: one box's repo at 21G with media committed
  twice (working copy + objects); commit-per-turn makes history unreadable and
  unbrowsable as a record of *meaningful* change.
- **Mid-state commits**: a commit can land between an agent's coordinated
  edits, capturing a half-written card (the same class as the deploy's
  wait-for-quiet dance).
- **Push interacts**: [git-push-confirmation](2026-07-20-git-push-confirmation.md)
  is downstream — what gets pushed is whatever autocommit produced.

Directions worth weighing (the decision, not a menu to implement):

- **Turn/operation-scoped commits**: one commit per agent turn / procedure
  run / capture, with a queue serializing writers — commits become meaningful
  units with real messages, and locks stop racing.
- **Checkpoint cadence**: commit on quiet (debounced), like an editor's
  autosave→snapshot split; between checkpoints the tree is honestly dirty.
- **Keep commit-per-write but fix the writers**: single writer process/queue
  (the event-bus/registry pattern), which fixes contention and half-states
  but not noise or weight.
- Orthogonal but same review: what belongs in git at all (media → annex),
  and whether generated artifacts (MAP.md, agent docs)
  commit separately from content.

Whatever wins must keep the properties autocommit exists for: nothing is
ever lost, every agent change is attributable (the History surface reads
trailers), and cross-machine sync stays possible. A design session should
start by enumerating every writer that commits today.
