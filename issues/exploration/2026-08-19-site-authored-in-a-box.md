---
title: "Author the public site inside a box (dogfood CMS)"
workstream: unattached
needs: [design]
area: callback-box
labels: [soft-launch]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-public-site — walkthrough-prototype design conversation
---

Part of the public site's idea is to demonstrate callback-box *using*
callback-box. Extend that to the site's own production: a box becomes the
authoring environment (the CMS), while the repo's `site/` generator remains
the strict publish boundary.

The developer's framing: make sure desktop-publishing needs are met within a
box ("not that hard — you can just do so"), and let the box **write its own
schema for the pages** — e.g. the walkthrough page's aside vocabulary
(`bee` / `author` / `generated` voices, in `site/fisheye.ts`) becoming a
box-local card schema, with different renderings of pages ("building up a
whole CMS, because that's still a sensible thing to do").

Existing machinery this maps onto:

- Box-local schemas (`config/schemas/`, importing `callback-box/cards`) — a
  `page` card type; its `instructions` carry the aside vocabulary and the
  author-words rule.
- Views attach to cards (`?view=…`) — page preview and alternate renderings
  without new infrastructure.
- Attach dirs + git-annex — images/assets.
- The nugget/aside enforcement stays in `site/` (tolerant box, strict press);
  an export step commits page cards into `site/content/`, preserving
  "generated on deploy from repo content."

What it unlocks: the ⚙️ generated voice gets literal provenance ("this page
is a card; a wakeup regenerated these asides; here's the commit"), and the
✍️ author voice gets its capture surface (the developer annotating page
cards in chat is the elicitation).

First experiment when picked up: `page` schema in a test box, author the
walkthrough prototype as a card there, crude export to `site/content/`.

Related: [public site](../features/2026-07-20-public-site.md),
[Bee Box rename](../decisions/2026-08-19-bee-box-rename.md).
