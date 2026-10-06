---
title: "The card view shows `contains` on every card; it's an internal field and belongs in Properties"
workstream: quick-wins-oct
area: beebox
labels: [cards]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder report, 2026-09-29
priority: important
resolution: implemented
---

> **Resolved** in `5cf62c6e6`.

`contains` is a one-line summary of a card, written for agents and search: `Browse` lists show it under each entry, and the search index uses it. The boxholder sees it as internal, and it shouldn't appear in the body of every card. Properties is probably the right place to show it.

**Why it shows.** `MarkdownCardView` (`beebox/src/frontend/src/components/MarkdownCardView/view.tsx:85`) passes every frontmatter field to `FrontmatterFields` except `theme`, and except `title` outside embeds. Every card that has `contains` renders it as a labelled field above the body.

**The same question for the other global fields.** `GLOBAL_CARD_FIELDS` (`beebox/src/cards/schema.ts:100`) adds `contains-evidence`, `symbol`, and `prominence` to every schema, and none of them is filtered either. `contains-evidence` is internal in the same way as `contains`. `todos` renders as a todo list on purpose and stays.

**Fix direction.** Decide which fields are for reading and which are for Properties, and filter by that list rather than by adding names to the one at `view.tsx:85`. Check that Properties still shows the hidden fields, and that the `Browse` list's `contains` line is unaffected.

Related: [review the standard card fields](../code-quality/2026-09-27-review-standard-card-fields.md) (the `card-fields-review` workstream is reviewing the global fields) and [card Properties design session](../../features/2026-09-27-card-properties-design-session.md).

## Next-action note (2026-10-06)

The developer's message: "I think contains could go in properties". That is
the direction the `quick-wins-oct` workstream is implementing: hide `contains`
and `contains-evidence` from the reading view and keep them in Properties.
