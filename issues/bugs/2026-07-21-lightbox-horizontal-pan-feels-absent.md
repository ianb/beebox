---
title: "Zoomed lightbox: left/right pan feels absent while up/down works"
area: callback-box
filed-by: agent
discovered-in: main session — boxholder, panning a zoomed photo on mobile
needs: [manual-testing]
---

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
