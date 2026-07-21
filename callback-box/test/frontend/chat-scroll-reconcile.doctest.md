# Chat scroll reconcile decision

The pure classifier behind the message-list scroll controller's resize handler
(`InteractiveChat-scroll.ts`). Given the facts of one ResizeObserver cycle it
decides what the scroller should do — the layout effects themselves still need
the manual procedure in `docs/chat-scroll-testing.md`, but the *decision* is
deterministic and checked here.

```ts setup
import { decideReconcile } from "../../src/frontend/src/components/chat/scroll-reconcile.js";
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
