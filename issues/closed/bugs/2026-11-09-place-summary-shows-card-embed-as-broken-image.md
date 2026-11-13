---
title: "A card embed in a landmark's place summary shows as a broken image"
workstream: box-feedback-bugs
area: beebox
labels: [place-page, markdown]
filed-by: agent
discovered-by: agent
discovered-in: "courseware box feedback — Place_Summary_Cannot_Embed_Cards, 2026-11-09"
resolution: implemented
---

**Closed (implemented, 2026-11-09):** PlaceView passes CARD_EMBED_COMPONENTS to the place summary, as card bodies do (box-feedback-bugs).

A box agent put a card embed, `![Title](/path/to/X.some-type.card)`, in a
landmark's body to show a custom view on the place page. The place page
showed a broken image: "Failed to load — Title". The boxholder saw the
failure first. The same syntax embeds the card in a card body and in chat.

## Mechanism

`PlaceView` renders the summary with `<Markdown prose="block" …>` and no card
embed components
(`beebox/src/frontend/src/components/PlaceView/view.tsx:165`). Card bodies
pass `CARD_EMBED_COMPONENTS` (`MarkdownCardView/CardBody.tsx`). Without them,
the image fallback tries to load the `.card` file as a picture.

## Why it matters

The place page is the front door of a place. A live embed (a front page, a
dashboard) keeps it current without hand edits. The docs describe `![]()`
embeds in general and do not name the place summary as an exception.

## Options

- Pass the card embed components to the place summary.
- If embeds there are excluded on purpose (layout, recursion), render a clear
  note and say so in `card-landmark.md`.
