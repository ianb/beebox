---
title: "Lightbox: can't page rapidly — each swipe must fully land before the next is accepted"
area: callback-box
filed-by: agent
discovered-in: boxholder, using the new swipe nav on a real device right after it shipped
---

Swiping through a set of images one after another doesn't work. After a
committed swipe you have to wait for the slide animation to finish and the
controls to settle before a second swipe takes effect — so flicking through a
gallery the way you would in any phone photo app doesn't page.

## Mechanism

A committed swipe defers the index change to the END of its flight:
`commitSwipe` springs the figure a full viewport off-screen and only calls
`onNavigate(step)` from the spring's `onDone`
(`callback-box/src/frontend/src/lib/lightbox-gesture-controller.ts`, the
`commitSwipe` case). That was deliberate — it makes the React index swap
invisible, because the incoming peer is already dead centre when it happens.

The cost is that the navigation isn't real until the animation ends. And
`onPointerDown` (same file, ~line 300) does this on any grab while settling:

```ts
this.render.cancelSprings();
this.navigating = false;
```

So a second swipe started before the first lands **cancels** the first rather
than queueing it: the commit spring dies before its `onDone` runs, `onNavigate`
is never called, and the index never changes. You drag the same image again
from wherever it had slid to. Rapid flicks therefore land on ~one image no
matter how many times you swipe.

The `navigating = false` line is correct in isolation — it exists so that
grabbing a flight and releasing without moving doesn't strand the figure
off-screen (that was a real bug, fixed in `f434a4fc`). The problem is that
"cancel the navigation" is the only thing a mid-flight grab can do.

Spring settle time is ~250–350ms (`SPRING_OMEGA = 22`, critically damped) plus
a React render round-trip, which is roughly the window a fast pager is trying
to swipe inside.

## Fix directions

1. **Commit the index at RELEASE, not at spring end.** `onNavigate(step)` fires
   immediately when `swipeStep` returns non-zero; the spring then animates the
   already-committed change. Each swipe is instantly real and the next one
   starts from a settled index, so flicks chain naturally. Needs the peer layer
   to re-render around the new index while the figure is still mid-flight —
   i.e. the swipe offset must be rebased by one viewport at the moment of
   commit, so what's on screen doesn't jump. This is how most carousels do it
   and is the direction I'd take.
2. **Let a mid-flight grab inherit the pending navigation** instead of
   cancelling it: apply the pending step, rebase the offset, and let the new
   drag continue from there. Keeps the invisible-swap property but the
   book-keeping is fiddlier (a grab that turns out to be a tap must still
   resolve to *something* sane).
3. **Shorten the flight** (raise `SPRING_OMEGA` for the commit spring only, or
   cap its duration). Cheapest, and worth doing regardless, but it narrows the
   window rather than closing it — a fast enough pager still hits it.

(1) is the real fix; (3) is a decent stopgap.

## Related

This is a direct consequence of the carousel design noted in
`issues/features/2026-07-31-lightbox-zoom-leaves-one-axis-dead.md` — the plain
index swap that was the minimal alternative would not have had this failure
mode, because there'd be no flight to interrupt. Worth weighing when picking a
fix: (1) keeps the animation and fixes paging; reverting to an instant swap
also fixes paging and deletes the machinery.

Verify any fix on a real touch device — the whole failure is about how fast a
human can actually flick, and synthetic PointerEvents can't reproduce that.
