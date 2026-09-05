---
title: "Zoomed lightbox: left/right pan feels absent while up/down works"
workstream: unknown
area: beebox
filed-by: agent
discovered-in: main session — boxholder, panning a zoomed photo on mobile
resolution: implemented
---

**Closed 2026-07-31 — and the diagnosis below was aimed at the wrong gesture.**

The report was never about panning a *zoomed* image. The boxholder clarified:
swiping left/right **at fit scale** did nothing. Zoomed panning already worked
and already suppressed swipe, which is the wanted behaviour. The dead end was
`lightbox-gesture-reducer.ts`'s explicit `// Horizontal at fit: reserved for
future prev/next nav — release, no action` branch. Fixed by implementing that
slot: a `swiping` mode, a `swipeStep` release decision mirroring
`shouldDismiss`, and a peer layer in `ImageLightbox` holding the neighbouring
images one viewport to either side so the drag reveals a real image.

The zoom-pan analysis below is still *correct*, just about a different and much
smaller thing — it now lives in
`issues/features/2026-07-31-lightbox-zoom-leaves-one-axis-dead.md`. Cost of the
misdirection: a full browser-instrumentation round measuring pan bounds that
were never the complaint. The lesson is in the phrasing — "left/right pan feels
absent while up/down works" read as a pan bug because it named panning; the
actual report was "swiping does nothing." Ask which gesture before measuring.

---

*Original diagnosis, preserved:*

On a zoomed photo in the lightbox, dragging up/down pans but dragging left/right
seems to do nothing. Reported as "we already have up/down, left/right should be
easy to add."

## But the code already pans both axes — so this is a bug or a geometry effect, not a missing feature

Reading the gesture state machine (all on `main`, deployed):

- `lightbox-gesture-reducer.ts:169` — when a drag starts **and the image is not
  at fit** (i.e. zoomed), *any* direction enters `panning` mode. The
  vertical/horizontal split (`classifyAxis`) is applied **only at fit scale**,
  where vertical = dismiss and horizontal = reserved-for-future-prev/next.
- `computePan` (`lightbox-transform.ts:87`) translates **both** `x` and `y` from
  the pointer delta. There is no axis restriction in the pan path.

So horizontal pan while zoomed is implemented. The task is **not** "add it" —
it's to find why it feels absent. Two live hypotheses:

1. **Geometry, not a bug (most likely).** `panBound` is
   `max(0, (fitSize·scale − containerSize) / 2)` per axis — **zero when the
   scaled image isn't larger than the container on that axis**
   (`lightbox-gesture-math.ts:100`). For a **portrait photo on a portrait
   phone**, at fit the image fills the *height* and is letterboxed on the sides.
   Double-tap zoom (2.5×) then gives lots of vertical travel and little or no
   horizontal travel — so up/down pans freely and left/right just rubber-bands
   back and reads as "dead." If this is it, the fix isn't in the pan code at all;
   it's about zoom (a higher zoom factor, or zoom-to-fill-width on a
   letterboxed axis) — and it should be designed, not hacked.
2. **A real clamp/geometry bug** — `frame.fit` or `frame.container` wrong for one
   axis, so the horizontal bound computes to zero when it shouldn't. Would
   reproduce on a *landscape* photo too, which hypothesis 1 would not.

**Discriminating test:** try a **landscape** photo. If left/right pans there but
not on a portrait photo, it's hypothesis 1 (geometry — expected behavior, and
the real ask is a zoom change). If left/right fails on landscape too, it's
hypothesis 2 (a bound bug worth fixing directly).

## Where it belongs

The `worktree-lightbox-gestures` session (still open, Remote Control on) tuned
these constants and can reproduce on a real device — this is its domain. Bring
it there rather than fixing blind; the constants live in
`lightbox-gesture-math.ts` / `lightbox-spring.ts` and the zoom factor is in the
gesture config. Confirm which hypothesis holds *before* changing anything.
