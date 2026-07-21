---
title: "Scrolling up to load older chat history falsely shows 'new messages' on the down arrow"
filed-by: agent
discovered-in: main session — boxholder hit it in chat
area: callback-box
resolution: implemented
---

**Resolved** by extracting the reconcile decision into a pure `decideReconcile`
(`src/frontend/src/components/chat/scroll-reconcile.ts`) that classifies a
landed older-history prepend as `hold-prepend` (never `flag-unseen`), and by two
fixes in the controller (`InteractiveChat-scroll.ts`): the prepend snapshot is
only consumed once content actually grew (so a zero-growth reconcile in the
load-older window doesn't leave the real insertion unguarded), and the reader is
re-anchored to a now-visible message after the prepend so the older block's
late-decoding images/embeds compensate against that anchor instead of reading as
new content below. Unit-checked in
`test/frontend/chat-scroll-reconcile.doctest.md`; manual DOM scenario 5c added to
`docs/chat-scroll-testing.md`. See the commit referenced in the closing note.

In chat, when you scroll up far enough to load **previously-unshown older history**, the
scroll-to-bottom **down arrow** lights up its **"new messages"** indicator — even though
nothing new arrived; you just loaded *old* messages *above* the viewport. The indicator
should only signal genuinely new content appended at the **bottom** while you're scrolled
up, not history prepended at the **top**.

**Where:** `src/frontend/src/components/chat/InteractiveChat-scroll.ts` — the hook returns
`hasUnseenContent` (drives the down-arrow badge) and `captureForPrepend` (used when older
history is prepended). The likely cause: prepending history grows the scroll content, and
the unseen-content logic reads that height/content change as new-content-below rather than
distinguishing a **top prepend** (older history, scroll position compensated) from a
**bottom append** (a genuinely new message). `captureForPrepend` compensates scroll
position for the prepend, but `hasUnseenContent` isn't being suppressed for that path.

**Repro:** open a chat with enough history to be paginated/lazy-loaded, scroll up until
older history loads → the down arrow shows the "new messages" state.

**Fix direction:** the unseen-content signal should key on new content at the *bottom*
(appends past the current scroll bottom) only; a prepend of older history at the top must
not set it. The prepend path (`captureForPrepend`) already knows it's a top-insertion —
thread that through so `hasUnseenContent` stays false for it. Verify the genuine case still
works: a new message arriving while scrolled up *should* still light the arrow.
