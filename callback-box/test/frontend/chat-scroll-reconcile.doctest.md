# Chat scroll reconcile decision

The pure classifier behind the message-list scroll controller's resize handler
(`InteractiveChat-scroll.ts`). Given the facts of one ResizeObserver cycle it
decides what the scroller should do — the layout effects themselves still need
the manual procedure in `docs/chat-scroll-testing.md`, but the *decision* is
deterministic and checked here.

```ts setup
import { decideReconcile, decideScroll } from "../../src/frontend/src/components/chat/scroll-reconcile.js";
```

A prepend of older history (loaded on scroll-up) grows the content just like a
bottom append, but must be held in place, never flagged as new — this is the
false-"new messages" badge bug. `prepend` wins over everything.

```ts
decideReconcile({ source: "content", grew: true, pinned: false, prepend: true, anchorMoved: false })
=> hold-prepend

// even while pinned or with a moved anchor, a landed prepend is held, not followed/flagged
decideReconcile({ source: "content", grew: true, pinned: true, prepend: true, anchorMoved: true })
=> hold-prepend
```

While following the bottom, any growth just re-pins.

```ts
decideReconcile({ source: "content", grew: true, pinned: true, prepend: false, anchorMoved: false })
=> follow-bottom
```

Detached, an anchor that shifted on screen means existing content above the
reader reflowed (a late image/embed) — compensate, don't flag.

```ts
decideReconcile({ source: "content", grew: true, pinned: false, prepend: false, anchorMoved: true })
=> hold-anchor
```

Detached, content grew, and none of the above: genuinely new content below the
reader — light the badge.

```ts
decideReconcile({ source: "content", grew: true, pinned: false, prepend: false, anchorMoved: false })
=> flag-unseen
```

A scroller-box resize (chrome below the list) or a no-growth cycle is never new
content.

```ts
// scroller source: reposition only, never unseen
decideReconcile({ source: "scroller", grew: true, pinned: false, prepend: false, anchorMoved: false })
=> none

// content source but nothing grew
decideReconcile({ source: "content", grew: false, pinned: false, prepend: false, anchorMoved: false })
=> none
```

## Scroll-event classification (`decideScroll`)

The companion classifier for user scroll events (the controller's `scroll`
handler, after programmatic writes are filtered out). An upward scroll with
recent wheel/touch/key intent disengages following.

```ts
decideScroll({ scrolledUp: true, recentIntent: true, fromBottom: 300, nearBottomPx: 70 })
=> disengage

// even an intent-carrying scroll-up that stays near the bottom disengages
decideScroll({ scrolledUp: true, recentIntent: true, fromBottom: 30, nearBottomPx: 70 })
=> disengage
```

A scrollbar-thumb drag fires no wheel/touch/key events, so it carries no
recorded intent — but an upward scroll that lands well above the bottom can
only be the user, so it disengages anyway (the mid-stream scrollbar-drag
fight bug). The layout clamps the intent gate exists to ignore — content
shrinking below the reader, the mobile keyboard dismissing — land AT the new
bottom, so the away-from-bottom condition never matches them.

```ts
// scrollbar drag: no intent, but well above the bottom — the user
decideScroll({ scrolledUp: true, recentIntent: false, fromBottom: 300, nearBottomPx: 70 })
=> disengage

// keyboard-dismiss / shrink clamp: scrollTop drops to the new bottom, no
// intent — must NOT disengage (nor re-engage: it reads as scrolled-up)
decideScroll({ scrolledUp: true, recentIntent: false, fromBottom: 0, nearBottomPx: 70 })
=> none
```

A downward (or stationary) scroll that settles near the bottom re-engages —
no intent needed; one that stays far from the bottom does nothing.

```ts
decideScroll({ scrolledUp: false, recentIntent: false, fromBottom: 40, nearBottomPx: 70 })
=> re-engage

decideScroll({ scrolledUp: false, recentIntent: false, fromBottom: 500, nearBottomPx: 70 })
=> none
```
