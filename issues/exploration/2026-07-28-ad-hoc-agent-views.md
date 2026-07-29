---
title: "Ad hoc views — the agent shows something without creating a card to host it"
area: callback-box
filed-by: agent
discovered-in: worktree-todo-annotation — designing the todo-view card surface
---

While settling that the collected-todos surface is a **card** (a `todo-view`
card whose frontmatter is the query —
[todo-annotation plan](../../callback-box/docs/plans/todo-annotation.md)), the
boxholder noted the counter-case: *"Sometimes I think we're going to want ad
hoc views, like the agent able to show something without creating a whole card
to show it."*

The tension: "views attach to cards" (`callback-box/src/core/views/doc.ts` —
no card-less standalone views) makes every surface durable, addressable, and
tended — but it taxes ephemeral display. If the agent just wants to *show* a
filtered list, a comparison, a one-off chart mid-conversation, minting a card
first is ceremony, and the card lingers afterward as cruft (or the agent must
remember to clean it up).

Half-formed directions, none settled:

- Views already render **in chat embeds** — maybe the ad-hoc case is "a view
  invocation with inline params in a chat message," no file at all.
- Or ephemeral cards with a TTL/scratch location the housekeeping sweep
  cleans.
- Or accept the ceremony: creating a card *is* how you show something, and
  the real fix is making card creation cheap enough not to feel like
  ceremony.

Deliberately deferred from the todo-annotation work; the `todo-view` card
covers the durable-surface case. This item is about the ephemeral one.
