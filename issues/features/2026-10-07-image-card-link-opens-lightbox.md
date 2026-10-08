---
title: "A link to an image card should open the image in the lightbox, not navigate to the card"
workstream: unattached
area: beebox
labels: [ui]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder request
---

When a chat message or a card links to an image card as an ordinary link (not
an inline embed), clicking it navigates to the image card's page. What the
person wants is to look at the image. Opening the card is rarely wanted.

## Wanted

- Clicking a non-inline link to an image card opens the image in the existing
  lightbox (zoom, pan, close), over the current page, without navigating.
- The lightbox offers a small control to open the card itself, for the rare
  case someone wants its properties, history, or notes.
- Modified clicks keep normal link behavior (open in new tab, copy link).
- Several image-card links in the same message or card: the lightbox steps
  through them in document order, the way it already does for inline images.

## What exists

- The lightbox: `beebox/src/frontend/src/components/LightboxProvider.tsx`
  (`useLightbox()`, `openList(images, index)` and `openFromElement`, which
  collects `data-image-src` markers in document order) and
  `ImageLightbox.tsx`.
- Card links render through the shared link handling for card refs (the
  Markdown renderer and the view widgets `CardLink`/`CardRef`); the link
  knows the target path, and an image card is identified by its filename
  type. The lightbox needs the image's file URL, resolved the same way the
  image card's own view resolves it.

Check every surface that renders card links: chat messages, Markdown cards,
custom views, and the iOS web view (tap, with the lightbox's mobile gestures).
