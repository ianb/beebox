---
title: "Todos as inline things-to-think-about, not a todo location — and surfaced in the card companion view when that exists"
workstream: unattached
area: beebox
needs: [design]
labels: [cards, ui]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder direction
priority: normal
next-action: reconfirm
---

Today todo handling routes to a **place**: `{% todo %}` annotations are
collected into todo-view plate cards (the implemented
[todo-annotation](../../beebox/docs/implemented-plans/todo-annotation.md)
design — annotation + collector + a stock todo-view card). The boxholder's
direction: that's the wrong emphasis. Todos are **things to think about,
inline** — they live where the content lives, and the reading experience
should surface them *there*, in context, rather than teleporting them to a
list you have to visit.

Two asks:

1. **More inline.** When reading a card that carries todos, they should
   present as prompts-to-think, visible in the flow (and perhaps summarized
   at the card's edge — "3 open things here"), not only harvested elsewhere.
   The collector/list stays useful as an index; it stops being the primary
   experience. Tone matters: "things to think about" is closer to a margin
   note than a task row — the rendering should read that way.
2. **The card companion view** (the boxholder's phrase, "when that's
   available" — the side panel that accompanies a card, not yet built): a
   card's open todos are a natural companion-panel section, alongside
   whatever else lands there. Note the adjacent chat-panel landmark-context
   issue (`2026-08-30-chat-card-panel-missing-landmark-context`) — signs of a
   general "context beside the card" surface wanting to exist; design them as
   one panel, not per-feature bolt-ons.

Related: `2026-07-28-directories-as-viewable-things` (in-place lenses, same
instinct — the view comes to the content), `2026-07-29-verify-todo-annotation-rendering`
(the manual-testing gate on current rendering — still the developer's),
`2026-07-30-plans-as-execution-state` (what a todo IS in a plan doc).
