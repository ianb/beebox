---
title: "Lightbox double-tap zoom leaves one axis with zero pan travel"
workstream: lightbox-horizontal-pan
area: callback-box
filed-by: agent
discovered-in: worktree-lightbox-horizontal-pan — measured while chasing a different (mis-stated) bug
resolution: wontfix
---

**Closed 2026-08-18 — the boxholder can't perceive it on the device that should
show it worst.** *"I have a small phone and it works fine."* A small phone is
exactly where the numbers below predict the most dead axes, so that is the
strongest available evidence against acting.

Neither candidate fix landed and neither should: verified 2026-08-18 that
`toggleZoom` still uses the constant `ZOOM_SCALE = 2.5`
(`lightbox-render-target.ts:224-230`) and `rubberBandPan` still has no
zero-bound short-circuit (`lightbox-gesture-math.ts:143-150`).

**The title oversells the finding, which is worth recording so nobody re-files
it.** "Zero pan travel on one axis" is geometry, not a defect: when a
2.5×-zoomed image still doesn't fill an axis, there is nothing hidden on that
axis to pan to, so refusing to move is correct. Nothing is unreachable.

The only genuine defect was cosmetic — a drag on the pinned axis moves ~80% of
finger travel and springs back, implying somewhere to go that does not exist.
Fix (2) below (return the value unchanged when `bound === 0`) remains a valid
three-line polish if the tell is ever noticed in practice. Fix (1) — zoom to
fill rather than a constant — would redesign double-tap for every image to serve
an axis with nothing to show, and is the one to leave alone.

**Correction to the last section:** it says the swipe-commit spring defect was
"left alone deliberately", which went stale within hours — `aa8d9330`
("lightbox: fix swipe commit defects found by Codex review") landed the same
evening. Whether it covered that exact retarget case is unconfirmed;
`measure()` still only cancels `swipeSpring` rather than retargeting it.

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
