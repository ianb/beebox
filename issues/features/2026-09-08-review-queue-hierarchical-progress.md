---
title: "Review queues need progress across parent and child cards"
workstream: unattached
needs: [design]
area: beebox
labels: [ui, review]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-paper-cards — planning multi-pane card navigation
---

A basic multi-pane surface can show several cards, but it does not yet define a
review workflow. A reviewer working through a parent and its children needs to
know what remains, what has been handled, and where resuming should return.

Design the review queue and progress model before adding more pane controls.
Questions include whether progress belongs to a card, a saved review session,
or the viewer; how parent completion relates to child completion; how newly
added or removed children affect progress; and how the same review continues on
desktop and mobile. The result should make interruption and resumption safe
without treating merely opening a card as completing it.
