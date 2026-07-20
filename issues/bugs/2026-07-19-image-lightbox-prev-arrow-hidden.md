---
title: "Image lightbox shows only the next arrow — a wide image paints over the previous one"
area: callback-box
filed-by: agent
discovered-in: main session — boxholder hit it paging through images
needs: [manual-testing]
---

In the image lightbox, only **one** navigation arrow is visible — you can page
forward but there's no visible control to go back.

## Cause (from reading `components/ImageLightbox.tsx`)

Both arrows *are* rendered, under the same condition (`hasMany`), so this is not
a logic bug — it's paint order. Three elements sit at the **same `z-10`**:

| line | element | |
|---|---|---|
| 79  | `<NavButton direction="prev">` | `absolute z-10 left-2` |
| 86  | `<figure>` | `relative z-10 max-w-[95vw]`, `<img>` is `max-w-full` |
| 113 | `<NavButton direction="next">` | `absolute z-10 right-2` |

Within one stacking context, elements at equal `z-index` paint in **DOM order** —
later paints on top. So the figure paints over `prev`, and `next` paints over the
figure. Once an image is wide enough to reach the arrow positions (`left-2` /
`right-2`, i.e. 8px from the viewport edge), the image covers the previous arrow
while the next arrow sits above it.

This also explains why it wouldn't reproduce every time: a **narrow** image
doesn't extend far enough left to cover the arrow, so both show. It'll look
broken for wide/landscape images and fine for tall/narrow ones — which makes it
easy to dismiss as a fluke.

Note the arrow is only *visually* hidden, not gone: it's still in the DOM,
still keyboard-reachable, and still announced as "Previous image". The left/right
arrow keys also still work (`ImageLightbox.tsx` binds them). So the bug is purely
that the affordance is invisible — worth knowing, because it means anyone testing
by keyboard or screen reader would report it as working.

## Fix direction

Raise the nav buttons above the figure — `z-20` on `NavButton`'s className
(`ImageLightbox.tsx:130`) is the one-token version. Moving the `prev` render
below the figure would also work but leaves the two buttons split across the
figure in source for no reason, and re-breaks the moment someone reorders them.

Check while in there: the close/counter cluster (`ImageLightbox.tsx:101`) sits
*inside* the figure at `top-2 right-2` and could collide with the raised `next`
arrow at `right-2` on a narrow viewport.

**Manual testing:** open the lightbox on a set with more than one image, using a
**wide/landscape** image, and confirm both arrows are visible and clickable —
then repeat on a phone viewport, where the arrows are `w-10` at `left-2`/`right-2`
and have the least room.
