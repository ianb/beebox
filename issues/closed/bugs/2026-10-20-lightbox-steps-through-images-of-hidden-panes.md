---
title: "The lightbox steps through images in minimized or hidden panes"
workstream: unattached
area: beebox
labels: [ui]
filed-by: agent
discovered-by: agent
discovered-in: worktree-card-reading — image-card links open the lightbox
resolution: wontfix
---

Closed 2026-10-20: the boxholder accepts images from minimized cards in the viewer's list, since the viewer shows each one at full size.

Opening an image collects every `[data-image-src]` marker in the whole
document (`LightboxProvider.tsx` `collectImages`). Cards in a minimized
workspace stay in the DOM, so their images join the list. In a check, a photo
opened from a chat message showed "2 / 2": the first entry was an image card
open in the minimized workspace, not anything in the conversation.

The person sees a count and previous/next images that do not belong to what
they are reading. The behavior predates image-card links; those links make it
more frequent because a chat message and a card often name the same photos.

A scope for the list (the clicked element's message, card, or pane) would fix
it. Chat's bulk `data-image-list` for virtualized messages has to stay
reachable from that scope.
