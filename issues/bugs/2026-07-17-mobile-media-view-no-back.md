---
title: "Following a link to a media file traps you on mobile — no way to go back"
filed-by: agent
discovered-in: main session — boxholder got stuck on mobile
area: callback-box
---

On mobile, following a **link to a media file** opens the media view, which then
has **no way to navigate back** — the boxholder got stuck there with no visible
back affordance / no route out.

Unconfirmed on desktop. Likely mobile-specific: the media/binary file view may lack
a back control that desktop gets from browser chrome or a wider layout, or the
media view renders full-bleed and hides the app nav. Either way, reaching a media
file via a link should always leave a way back (app back button, breadcrumb, or a
working browser-back).

**Repro:** on mobile, tap a link that points at a media file (image/audio/video),
land on the media view, try to return to where you were. Expected: a back
affordance (or browser-back) returns you. Actual: stuck — no way back.

**Where to look:** `src/frontend/src/components/FileView.tsx` and the media/binary
renderers (`src/frontend/src/renderers/binary.tsx` is the non-text fallback; check
for a dedicated image/media renderer too), plus how the media route is entered from
a link — does it push a history entry (so browser-back works) or replace/hard-nav,
and does the mobile layout render the app nav / a back control on this view?

**Consider:** ensure every file/media view — however it's reached — renders a back
affordance on mobile and pushes a proper history entry, so browser-back and an
in-app back both work. Pairs with the general mobile-nav surface.
