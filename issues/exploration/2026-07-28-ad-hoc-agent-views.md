---
title: "Ad hoc views — the agent shows something without creating a card to host it"
workstream: todo-annotation
area: beebox
filed-by: agent
discovered-in: worktree-todo-annotation — designing the todo-view card surface
priority: backlog
---

While settling that the collected-todos surface is a **card** (a `todo-view`
card whose frontmatter is the query —
[todo-annotation plan](../../beebox/docs/implemented-plans/todo-annotation.md)), the
boxholder noted the counter-case: *"Sometimes I think we're going to want ad
hoc views, like the agent able to show something without creating a whole card
to show it."*

The tension: "views attach to cards" (`beebox/src/core/views/doc/core.ts` —
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

## 2026-10-08: direction from the OpenUI review

Re-encountered while reviewing OpenUI
([research/openui](../../research/openui/README.md)), whose whole premise is
the ephemeral case: a fixed component catalog, streamed one unit at a time,
validated on arrival, no file. The review rejects OpenUI itself (single
vendor, 0.x, React-only catalog, positional-argument DSL) but the shape fits
this issue, and Bee Box already owns the primitive for it.

Proposed direction, the first bullet above made concrete: **Markdoc data
tags in the chat reply.** For example a `{% table %}` whose body is a
Markdown table or fenced CSV with declared column types, and a
`{% chart kind="bar" %}` over the same data, rendered by frontend components.
The data lives in the message; no card is minted. "Keep this" is a copy of
the block into a card body, where it renders identically, so one language,
one validator, and one renderer serve cards, chat, and published pages.

Evidence for the mechanism:

- Markdoc renders an unclosed tag with its partial content
  (`Markdoc.parse` on `{% quote %}hello wor` renders the open tag and reports
  `missing-closing`, checked 2026-10-08), so progressive rendering during
  streaming is already there.
- Named attributes are validated by `Markdoc.validate`, which `bbx validate`
  runs. OpenUI's positional arguments broke when the model wrote a named
  argument ([hands-on §1](../../research/openui/hands-on.md#1-the-language));
  named attributes avoid that.
- OpenUI's structured validation errors (code, path, message, unit id) are
  shaped to be fed back to the model. The data-tag design should give a
  chat turn's tag errors the same shape.

Out of scope by boxholder decision: interactive form or option widgets in
chat ([wontfix 2026-07-10](../closed/features/2026-06-09-in-chat-interactive-questions.md)).
This is display only.
