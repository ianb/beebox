---
title: "Lightbox double-tap zoom leaves one axis with zero pan travel"
workstream: lightbox-horizontal-pan
area: callback-box
filed-by: agent
discovered-in: worktree-lightbox-horizontal-pan — measured while chasing a different (mis-stated) bug
---

Double-tap zoom is a constant 2.5× (`ZOOM_SCALE`). Pan travel per axis is
`panBound = max(0, (fit·scale − container) / 2)`, so **whichever axis is
letterboxed at fit gets zero travel** — the drag rubber-bands and springs back
to nothing, which reads as broken rather than as "you're at the edge."

This is not the bug the boxholder reported (that was swipe navigation, now
implemented). It is real but minor, and by their own read — "it's okay
(preferred!) if when zoomed the image cannot be swiped" — not urgent.

## The numbers (closed form, no browser needed)

The fit box is a contain-fit capped at ~0.95W × 0.92H inside a `W×H` viewport,
so for an image of aspect `a = w/h`:

- horizontal travel is zero when `a ≤ 0.435·(W/H)`
- vertical travel is zero when `a ≥ 2.375·(W/H)`

At a 1280×800 desktop window: no horizontal pan for anything taller than
~1:1.44; no vertical pan past ~3.8:1. At a 390×844 phone: no vertical pan for
**any** landscape photo (`a ≥ 1.1`); no horizontal pan only below 1:5.

Measured in a real browser against a 2400×1200 and a 1200×2400 test image,
confirming the formula:

| viewport | photo | fit | boundX | boundY |
|---|---|---|---|---|
| 1280×800 | landscape | 1216×608 | 880 | 360 |
| 1280×800 | portrait | 368×736 | **0** | 520 |
| 390×844 | portrait | 371×741 | 269 | 504 |
| 390×844 | landscape | 371×185 | 269 | **0** |

A −200px drag on the dead axis moves the image −157.8px at 1280 wide, which is
exactly `rubberBand(180, 1280)` — pure resistance, zero real travel.

## Two candidate fixes

1. **Zoom to fill rather than by a constant.** Pick
   `max(containerW/fitW, containerH/fitH)`, floored at `ZOOM_SCALE` and capped
   at `MAX_SCALE`, so every axis has travel at every aspect ratio. One change,
   in `LightboxRenderTarget.toggleZoom`. It changes double-tap behaviour for
   every image, so it wants a design pass, not a patch.
2. **Don't rubber-band a zero-bound axis.** Cheap and independent: when
   `bound === 0` the axis is pinned, so `rubberBandPan` should return 0 rather
   than 80% of the finger's travel. Removes the "it moves then snaps back"
   tell without touching the zoom model.

(2) is worth doing on its own even if (1) is never designed.

## Also noted, not fixed

A committed swipe's spring target is captured once at release
(`lightbox-gesture-controller.ts`, `commitSwipe`). `measure()` retargets only
the transform settle spring, not the swipe spring, so a rotation or width
change during the ~300ms commit flight leaves the figure partly on-screen and
the incoming peer off-centre. Found by a Codex review; left alone deliberately
— it needs a rotation inside a third of a second, and the next gesture or index
change resets it.
