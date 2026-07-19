---
title: "Scrolling up to load older chat history falsely shows 'new messages' on the down arrow"
filed-by: agent
discovered-in: main session — boxholder hit it in chat
area: callback-box
---

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
