---
title: "Sending a message snaps the chat scroll with no easing — the jump to anchor the new message is abrupt"
workstream: unattached
area: callback-box
labels: [ui, chat]
filed-by: agent
discovered-by: Ian
discovered-in: main session — "when a new user message comes in it scrolls to the top… without any ease or animation and it's abrupt"
---

When a new user message lands, the chat scrolls to anchor it (top of the
viewport) instantly — no easing, an abrupt snap.

The scroll model (`docs/plans/chat-scroll-model.md`, landed 2026-08-25) writes
scroll positions through `writeTop(top, behavior)` in
`src/frontend/src/components/chat/chat-scroll.ts:140,362`; the anchor write at
`:166` passes `"instant"` explicitly. `"instant"` is right for reflow
compensation (an animated write there would fight the ResizeObserver loop),
but the *user-initiated* send jump reads as a glitch without motion —
`behavior: "smooth"` (or a short custom ease, respecting
`prefers-reduced-motion`) for that one write, keeping `"instant"` for
compensation writes.

The live `chat-scroll` workstream owns this surface (revived 2026-08-27 for
the not-at-bottom-on-load bug); this item should ride along with that session
rather than get its own.
