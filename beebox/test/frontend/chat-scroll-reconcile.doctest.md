# Chat scroll reconcile decision

The pure classifier behind the message-list scroll controller's resize handler
(`chat-scroll.ts`). Under the scroll model
(`docs/plans/chat-scroll-model.md`) the controller writes `scrollTop` only on a
discrete user action — opening a thread, sending, pressing the button — plus
geometric compensations for changes the reader did not cause. This function is
the dispatcher for the compensations: given the facts of one ResizeObserver
cycle it decides which one applies. The layout effects themselves still need the
browser procedure in `docs/chat-scroll-testing.md` and the scenario table at
`/dev/chat-scroll`, but the *decision* is deterministic and checked here.

```ts setup
import { decideReconcile } from "../../src/frontend/src/components/chat/scroll-reconcile.js";
import { bottomScrollTop } from "../../src/frontend/src/components/chat/chat-scroll-bottom.js";
```

The floating button ignores the viewport-tall remainder of a live turn and
aligns the generated content bottom instead. Without a live spacer it uses the
natural scroll bottom.

```ts
bottomScrollTop({ scrollHeight: 2000, clientHeight: 500, scrollTop: 900, scrollerTop: 100, liveContentBottom: 650 })
=> 950

bottomScrollTop({ scrollHeight: 2000, clientHeight: 500, scrollTop: 900, scrollerTop: 100, liveContentBottom: null })
=> 1500
```

A prepend of older history (loaded on scroll-up) grows the content just like a
bottom append, but must be held in place, never flagged as new — this is the
false-"new messages" badge bug. `prepend` wins over everything.

```ts
decideReconcile({ source: "content", grew: true, prepend: true, anchorMoved: false, atBottomAfter: false, atBottomBefore: false, openPhase: false })
=> hold-prepend

// even during the open phase, or with a moved anchor, a landed prepend is held
decideReconcile({ source: "content", grew: true, prepend: true, anchorMoved: true, atBottomAfter: true, atBottomBefore: false, openPhase: true })
=> hold-prepend
```

Opening a thread is the one bounded state in which growth does scroll: each
chunk of the first history render keeps the bottom, until the caller says the
render landed (or the reader scrolls away).

```ts
decideReconcile({ source: "content", grew: true, prepend: false, anchorMoved: false, atBottomAfter: false, atBottomBefore: false, openPhase: true })
=> open-bottom

// a scroller resize during the open phase lands at the bottom too
decideReconcile({ source: "scroller", grew: false, prepend: false, anchorMoved: false, atBottomAfter: false, atBottomBefore: false, openPhase: true })
=> open-bottom
```

A scroller-box resize is the viewport changing, not the content: the mobile
keyboard opening, the composer growing, a banner appearing. The reader's
bottom is preserved only when already there; otherwise the reading point stays
put, including when the composer grows.

```ts
decideReconcile({ source: "scroller", grew: false, prepend: false, anchorMoved: false, atBottomAfter: true, atBottomBefore: true, openPhase: false })
=> hold-from-bottom

// Away from the bottom, compensate only real content reflow.
decideReconcile({ source: "scroller", grew: true, prepend: false, anchorMoved: true, atBottomAfter: false, atBottomBefore: false, openPhase: false })
=> hold-anchor
```

An anchor that shifted on screen means existing content above the reader
reflowed (a late image/embed) — compensate, don't flag. Safari has no scroll
anchoring of its own, and the app disables Chrome's, so this branch is the only
one doing it.

```ts
decideReconcile({ source: "content", grew: true, prepend: false, anchorMoved: true, atBottomAfter: false, atBottomBefore: false, openPhase: false })
=> hold-anchor
```

Content grew, none of the above, and the reader is not at the bottom: the growth
landed below them — light the badge. Nothing scrolls; the button is how they go
see it.

```ts
decideReconcile({ source: "content", grew: true, prepend: false, anchorMoved: false, atBottomAfter: false, atBottomBefore: false, openPhase: false })
=> flag-unseen
```

Growth that leaves the reader still within the at-bottom margin does nothing at
all: they are watching it arrive. This is the model's central claim — a
streaming reply never scrolls; once it grows past the margin the reader is no
longer at the bottom, and *that* cycle flags unseen (the case above), so a
reader who sat at the bottom while a reply outgrew the screen sees the badge.

```ts
decideReconcile({ source: "content", grew: true, prepend: false, anchorMoved: false, atBottomAfter: true, atBottomBefore: false, openPhase: false })
=> none
```

A content cycle that didn't grow (a shrink at finalize, a label swap) is never
new content either.

```ts
decideReconcile({ source: "content", grew: false, prepend: false, anchorMoved: false, atBottomAfter: false, atBottomBefore: false, openPhase: false })
=> none
```

A height-only resize while reading does not move the page or flag new content.

```ts
decideReconcile({ source: "scroller", grew: false, prepend: false, anchorMoved: false, atBottomAfter: false, atBottomBefore: false, openPhase: false })
=> none
```
