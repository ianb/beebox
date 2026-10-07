---
title: "Design session: card Properties do not pull their weight"
workstream: card-reading-properties
needs: [design]
area: beebox
labels: [frontend, properties, cards]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder discussion, 2026-09-27
priority: normal
---

The developer feels that a card's Properties panel does not pull its weight
today, and wants a design session on it. The session should decide what
Properties is for, what it shows, and whether it should exist in its
present form.

What the panel shows today (`beebox/src/frontend/src/components/themes/ThemedFileCard.tsx:76-98`):

- facts about the card (`CardFacts`, `components/themes/CardProperties.tsx`);
- file-specific properties for the card's type;
- the list of views, with "Use preferred view";
- related files and the cards that mention this one (`CardMentions`).

Questions for the session:

- Which jobs does a person bring to Properties, and which of them does the
  panel serve now?
- Which of these belong in the card itself, in the card chrome, or in a
  view, instead of a separate panel? The view picker is one example; see
  [choosing a view keeps Properties open](../closed/bugs/2026-09-27-choosing-a-view-in-properties-keeps-properties-open.md).
- What Properties should show that it does not: for example the card's
  type, its schema fields, its history, or its attachments.
- How it relates to the Source view and to the frontmatter the card already
  shows.

Related: [card chrome controls have no bbx ids](2026-08-23-card-chrome-controls-have-no-bbx-ids.md),
and the [standard card fields review](../closed/code-quality/2026-09-27-review-standard-card-fields.md),
which decides some of what there is to show.
