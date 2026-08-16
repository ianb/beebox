---
title: "Lightbox mobile gestures: double-tap to zoom + pan, swipe up/down to close"
workstream: unknown
area: callback-box
filed-by: agent
discovered-in: main session — boxholder asked for it after using the lightbox on a phone
resolution: implemented
design: ../../../callback-box/docs/implemented-plans/lightbox-mobile-gestures.md
---

**Closed (implemented + boxholder-confirmed) 2026-07-31.** Double-tap zoom + pan,
pinch, and swipe-to-dismiss landed (`c326d4a5` + `299297e5`, design in
[`lightbox-mobile-gestures.md`](../../../callback-box/docs/implemented-plans/lightbox-mobile-gestures.md)),
mode-aware so a vertical drag dismisses at fit and pans when zoomed. Boxholder
confirms the gestures on a real device. A separate follow-up bug on rapid paging
stays open:
[lightbox-swipe-cannot-page-rapidly](../../bugs/2026-07-31-lightbox-swipe-cannot-page-rapidly.md).
Reopen only if the core gestures regress.

Two mobile gestures wanted in the image lightbox
(`src/frontend/src/components/ImageLightbox.tsx`):

1. **Double-tap to enter zoom + pan** — magnify the image and drag around it,
   rather than being stuck at fit-to-screen.
2. **Swipe up or down over the image closes it.**

Today the component has **no touch handling at all** (keyboard arrows, on-screen
arrow buttons, a backdrop click-to-close, and Escape), and the repo has no
gesture library, so this is built from scratch or takes a new dependency.

## The design problem: those two gestures are the same gesture

A vertical drag means **dismiss** at fit-to-screen and **pan** once zoomed in.
They cannot both be live at once, so the implementation has to be **mode-aware**:

- **At fit scale** — vertical drag dismisses (ideally tracking the finger, with
  the image following and fading, and snapping back if released under a
  threshold rather than closing on any twitch).
- **Zoomed in** — vertical drag pans. Dismiss must be *off*, or the user hits it
  constantly while panning, which is worse than not having it.
- **Getting back out** — since dismiss is unavailable while zoomed, there must be
  an obvious exit: double-tap again returns to fit (and from fit, a further
  swipe dismisses). Worth confirming that two-step feels right on a real device
  rather than assuming.

This is the standard behavior in iOS Photos / Twitter's viewer, and it's worth
matching rather than inventing — muscle memory is the whole point of a gesture.

## Decisions needed

- **Up *and* down, or down only?** Boxholder asked for both. Most viewers use
  down-only, reserving up for something else; both is fine but decide
  deliberately, since "both" removes a gesture from the vocabulary forever.
- **Pinch-to-zoom too?** Double-tap implies a zoom mode, and pinch is its natural
  sibling — a user who can double-tap-zoom will try to pinch. Building the
  transform/pan math for one gets the other nearly free; skipping it will read
  as broken.
- **Horizontal swipe = prev/next?** Not asked for, but once the image responds to
  drag at all, horizontal is the obvious next expectation, and it collides with
  panning a zoomed image on the same axis. Decide whether it's in scope now or
  explicitly later — the mode-aware structure should at least leave room.
- **Library or hand-rolled?** No gesture dep exists today. Hand-rolling
  pointer-events math is very doable but momentum, rubber-banding, and
  multi-touch are where hand-rolled versions usually feel wrong.

## Constraints

- **Don't regress the a11y work already in this component.** It deliberately uses
  a real `<button>` for the backdrop (not a click handler on a div) and manages
  `pointer-events` so clicks on the figure's transparent whitespace fall through
  to close. Gesture handlers must not swallow those paths, and keyboard/AT
  navigation must keep working — the recently-fixed prev-arrow bug was invisible
  to keyboard testing precisely because those paths are independent.
- **Mind the z-stack** just set in `ef98ae6f`: backdrop `0` < figure `10` <
  arrows `20` < controls `30`. A gesture surface has to sit somewhere in that
  order without covering the close button.
- **A drag must not fire the backdrop's click-to-close** on release.

## What to try on the phone (manual-testing checklist, 2026-07-20)

Implementation landed (`c326d4a5` + `299297e5`, design in
`../../callback-box/docs/implemented-plans/lightbox-mobile-gestures.md`). Desktop
pointer-event testing verified the logic; the phone pass is about **feel and
iOS specifics**:

1. Double-tap an image → zooms ~2.5× at the tap point; double-tap again → fit.
2. While zoomed: one-finger pan — edges should resist (rubber-band) and spring
   back on release. Vertical drag must pan, never dismiss.
3. Pinch in/out, including pinch below fit (should rubber-band back to fit on
   release) and adding/removing a finger mid-pinch (no jumps).
4. At fit: slow vertical drag → image follows finger and fades; release early
   → springs back; drag ~a third of the screen or flick → closes. Both up and
   down. Flicking *back toward center* after a drag should cancel, not close.
5. iOS checks: no page scroll/bounce behind the overlay during any gesture, no
   native double-tap or pinch zoom of the page, gestures survive an
   interrupted touch (notification pull-down mid-drag → image snaps back),
   toolbar show/hide doesn't leave the image outside the viewport.
6. Feel dials (report anything that reads wrong; all constants in
   `lightbox-gesture-math.ts` / `lightbox-spring.ts`): zoom level 2.5×, spring
   omega 22, flick threshold 0.5 px/ms, close distance 30% of viewport,
   fade-out over 40%.

## This needs a real device

Headless Chromium cannot emulate pinch, momentum, or rubber-banding — the
mobile-chat-layout work hit exactly this limit and had to ship a best-guess fix.
Expect to iterate on hardware; a desktop-only implementation will feel wrong even
when the code looks right. Hence `needs: [manual-testing]` from the start rather
than as an afterthought.
